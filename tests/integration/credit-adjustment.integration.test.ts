// DB-backed integration tests for the money-critical manual credit adjustment
// (Group D #8). The no-DB suite (tests/admin-credits.test.ts) pins the contract;
// the ATOMIC ledger write + reconciliation + idempotency only hold against a real
// interactive transaction, proven here end-to-end:
//
//   1. A +/- adjustment writes exactly ONE reason='adjustment' ledger row and moves
//      packages.hours_left by the same delta (cache == prior + Σ adjustment deltas).
//   2. NEGATIVE_BALANCE aborts the tx — no ledger row, hours_left untouched.
//   3. Ownership cross-check: a package outside the named customer's pool → UNKNOWN_PACKAGE.
//   4. Idempotent on idempotencyKey — a repeat (sequential AND concurrent) applies once.
//   5. OWNER-ONLY: ADMIN_AUTH=deny → UNAUTHORIZED with no mutation.
//
// Gated on DATABASE_URL (loaded by setup-env.ts); skips on the default no-DB run.
// Fixtures are owned by throwaway users and torn down in afterAll.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

// adjustCredits calls revalidatePath on success — stub next/cache for the test process.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { getDb, closeDb } from "@/lib/db/client";
import { creditLedger, packages, users } from "@/lib/db/schema";
import { adjustCredits } from "@/app/actions/admin-credits";

const HAS_DB = !!process.env.DATABASE_URL;
const uuid = () => crypto.randomUUID();

describe.skipIf(!HAS_DB)("manual credit adjustment (integration · requires DATABASE_URL)", () => {
  const tag = `ca_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  const pkgIds: string[] = [];

  async function makeGuest(): Promise<string> {
    const [u] = await getDb()
      .insert(users)
      .values({ phone: `${tag}-${userIds.length}`, name: tag, tier: "guest" })
      .returning({ id: users.id });
    userIds.push(u!.id);
    return u!.id;
  }
  async function makePackage(ownerUserId: string, hoursLeft: number): Promise<string> {
    const [p] = await getDb()
      .insert(packages)
      .values({
        type: "p10",
        category: "group",
        hoursTotal: Math.max(hoursLeft, 10),
        hoursLeft,
        expiresAt: new Date(Date.now() + 60 * 24 * 3_600_000),
        ownerUserId,
      })
      .returning({ id: packages.id });
    pkgIds.push(p!.id);
    return p!.id;
  }
  const hoursLeftOf = async (id: string) =>
    (await getDb().select({ h: packages.hoursLeft }).from(packages).where(eq(packages.id, id)))[0]!.h;
  const adjustmentRows = (pkgId: string) =>
    getDb()
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.packageId, pkgId), eq(creditLedger.reason, "adjustment")));

  beforeAll(() => {
    delete process.env.ADMIN_AUTH; // resolve the mock OWNER
  });

  afterAll(async () => {
    const db = getDb();
    if (pkgIds.length) {
      await db.delete(creditLedger).where(inArray(creditLedger.packageId, pkgIds));
      await db.delete(packages).where(inArray(packages.id, pkgIds));
    }
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await closeDb();
  });

  it("applies +/- deltas atomically; the cache reconciles to the ledger", async () => {
    const u = await makeGuest();
    const pkg = await makePackage(u, 10);

    const up = await adjustCredits({ customerId: u, packageId: pkg, deltaHours: 3, note: "comp", idempotencyKey: uuid() });
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.outcome.hoursLeft).toBe(13);

    const down = await adjustCredits({ customerId: u, packageId: pkg, deltaHours: -5, note: "correction", idempotencyKey: uuid() });
    expect(down.ok).toBe(true);
    if (down.ok) expect(down.outcome.hoursLeft).toBe(8);

    const rows = await adjustmentRows(pkg);
    expect(rows.length).toBe(2);
    const sum = rows.reduce((a, r) => a + r.delta, 0);
    expect(await hoursLeftOf(pkg)).toBe(10 + sum); // cache == prior + Σ deltas
  });

  it("NEGATIVE_BALANCE aborts the tx — no ledger row, balance untouched", async () => {
    const u = await makeGuest();
    const pkg = await makePackage(u, 2);
    const res = await adjustCredits({ customerId: u, packageId: pkg, deltaHours: -5, note: "x", idempotencyKey: uuid() });
    expect(res).toEqual({ ok: false, code: "NEGATIVE_BALANCE" });
    expect((await adjustmentRows(pkg)).length).toBe(0);
    expect(await hoursLeftOf(pkg)).toBe(2);
  });

  it("UNKNOWN_PACKAGE when the package is outside the named customer's pool", async () => {
    const a = await makeGuest();
    const b = await makeGuest();
    const pkgA = await makePackage(a, 5);
    const res = await adjustCredits({ customerId: b, packageId: pkgA, deltaHours: 1, note: "x", idempotencyKey: uuid() });
    expect(res).toEqual({ ok: false, code: "UNKNOWN_PACKAGE" });
    expect((await adjustmentRows(pkgA)).length).toBe(0);
  });

  it("is idempotent on idempotencyKey — sequential repeat applies once", async () => {
    const u = await makeGuest();
    const pkg = await makePackage(u, 10);
    const key = uuid();
    const first = await adjustCredits({ customerId: u, packageId: pkg, deltaHours: 4, note: "comp", idempotencyKey: key });
    const repeat = await adjustCredits({ customerId: u, packageId: pkg, deltaHours: 4, note: "comp", idempotencyKey: key });
    expect(first.ok && repeat.ok).toBe(true);
    if (first.ok && repeat.ok) expect(repeat.outcome.hoursLeft).toBe(first.outcome.hoursLeft);
    expect((await adjustmentRows(pkg)).length).toBe(1); // only ONE applied
    expect(await hoursLeftOf(pkg)).toBe(14);
  });

  it("is idempotent under a concurrent same-key race (23505 recovery)", async () => {
    const u = await makeGuest();
    const pkg = await makePackage(u, 10);
    const key = uuid();
    const both = await Promise.all([
      adjustCredits({ customerId: u, packageId: pkg, deltaHours: 2, note: "comp", idempotencyKey: key }),
      adjustCredits({ customerId: u, packageId: pkg, deltaHours: 2, note: "comp", idempotencyKey: key }),
    ]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect((await adjustmentRows(pkg)).length).toBe(1); // exactly one despite two calls
    expect(await hoursLeftOf(pkg)).toBe(12);
  });

  it("OWNER-ONLY: ADMIN_AUTH=deny → UNAUTHORIZED, no mutation", async () => {
    const u = await makeGuest();
    const pkg = await makePackage(u, 5);
    process.env.ADMIN_AUTH = "deny";
    const res = await adjustCredits({ customerId: u, packageId: pkg, deltaHours: 3, note: "x", idempotencyKey: uuid() });
    delete process.env.ADMIN_AUTH;
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect((await adjustmentRows(pkg)).length).toBe(0);
    expect(await hoursLeftOf(pkg)).toBe(5);
  });
});
