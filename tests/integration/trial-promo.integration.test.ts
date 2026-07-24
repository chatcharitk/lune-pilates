// DB-backed integration tests for the FIRST-TIME BUYER 1+1 PROMO mechanism
// (introduced 2026-07-07, DISABLED by owner decision 2026-07-25 — see
// lib/credits/creditPackage.ts `promoBonusHours`, which now always returns 0).
//
// The promo previously granted an extra free trial hour on a first-ever paid
// purchase of the 1-hour group drop-in (catalog id "drop", ฿650). With it
// disabled, every purchase of any item grants EXACTLY its catalog hours —
// nothing extra, regardless of purchase history. This suite now pins that
// disabled reality against a real DB (rather than testing the dead promo path),
// while still exercising the same atomic-credit/ledger machinery the promo used
// to run through, so the transaction/idempotency coverage isn't lost:
//
//   1. first paid "drop"  → hoursAdded 1, package 1/1, ONE "purchase" ledger row,
//      NO "promo" row, charge flipped to "paid";
//   2. SECOND "drop" by the same user → still hoursAdded 1, still NO promo row
//      (repeat-purchase behavior is unaffected by the promo being off);
//   3. first purchase of "p10" → 10 hours, NO promo (never applied to non-drop
//      items either way);
//   4. idempotent replay of test 1's charge → created:false, hoursAdded still 1
//      (the REAL total granted, read back from hours_total), and still exactly
//      one purchase row / no double-credit.
//
// Gated on DATABASE_URL (loaded by setup-env.ts); skips under the no-DB `npm test`.
// Fixtures are per-run tagged and torn down FK-safely in afterAll (ledger → packages
// → charges → users), with closeDb in finally — mirrors
// tests/integration/admin-book-for-customer.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";

// Mirror the integration-suite pattern: neutralize next/cache for the plain test
// process (creditPackage itself doesn't revalidate, but keep the fixture uniform).
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { getDb, closeDb } from "@/lib/db/client";
import { charges, creditLedger, packages, users } from "@/lib/db/schema";
import { creditPackage } from "@/lib/credits/creditPackage";
import { getCatalogItem, type CatalogItem } from "@/lib/catalog/packages";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("first-purchase 1+1 trial promo — DISABLED (integration · requires DATABASE_URL)", () => {
  const run = `promo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  // DB-backed catalog: resolved async in beforeAll (see drizzle/0001_catalog_items.sql).
  let drop: CatalogItem; // ฿650 · 1h group drop-in — the item the promo USED to key off
  let p10: CatalogItem; // 10h group pack — a non-promo control

  // Two throwaway GUESTS (owner = user_id satisfies the single-owner XOR): one walks
  // the drop-in journey (tests 1/2/4), one buys p10 first (test 3).
  let buyerId: string; // first-ever purchase = "drop"
  let packBuyerId: string; // first-ever purchase = "p10"
  const userIds: string[] = [];

  // The charge from test 1, replayed in test 4.
  let firstDropChargeId: string;

  const ownerOf = (userId: string) => ({ ownerHouseholdId: null, ownerUserId: userId });

  /** Persist a pending purchase intent (what both POS/checkout paths write before
   *  crediting) so creditPackage has a charges row to flip to "paid". */
  async function mintPendingCharge(
    userId: string,
    item: { id: string; price: number },
    label: string,
  ): Promise<string> {
    const chargeId = `${run}_${label}_${Math.random().toString(36).slice(2, 10)}`;
    await getDb().insert(charges).values({
      chargeId,
      packageId: item.id,
      userId,
      amount: item.price,
      reference: chargeId,
      method: "promptpay",
      status: "pending",
    });
    return chargeId;
  }

  /** The package a charge credited (expected: exactly one after a grant). */
  const packagesForCharge = (chargeId: string) =>
    getDb().select().from(packages).where(eq(packages.purchaseChargeId, chargeId));

  /** ALL ledger rows for a package, oldest-first — assertions read the full set. */
  const ledgerFor = (packageId: string) =>
    getDb()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.packageId, packageId))
      .orderBy(asc(creditLedger.createdAt), asc(creditLedger.id));

  const chargeStatus = async (chargeId: string) => {
    const [ch] = await getDb().select().from(charges).where(eq(charges.chargeId, chargeId));
    return ch?.status;
  };

  beforeAll(async () => {
    drop = (await getCatalogItem("drop"))!;
    p10 = (await getCatalogItem("p10"))!;
    const db = getDb();
    const [a] = await db
      .insert(users)
      .values({ phone: `${run}-buyer`, name: `${run}-buyer`, tier: "guest" })
      .returning({ id: users.id });
    const [b] = await db
      .insert(users)
      .values({ phone: `${run}-pack`, name: `${run}-pack`, tier: "guest" })
      .returning({ id: users.id });
    buyerId = a!.id;
    packBuyerId = b!.id;
    userIds.push(buyerId, packBuyerId);
  });

  afterAll(async () => {
    try {
      const db = getDb();
      if (userIds.length) {
        // FK-safe order: ledger rows → packages → charges → users. (packages.
        // purchase_charge_id is a plain unique text, not an FK, so charges can go
        // after packages.)
        const pkgs = await db
          .select({ id: packages.id })
          .from(packages)
          .where(inArray(packages.ownerUserId, userIds));
        const pkgIds = pkgs.map((p) => p.id);
        if (pkgIds.length) {
          await db.delete(creditLedger).where(inArray(creditLedger.packageId, pkgIds));
        }
        await db.delete(creditLedger).where(inArray(creditLedger.actorUserId, userIds));
        await db.delete(packages).where(inArray(packages.ownerUserId, userIds));
        await db.delete(charges).where(inArray(charges.userId, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
    } finally {
      await closeDb();
    }
  });

  it("FIRST paid 'drop' purchase: 1/1, ONE purchase ledger row, NO promo row (promo disabled)", async () => {
    firstDropChargeId = await mintPendingCharge(buyerId, drop, "first_drop");

    const outcome = await creditPackage({
      chargeId: firstDropChargeId,
      item: drop,
      owner: ownerOf(buyerId),
      actorUserId: buyerId,
    });

    expect(outcome.created).toBe(true);
    expect(outcome.hoursAdded).toBe(1); // no bonus — the promo is off
    expect(outcome.hoursLeft).toBe(1);

    const pkgs = await packagesForCharge(firstDropChargeId);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.hoursTotal).toBe(1);
    expect(pkgs[0]!.hoursLeft).toBe(1);

    // Ledger is the source of truth: exactly one +1 "purchase" row, no "promo" row,
    // and the delta sums to hours_total (invariant 1/2 reconciliation).
    const rows = await ledgerFor(pkgs[0]!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("purchase");
    expect(rows[0]!.delta).toBe(drop.hours);
    expect(rows.filter((r) => r.reason === "promo")).toHaveLength(0);
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(pkgs[0]!.hoursTotal);

    // The charge flipped to "paid" in the same transaction.
    expect(await chargeStatus(firstDropChargeId)).toBe("paid");
  });

  it("SECOND 'drop' purchase by the same user: still 1/1, hoursAdded 1, NO promo row", async () => {
    const chargeId = await mintPendingCharge(buyerId, drop, "second_drop");

    const outcome = await creditPackage({
      chargeId,
      item: drop,
      owner: ownerOf(buyerId),
      actorUserId: buyerId,
    });

    expect(outcome.created).toBe(true);
    expect(outcome.hoursAdded).toBe(1);
    expect(outcome.hoursLeft).toBe(1);

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.hoursTotal).toBe(1);
    expect(pkgs[0]!.hoursLeft).toBe(1);

    const rows = await ledgerFor(pkgs[0]!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("purchase");
    expect(rows[0]!.delta).toBe(drop.hours);
  });

  it("FIRST purchase of 'p10': 10 hours, NO promo (never applied to non-drop items)", async () => {
    const chargeId = await mintPendingCharge(packBuyerId, p10, "first_p10");

    const outcome = await creditPackage({
      chargeId,
      item: p10,
      owner: ownerOf(packBuyerId),
      actorUserId: packBuyerId,
    });

    expect(outcome.created).toBe(true);
    expect(outcome.hoursAdded).toBe(10);
    expect(outcome.hoursLeft).toBe(10);

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.hoursTotal).toBe(10);

    const rows = await ledgerFor(pkgs[0]!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("purchase");
    expect(rows[0]!.delta).toBe(p10.hours);
  });

  it("IDEMPOTENT REPLAY of test 1's charge: created:false, hoursAdded still 1", async () => {
    expect(firstDropChargeId).toBeTruthy(); // set by test 1 (sequential in-file order)

    const replay = await creditPackage({
      chargeId: firstDropChargeId,
      item: drop,
      owner: ownerOf(buyerId),
      actorUserId: buyerId,
    });

    expect(replay.created).toBe(false);
    // The replay reports the REAL total the charge granted (from hours_total), not
    // a recomputed item.hours.
    expect(replay.hoursAdded).toBe(1);
    expect(replay.hoursLeft).toBe(1); // balance NOT doubled by the repeat

    // Still exactly one package, one purchase row, no promo row.
    const pkgs = await packagesForCharge(firstDropChargeId);
    expect(pkgs).toHaveLength(1);
    const rows = await ledgerFor(pkgs[0]!.id);
    expect(rows).toHaveLength(1);
    expect(rows.filter((r) => r.reason === "promo")).toHaveLength(0);
  });
});
