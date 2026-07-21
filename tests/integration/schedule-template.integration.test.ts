// DB-backed integration tests for the EDITABLE schedule template:
// app/actions/schedule.ts {create,update,delete}TemplateSlot, how it surfaces through
// the read model (lib/admin/schedule-template.ts getScheduleTemplate /
// getTemplateSlotsByDow), and how generateWeekFromBaseline now materialises a week
// from the DB template.
//
// Why this exists: the no-DB unit suite (tests/schedule-template.test.ts) can only
// pin validation, the auth-gate ordering, and the mock shapes — its DB branch is
// short-circuited by an unset DATABASE_URL. The actual guarantees only hold against a
// real Postgres:
//
//   1. CREATE → the slot appears in getScheduleTemplate (active list) with its fields.
//   2. UPDATE → time/type/duration/capacity/instructor change on the row + read model;
//      id and active are untouched.
//   3. SOFT DELETE: deleteTemplateSlot → drops out of the ACTIVE list, but the
//      class_templates row SURVIVES (active=false) so the instances.template_id FK holds.
//   4. GENERATE: a created slot shows up as a generated class_instance for a week
//      (materialised straight from the DB template), carrying templateId = the slot id.
//      Instances are born PUBLISHED (the draft→publish ceremony was removed): stamped
//      published_at = members_visible_at = now, public_visible_at =
//      computePublicVisibleAt(starts_at, type), with ONE schedule.published event per
//      generate call that created ≥ 1 instance.
//   5. CREATE CLASS: createClass inserts a born-published instance with the same
//      three stamps and emits ONE schedule.published event.
//
// requireAdmin()/requireOwner() use the mock provider (allow) with ADMIN_AUTH unset,
// like the other admin integration tests; the deny/owner-gate path is covered in
// admin-auth.test.ts. Fixtures are per-run scoped (a unique weekday + time band, and
// created ids tracked) for a clean teardown; safe to point at the shared dev DB.
//
// Gated: requires DATABASE_URL (loaded from .env by setup-env.ts). When unset the
// whole block skips (describe.skipIf), so the default no-DB `npm test` stays green.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, gte, inArray, lt } from "drizzle-orm";

// The action DB paths call revalidatePath, which throws outside a Next request scope.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

import { getDb, closeDb } from "@/lib/db/client";
import { classInstances, classTemplates } from "@/lib/db/schema";
import {
  createClass,
  createTemplateSlot,
  deleteTemplateSlot,
  generateWeekFromBaseline,
  updateTemplateSlot,
} from "@/app/actions/schedule";
import { getScheduleTemplate, getTemplateSlotsByDow } from "@/lib/admin/schedule-template";
import { on } from "@/lib/events/bus";
import { computePublicVisibleAt } from "@/lib/schedule/visibility";
import { startOfWeekMonday, startsAtFor } from "@/lib/schedule/baseline";
import { studioParts } from "@/lib/time";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("schedule template (integration · requires DATABASE_URL)", () => {
  const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

  // A unique time band so the created slots are easy to find / clean up and don't
  // collide with seeded baseline slots (which use :00 minutes on the hour).
  const TEST_TIME_A = "13:07";
  const TEST_TIME_B = "13:09";
  // A far-future week to generate into, so generated instances don't collide with the
  // seeded published week and are trivial to sweep by their start window.
  const weekAnchor = new Date("2031-03-05T12:00:00"); // a Wednesday
  const weekStart = startOfWeekMonday(weekAnchor);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

  const createdTemplateIds: string[] = [];

  beforeAll(() => {
    delete process.env.ADMIN_AUTH; // mock admin allow
  });

  afterAll(async () => {
    try {
      const db = getDb();
      // Remove any class_instances generated into the test week first (FK to template).
      await db
        .delete(classInstances)
        .where(and(gte(classInstances.startsAt, weekStart), lt(classInstances.startsAt, weekEnd)));
      if (createdTemplateIds.length) {
        await db.delete(classTemplates).where(inArray(classTemplates.id, createdTemplateIds));
      }
    } finally {
      if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
      else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
      await closeDb();
    }
  });

  it("CREATE: a new slot appears in getScheduleTemplate with its fields", async () => {
    const res = await createTemplateSlot({
      dayOfWeek: 3, // Wednesday
      time: TEST_TIME_A,
      type: "duo",
      durationMin: 50,
      capacity: 2,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("create failed");
    createdTemplateIds.push(res.id);

    const tpl = await getScheduleTemplate();
    const found = tpl.find((s) => s.id === res.id);
    expect(found).toBeTruthy();
    expect(found!.dayOfWeek).toBe(3);
    expect(found!.time).toBe(TEST_TIME_A);
    expect(found!.type).toBe("duo");
    expect(found!.durationMin).toBe(50);
    expect(found!.capacity).toBe(2);
  });

  it("UPDATE: changes fields on the row + read model; id and active untouched", async () => {
    const created = await createTemplateSlot({
      dayOfWeek: 3,
      time: TEST_TIME_B,
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    createdTemplateIds.push(created.id);

    const res = await updateTemplateSlot({
      id: created.id,
      time: TEST_TIME_B,
      type: "trio",
      durationMin: 55,
      capacity: 3,
    });
    expect(res).toEqual({ ok: true });

    const db = getDb();
    const [row] = await db
      .select({
        id: classTemplates.id,
        type: classTemplates.type,
        durationMin: classTemplates.durationMin,
        capacity: classTemplates.capacity,
        active: classTemplates.active,
      })
      .from(classTemplates)
      .where(eq(classTemplates.id, created.id))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row!.id).toBe(created.id); // id never changes
    expect(row!.type).toBe("trio");
    expect(row!.durationMin).toBe(55);
    expect(row!.active).toBe(true); // active untouched by update

    const found = (await getScheduleTemplate()).find((s) => s.id === created.id)!;
    expect(found.type).toBe("trio");
    expect(found.durationMin).toBe(55);
  });

  it("UPDATE: unknown id → UNKNOWN_TEMPLATE", async () => {
    const res = await updateTemplateSlot({
      id: "00000000-0000-4000-b000-0000000000ff",
      time: "10:00",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(res).toEqual({ ok: false, code: "UNKNOWN_TEMPLATE" });
  });

  it("SOFT DELETE: drops from the active list but the row survives (active=false)", async () => {
    const created = await createTemplateSlot({
      dayOfWeek: 4,
      time: TEST_TIME_A,
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    createdTemplateIds.push(created.id);

    const del = await deleteTemplateSlot({ id: created.id });
    expect(del).toEqual({ ok: true });

    // Drops out of the ACTIVE read model.
    expect((await getScheduleTemplate()).some((s) => s.id === created.id)).toBe(false);

    // But the row SURVIVES, just inactive.
    const db = getDb();
    const [row] = await db
      .select({ id: classTemplates.id, active: classTemplates.active })
      .from(classTemplates)
      .where(eq(classTemplates.id, created.id))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row!.active).toBe(false);

    // Deleting again → UNKNOWN_TEMPLATE (no live row to soft-delete).
    expect(await deleteTemplateSlot({ id: created.id })).toEqual({
      ok: false,
      code: "UNKNOWN_TEMPLATE",
    });
  });

  it("GENERATE: a created slot materialises as a born-PUBLISHED instance (all three stamps) carrying its templateId, with ONE schedule.published event", async () => {
    // Create a Wednesday slot at the test time.
    const created = await createTemplateSlot({
      dayOfWeek: 3, // Wednesday
      time: TEST_TIME_A,
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    createdTemplateIds.push(created.id);

    // The template-by-dow read includes our slot on Wednesday (3) with its id.
    const map = await getTemplateSlotsByDow();
    const wed = map.get(3) ?? [];
    expect(wed.some((s) => s.time === TEST_TIME_A && s.templateId === created.id)).toBe(true);

    // Generate the far-future week from the DB template — count the broadcast events.
    const events: { weekStart: string }[] = [];
    const off = on("schedule.published", async (e) => {
      events.push(e);
    });
    try {
      const gen = await generateWeekFromBaseline({ weekStart: weekStart.toISOString() });
      expect(gen.ok).toBe(true);
      if (!gen.ok) throw new Error("generate failed");
      expect(gen.created).toBeGreaterThan(0);

      // Exactly ONE schedule.published for the whole generated batch.
      expect(events.length).toBe(1);
      expect(events[0]!.weekStart).toBe(weekStart.toISOString());

      // Re-running is idempotent (0 created) → NO further event.
      const again = await generateWeekFromBaseline({ weekStart: weekStart.toISOString() });
      expect(again).toEqual({ ok: true, created: 0 });
      expect(events.length).toBe(1);
    } finally {
      off();
    }

    // The Wednesday of that week at the test time exists as a born-PUBLISHED
    // instance whose template_id points at our slot, stamped per invariant 4:
    // members_visible_at = published_at (= generation time) and
    // public_visible_at = computePublicVisibleAt(starts_at, type).
    const wednesday = new Date(weekStart);
    wednesday.setDate(wednesday.getDate() + 2); // Mon=+0 … Wed=+2
    const startsAt = startsAtFor(wednesday, TEST_TIME_A);

    const db = getDb();
    const [inst] = await db
      .select({
        id: classInstances.id,
        status: classInstances.status,
        templateId: classInstances.templateId,
        type: classInstances.type,
        publishedAt: classInstances.publishedAt,
        membersVisibleAt: classInstances.membersVisibleAt,
        publicVisibleAt: classInstances.publicVisibleAt,
      })
      .from(classInstances)
      // Match on OUR template, not just the timestamp: an earlier spec in this file
      // leaves its own active Wednesday slot at TEST_TIME_A (a duo), so two instances
      // legitimately share this starts_at. Selecting by time alone picked either one
      // at random and made the type assertion below nondeterministic.
      .where(and(eq(classInstances.startsAt, startsAt), eq(classInstances.templateId, created.id)))
      .limit(1);
    expect(inst).toBeTruthy();
    expect(inst!.status).toBe("published");
    expect(inst!.type).toBe("group");
    expect(inst!.templateId).toBe(created.id);
    expect(inst!.publishedAt).not.toBeNull();
    expect(inst!.membersVisibleAt).not.toBeNull();
    expect(inst!.publicVisibleAt).not.toBeNull();
    expect(inst!.membersVisibleAt!.getTime()).toBe(inst!.publishedAt!.getTime());
    expect(inst!.publicVisibleAt!.getTime()).toBe(
      computePublicVisibleAt(startsAt, "group").getTime(),
    );
  });

  it("CREATE CLASS: createClass inserts a born-PUBLISHED instance (all three stamps) and emits ONE schedule.published event", async () => {
    // Thursday of the far-future test week (inside the afterAll cleanup window),
    // at an off-baseline time so it collides with nothing. The Y-M-D is the
    // BANGKOK calendar day (weekStart is Bangkok midnight = 17:00Z the day
    // before, so toISOString().slice would be off by one).
    const thursday = new Date(weekStart);
    thursday.setDate(thursday.getDate() + 3); // Mon=+0 … Thu=+3
    const p = studioParts(thursday);
    const ymd = `${p.year}-${String(p.month0 + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    const TEST_TIME_C = "13:11";

    const events: { weekStart: string }[] = [];
    const off = on("schedule.published", async (e) => {
      events.push(e);
    });
    let res: Awaited<ReturnType<typeof createClass>>;
    try {
      res = await createClass({
        date: ymd,
        time: TEST_TIME_C,
        type: "group",
        durationMin: 60,
        capacity: 3,
        instructorId: null,
      });
      expect(res.ok).toBe(true);
      // Exactly ONE broadcast event, same payload shape as publishWeek's.
      expect(events.length).toBe(1);
    } finally {
      off();
    }
    if (!res.ok) throw new Error("createClass failed");

    const db = getDb();
    const [inst] = await db
      .select({
        status: classInstances.status,
        startsAt: classInstances.startsAt,
        publishedAt: classInstances.publishedAt,
        membersVisibleAt: classInstances.membersVisibleAt,
        publicVisibleAt: classInstances.publicVisibleAt,
      })
      .from(classInstances)
      .where(eq(classInstances.id, res.id))
      .limit(1);
    expect(inst).toBeTruthy();
    expect(inst!.status).toBe("published");
    expect(inst!.publishedAt).not.toBeNull();
    expect(inst!.membersVisibleAt).not.toBeNull();
    expect(inst!.publicVisibleAt).not.toBeNull();
    expect(inst!.membersVisibleAt!.getTime()).toBe(inst!.publishedAt!.getTime());
    expect(inst!.publicVisibleAt!.getTime()).toBe(
      computePublicVisibleAt(inst!.startsAt, "group").getTime(),
    );
  });
});
