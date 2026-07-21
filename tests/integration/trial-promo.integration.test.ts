// DB-backed integration tests for the FIRST-TIME BUYER 1+1 PROMO (decided
// 2026-07-07): when a customer's FIRST-EVER paid purchase is the 1-hour group
// drop-in (catalog id "drop", ฿650), the package is born with ONE extra free trial
// hour — hours_total = hours_left = 2, carried by TWO ledger rows (+1 "purchase"
// AND +1 "promo") so the ledger stays the source of truth (sum of deltas ==
// hours_total, CLAUDE.md §5 inv 1/2).
//
// The rule lives INSIDE creditPackage's transaction (lib/credits/creditPackage.ts):
// eligibility = item.id === "drop" AND no OTHER paid charge exists for the recipient
// (charges.status = 'paid', userId = actorUserId, chargeId ≠ this one). This suite
// pins the four behavioral corners against a real DB:
//
//   1. first paid "drop"  → hoursAdded 2, package 2/2, +1 purchase AND +1 promo rows,
//      charge flipped to "paid";
//   2. SECOND "drop" by the same user → hoursAdded 1, package 1/1, NO promo row;
//   3. first purchase of "p10" → 10 hours, NO promo (drop-in only);
//   4. idempotent replay of the promo charge → created:false, hoursAdded 2 (the REAL
//      total granted, read back from hours_total — never a recomputed item.hours),
//      and still exactly one promo row / no double-credit.
//
// Tests 2 and 4 intentionally run AFTER test 1 on the same fixture user (vitest runs
// a file's tests sequentially) — that IS the scenario: a prior paid charge exists.
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

describe.skipIf(!HAS_DB)("first-purchase 1+1 trial promo (integration · requires DATABASE_URL)", () => {
  const run = `promo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  // DB-backed catalog: resolved async in beforeAll (see drizzle/0001_catalog_items.sql).
  let drop: CatalogItem; // ฿650 · 1h group drop-in — THE promo item (id "drop")
  let p10: CatalogItem; // 10h group pack — a non-promo control

  // Two throwaway GUESTS (owner = user_id satisfies the single-owner XOR): one walks
  // the drop-in promo journey (tests 1/2/4), one buys p10 first (test 3).
  let buyerId: string; // first-ever purchase = "drop"
  let packBuyerId: string; // first-ever purchase = "p10"
  const userIds: string[] = [];

  // The promo charge from test 1, replayed in test 4.
  let promoChargeId: string;

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

  /** ALL ledger rows for a package, oldest-first — promo assertions read the full set. */
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

  it("FIRST paid 'drop' purchase: born 2/2 with +1 purchase AND +1 promo ledger rows", async () => {
    promoChargeId = await mintPendingCharge(buyerId, drop, "first_drop");

    const outcome = await creditPackage({
      chargeId: promoChargeId,
      item: drop,
      owner: ownerOf(buyerId),
      actorUserId: buyerId,
    });

    expect(outcome.created).toBe(true);
    expect(outcome.hoursAdded).toBe(2); // the REAL grant: 1 bought + 1 promo
    expect(outcome.hoursLeft).toBe(2);

    const pkgs = await packagesForCharge(promoChargeId);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.hoursTotal).toBe(2);
    expect(pkgs[0]!.hoursLeft).toBe(2);

    // Ledger is the source of truth: exactly one +1 "purchase" and one +1 "promo",
    // and the deltas sum to hours_total (invariant 1/2 reconciliation).
    const rows = await ledgerFor(pkgs[0]!.id);
    expect(rows).toHaveLength(2);
    const purchase = rows.filter((r) => r.reason === "purchase");
    const promo = rows.filter((r) => r.reason === "promo");
    expect(purchase).toHaveLength(1);
    expect(purchase[0]!.delta).toBe(drop.hours);
    expect(promo).toHaveLength(1);
    expect(promo[0]!.delta).toBe(1);
    expect(promo[0]!.actorUserId).toBe(buyerId);
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(pkgs[0]!.hoursTotal);

    // The charge flipped to "paid" in the same transaction.
    expect(await chargeStatus(promoChargeId)).toBe("paid");
  });

  it("SECOND 'drop' purchase by the same user: 1/1, hoursAdded 1, NO promo row", async () => {
    const chargeId = await mintPendingCharge(buyerId, drop, "second_drop");

    const outcome = await creditPackage({
      chargeId,
      item: drop,
      owner: ownerOf(buyerId),
      actorUserId: buyerId,
    });

    expect(outcome.created).toBe(true);
    expect(outcome.hoursAdded).toBe(1); // no bonus — a paid charge already exists
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

  it("FIRST purchase of 'p10': 10 hours, NO promo (the bonus is drop-in only)", async () => {
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

  it("IDEMPOTENT REPLAY of the promo charge: created:false, hoursAdded still 2", async () => {
    expect(promoChargeId).toBeTruthy(); // set by test 1 (sequential in-file order)

    const replay = await creditPackage({
      chargeId: promoChargeId,
      item: drop,
      owner: ownerOf(buyerId),
      actorUserId: buyerId,
    });

    expect(replay.created).toBe(false);
    // The replay reports the REAL total the charge granted (from hours_total), not
    // a recomputed item.hours — the receipt stays truthful about the promo.
    expect(replay.hoursAdded).toBe(2);
    expect(replay.hoursLeft).toBe(2); // balance NOT doubled by the repeat

    // Still exactly one package, one purchase row, one promo row.
    const pkgs = await packagesForCharge(promoChargeId);
    expect(pkgs).toHaveLength(1);
    const rows = await ledgerFor(pkgs[0]!.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.reason === "promo")).toHaveLength(1);
  });
});
