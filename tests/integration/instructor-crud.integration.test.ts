// DB-backed integration tests for the INSTRUCTOR CRUD actions (app/actions/
// instructors.ts: createInstructor / updateInstructor / setInstructorActive) and how
// they surface through the admin read model (lib/admin/instructors.ts
// getAdminInstructors, which is active-only).
//
// Why this exists: the no-DB unit suite (tests/admin-instructors.test.ts) can only
// pin validation, the auth-gate ordering, and the mock success shapes — its DB branch
// is short-circuited by an unset DATABASE_URL. The actual guarantees only hold
// against a real Postgres:
//
//   1. CREATE → appears in getAdminInstructors with its slug id + names + tag.
//   2. UPDATE → name/nameTh/tag change on the row (and in the read model); id + active
//      are untouched.
//   3. SOFT REMOVE: setInstructorActive(false) → drops out of the ACTIVE list, but the
//      instructors row AND its availability rows (the FK references) SURVIVE.
//   4. REACTIVATE: setInstructorActive(true) → returns to the active list.
//   5. UNKNOWN id → UNKNOWN_INSTRUCTOR for update + setInstructorActive.
//
// requireAdmin()/requireOwner() use the mock provider (allow) with ADMIN_AUTH unset,
// exactly like the other admin integration tests; the deny/owner-gate path is covered
// in admin-auth.test.ts. Fixtures are per-run prefixed for a clean teardown; safe to
// point at the shared dev DB.
//
// Gated: requires DATABASE_URL (loaded from .env by setup-env.ts). When unset the
// whole block skips (describe.skipIf), so the default no-DB `npm test` stays green.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";

// The CRUD actions' DB paths call revalidatePath, which throws outside a Next request
// scope. Stub next/cache so the actions run in a plain test process.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

import { getDb, closeDb } from "@/lib/db/client";
import { instructorAvailability, instructors } from "@/lib/db/schema";
import {
  createInstructor,
  setInstructorActive,
  setInstructorAvailability,
  updateInstructor,
} from "@/app/actions/instructors";
import { getAdminInstructors, WEEKDAYS, type Weekday } from "@/lib/admin/instructors";

const HAS_DB = !!process.env.DATABASE_URL;

type Week = Record<Weekday, [string, string][]>;
function week(partial: Partial<Week>): Week {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, partial[d] ?? []])) as Week;
}

describe.skipIf(!HAS_DB)("instructor CRUD (integration · requires DATABASE_URL)", () => {
  // A per-run marker so teardown can find and remove every instructor this file
  // created (created ids are slugified from RUN-prefixed names, so they all begin
  // with the prefix). createInstructor generates the id itself, so we capture it from
  // the result rather than minting our own.
  const run = `icrud${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const createdIds: string[] = [];

  const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

  /** Create via the action with a run-scoped EN name; track the generated id. */
  async function create(label: string, tag?: string): Promise<string> {
    const res = await createInstructor({
      name: `${run} ${label}`,
      nameTh: `ครู ${label}`,
      tag,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("create failed");
    createdIds.push(res.id);
    return res.id;
  }

  beforeAll(() => {
    delete process.env.ADMIN_AUTH; // mock admin allow
  });

  afterAll(async () => {
    try {
      const db = getDb();
      // Sweep every instructor whose id starts with the run prefix (slug of the
      // RUN-prefixed name), deleting their availability first to clear the FK.
      const mine = await db
        .select({ id: instructors.id })
        .from(instructors)
        .where(like(instructors.id, `${run}%`));
      for (const { id } of mine) {
        await db.delete(instructorAvailability).where(eq(instructorAvailability.instructorId, id));
      }
      if (mine.length) {
        await db.delete(instructors).where(like(instructors.id, `${run}%`));
      }
    } finally {
      if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
      else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
      await closeDb();
    }
  });

  it("CREATE: a new instructor appears in getAdminInstructors with its names + tag", async () => {
    const id = await create("alpha", "Reformer");
    // The id is the slug of the EN name (lowercased, hyphenated, ascii).
    expect(id).toMatch(/^[a-z0-9-]+$/);

    const list = await getAdminInstructors();
    const found = list.find((i) => i.id === id);
    expect(found).toBeTruthy();
    expect(found!.nameEn).toBe(`${run} alpha`);
    expect(found!.nameRawTh).toBe("ครู alpha");
    expect(found!.tagRaw).toBe("Reformer");
    expect(found!.active).toBe(true);
  });

  it("UPDATE: renames name/nameTh/tag without changing id or active", async () => {
    const id = await create("beta");

    const res = await updateInstructor({
      id,
      name: `${run} beta renamed`,
      nameTh: "ครู เบต้า",
      tag: "Mat",
    });
    expect(res).toEqual({ ok: true, id });

    // Verify against the raw row (id + active untouched, fields changed).
    const db = getDb();
    const [row] = await db
      .select({
        id: instructors.id,
        name: instructors.name,
        nameTh: instructors.nameTh,
        tag: instructors.tag,
        active: instructors.active,
      })
      .from(instructors)
      .where(eq(instructors.id, id))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row!.id).toBe(id); // id never changes
    expect(row!.name).toBe(`${run} beta renamed`);
    expect(row!.nameTh).toBe("ครู เบต้า");
    expect(row!.tag).toBe("Mat");
    expect(row!.active).toBe(true);

    // And the read model reflects the rename.
    const found = (await getAdminInstructors()).find((i) => i.id === id)!;
    expect(found.nameEn).toBe(`${run} beta renamed`);
    expect(found.tagRaw).toBe("Mat");
  });

  it("UPDATE: unknown id → UNKNOWN_INSTRUCTOR", async () => {
    const res = await updateInstructor({ id: `${run}-nope`, name: "X", nameTh: "x" });
    expect(res).toEqual({ ok: false, code: "UNKNOWN_INSTRUCTOR" });
  });

  it("SOFT REMOVE then REACTIVATE: drops from / returns to the active list; row + availability survive", async () => {
    const id = await create("gamma");

    // Give the instructor an availability template so we can prove the FK rows survive.
    const avail = await setInstructorAvailability({
      instructorId: id,
      week: week({ Mon: [["09:00", "12:00"]], Wed: [["14:00", "16:00"]] }),
    });
    expect(avail).toEqual({ ok: true });

    const db = getDb();
    const availBefore = await db
      .select({ id: instructorAvailability.id })
      .from(instructorAvailability)
      .where(eq(instructorAvailability.instructorId, id));
    expect(availBefore.length).toBe(2);

    // Soft remove.
    const off = await setInstructorActive({ id, active: false });
    expect(off).toEqual({ ok: true, id, active: false });

    // Drops out of the ACTIVE-only read model.
    expect((await getAdminInstructors()).some((i) => i.id === id)).toBe(false);

    // But the row SURVIVES (just inactive) and its availability rows are intact.
    const [rowAfter] = await db
      .select({ id: instructors.id, active: instructors.active })
      .from(instructors)
      .where(eq(instructors.id, id))
      .limit(1);
    expect(rowAfter).toBeTruthy();
    expect(rowAfter!.active).toBe(false);
    const availAfter = await db
      .select({ id: instructorAvailability.id })
      .from(instructorAvailability)
      .where(eq(instructorAvailability.instructorId, id));
    expect(availAfter.length).toBe(2); // FK rows preserved — no cascade delete

    // Reactivate → returns to the active list.
    const on = await setInstructorActive({ id, active: true });
    expect(on).toEqual({ ok: true, id, active: true });
    expect((await getAdminInstructors()).some((i) => i.id === id)).toBe(true);
  });

  it("SOFT REMOVE: unknown id → UNKNOWN_INSTRUCTOR", async () => {
    const res = await setInstructorActive({ id: `${run}-nope`, active: false });
    expect(res).toEqual({ ok: false, code: "UNKNOWN_INSTRUCTOR" });
  });
});
