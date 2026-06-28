// DB-backed integration test for the customer credit-ledger READ MODEL
// (lib/admin/members.ts getCustomerLedger).
//
// The no-DB unit suite (tests/admin-members.test.ts) pins the mock rows + the running
// balance math; this proves the SAME read model against a real Postgres and the core
// reconciliation invariant: the NEWEST row's balanceAfter (the running sum of every
// delta) equals the package's current `hours_left` (the ledger is the source of
// truth, invariants 1/2). It also confirms newest-first ordering and that an unknown
// customer returns [] rather than throwing.
//
// Fixtures: a throwaway guest owns one package; ledger rows are written by hand with
// staggered created_at so the ordering + running balance are deterministic. The
// package's hours_left is set to the sum of the deltas so the reconciliation holds.
// Teardown removes everything referencing the user. Safe to point at the shared dev DB.
//
// Gated: requires DATABASE_URL (loaded from .env by setup-env.ts); skips when unset so
// the default no-DB `npm test` stays green.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { getDb, closeDb } from "@/lib/db/client";
import { creditLedger, packages, users } from "@/lib/db/schema";
import { getCustomerLedger } from "@/lib/admin/members";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("getCustomerLedger reconciliation (integration · requires DATABASE_URL)", () => {
  const tag = `cl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let userId: string;
  let packageId: string;

  // Append-only ledger deltas (oldest → newest). Running totals: 10, 9, 8, 11.
  const DELTAS = [10, -1, -1, 3];
  const SUM = DELTAS.reduce((s, d) => s + d, 0); // 11 → the package's hours_left

  beforeAll(async () => {
    const db = getDb();
    const [u] = await db
      .insert(users)
      .values({ phone: `${tag}-cust`, name: tag, tier: "guest" })
      .returning({ id: users.id });
    userId = u!.id;

    // Guest ⇒ owner = user_id (satisfies the single-owner XOR). hours_left = Σ deltas
    // so the newest balanceAfter reconciles to the cached balance.
    const [p] = await db
      .insert(packages)
      .values({
        type: "p10",
        category: "group",
        hoursTotal: 10,
        hoursLeft: SUM,
        expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
        ownerUserId: userId,
      })
      .returning({ id: packages.id });
    packageId = p!.id;

    // Write the ledger rows with staggered created_at so ordering is deterministic.
    const base = Date.now() - DELTAS.length * 60_000;
    const reasons = ["purchase", "booking", "booking", "adjustment"] as const;
    for (let i = 0; i < DELTAS.length; i++) {
      await db.insert(creditLedger).values({
        packageId,
        delta: DELTAS[i]!,
        actorUserId: userId,
        reason: reasons[i]!,
        idempotencyKey: reasons[i] === "adjustment" ? `${tag}-adj-${i}` : null,
        createdAt: new Date(base + i * 60_000),
      });
    }
  });

  afterAll(async () => {
    try {
      const db = getDb();
      const pkgIds = (
        await db.select({ id: packages.id }).from(packages).where(eq(packages.ownerUserId, userId))
      ).map((r) => r.id);
      if (pkgIds.length) {
        await db.delete(creditLedger).where(inArray(creditLedger.packageId, pkgIds));
        await db.delete(packages).where(inArray(packages.id, pkgIds));
      }
      await db.delete(users).where(eq(users.id, userId));
    } finally {
      await closeDb();
    }
  });

  it("returns rows newest-first with a running balance that reconciles to hours_left", async () => {
    const rows = await getCustomerLedger(userId);
    expect(rows.length).toBe(DELTAS.length);

    // Newest-first by createdAt.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.createdAt >= rows[i]!.createdAt).toBe(true);
    }

    // The newest row's balanceAfter = Σ all deltas = the package's hours_left.
    expect(rows[0]!.balanceAfter).toBe(SUM);
    const [pkg] = await getDb()
      .select({ hoursLeft: packages.hoursLeft })
      .from(packages)
      .where(eq(packages.id, packageId))
      .limit(1);
    expect(rows[0]!.balanceAfter).toBe(pkg!.hoursLeft);

    // Running balances newest-first = reverse of the ascending accumulation: 11, 8, 9, 10.
    expect(rows.map((r) => r.balanceAfter)).toEqual([11, 8, 9, 10]);
  });

  it("an unknown customer returns [] (no throw)", async () => {
    await expect(
      getCustomerLedger("00000000-0000-4000-8000-0000000000ff"),
    ).resolves.toEqual([]);
  });
});
