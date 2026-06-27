// DB-backed integration tests for the money-critical at-most-once credit grant.
//
// The no-DB unit suite (tests/admin-pos.test.ts) can only pin owner resolution and
// the action contract; the ACTUAL idempotency guarantee lives in a real interactive
// transaction + the packages.purchase_charge_id UNIQUE constraint, which can only be
// proven against a database. A real double-credit bug already slipped past the no-DB
// tests once (the POS cash idempotency key used a per-call timestamp), so this suite
// exercises the guarantee end-to-end at the DB layer:
//
//   1. creditPackage with the SAME chargeId — sequentially AND concurrently — credits
//      exactly once (one package row, one +hours ledger row, same packageId, the
//      repeat reports created:false).
//   2. posSellPackage({ method:"cash" }) with the SAME idempotencyKey credits once;
//      with DIFFERENT keys credits twice.
//   3. The unique-violation recovery path is forced deterministically (a committed
//      concurrent insert) and must resolve the loser to idempotent success — never
//      throw, never double-credit. This is the exact path the err.cause.code bug hid.
//
// Gated: requires DATABASE_URL (loaded from .env by setup-env.ts). When unset the
// whole block skips, so it never breaks the default no-DB `npm test`. Fixtures are
// owned by a single throwaway user and torn down in afterAll, so it is safe to point
// at the shared dev DB (mirrors scripts/verify-*.ts).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { Pool } from "@neondatabase/serverless";

// posSellPackage's DB path calls revalidatePath, which throws outside a Next request
// scope. Stub next/cache so the action runs in a plain test process. (creditPackage
// and the purchase flow don't touch next/cache; only the admin POS does.)
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

import { getDb, closeDb } from "@/lib/db/client";
import { charges, creditLedger, packages, users } from "@/lib/db/schema";
import { creditPackage } from "@/lib/credits/creditPackage";
import { getCatalogItem } from "@/lib/catalog/packages";
import { posSellPackage } from "@/app/actions/admin-pos";

const HAS_DB = !!process.env.DATABASE_URL;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!HAS_DB)("credit grant at-most-once (integration · requires DATABASE_URL)", () => {
  // A throwaway guest owns every fixture this run creates, so teardown is a clean
  // "delete everything referencing this user". Guest ⇒ owner = user_id (XOR), which
  // satisfies the schema's single-owner check and the owner_user_id FK.
  const tag = `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const item = getCatalogItem("p10")!; // 10h group pack — the canonical catalog item
  let userId: string;

  const ownerOf = () => ({ ownerHouseholdId: null, ownerUserId: userId });
  const mintCharge = (prefix: string) => `${tag}_${prefix}_${Math.random().toString(36).slice(2, 10)}`;

  /** Packages credited by `chargeId` (expected: exactly one). */
  const packagesForCharge = (chargeId: string) =>
    getDb().select().from(packages).where(eq(packages.purchaseChargeId, chargeId));

  /** The `+hours` purchase ledger rows for a package (expected: exactly one). */
  const purchaseLedgerFor = (packageId: string) =>
    getDb()
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.packageId, packageId), eq(creditLedger.reason, "purchase")));

  beforeAll(async () => {
    delete process.env.ADMIN_AUTH; // ensure the POS auth gate resolves the mock admin
    const db = getDb();
    const [u] = await db
      .insert(users)
      .values({ phone: `${tag}-cust`, name: tag, tier: "guest" })
      .returning({ id: users.id });
    userId = u!.id;
  });

  afterAll(async () => {
    try {
      const db = getDb();
      const mine = await db
        .select({ id: packages.id })
        .from(packages)
        .where(eq(packages.ownerUserId, userId));
      const pkgIds = mine.map((p) => p.id);
      if (pkgIds.length) {
        await db.delete(creditLedger).where(inArray(creditLedger.packageId, pkgIds));
      }
      await db.delete(creditLedger).where(eq(creditLedger.actorUserId, userId));
      await db.delete(packages).where(eq(packages.ownerUserId, userId));
      await db.delete(charges).where(eq(charges.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    } finally {
      await closeDb();
    }
  });

  // ─────────────────────── 1. creditPackage idempotency ───────────────────────

  it("SEQUENTIAL: the same chargeId credits exactly once and flips the charge to paid", async () => {
    const db = getDb();
    const chargeId = mintCharge("seq");

    // A pending intent lets us also assert the in-transaction status flip.
    await db.insert(charges).values({
      chargeId,
      packageId: item.id,
      userId,
      amount: item.price,
      reference: chargeId,
      method: "promptpay",
      status: "pending",
    });

    const first = await creditPackage({ chargeId, item, owner: ownerOf(), actorUserId: userId });
    const second = await creditPackage({ chargeId, item, owner: ownerOf(), actorUserId: userId });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.packageId).toBe(first.packageId);
    expect(first.hoursLeft).toBe(item.hours);
    expect(second.hoursLeft).toBe(item.hours); // balance NOT doubled by the repeat

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.hoursLeft).toBe(item.hours);

    const ledger = await purchaseLedgerFor(pkgs[0]!.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.delta).toBe(item.hours);

    const [ch] = await db.select().from(charges).where(eq(charges.chargeId, chargeId));
    expect(ch!.status).toBe("paid");
  });

  it("CONCURRENT: racing credits of one chargeId all succeed, crediting exactly once", async () => {
    const chargeId = mintCharge("conc");
    const RACERS = 8;

    // If recovery were broken, the losing racers would throw and Promise.all would
    // reject — so a clean resolve is itself proof every duplicate was absorbed.
    const results = await Promise.all(
      Array.from({ length: RACERS }, () =>
        creditPackage({ chargeId, item, owner: ownerOf(), actorUserId: userId }),
      ),
    );

    expect(results).toHaveLength(RACERS);
    expect(results.filter((r) => r.created)).toHaveLength(1); // exactly one real credit
    expect(new Set(results.map((r) => r.packageId)).size).toBe(1); // all see one package
    expect(results.every((r) => r.hoursLeft === item.hours)).toBe(true);

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    const ledger = await purchaseLedgerFor(pkgs[0]!.id);
    expect(ledger).toHaveLength(1);
  });

  it("RECOVERY: a committed concurrent insert forces the 23505 catch → idempotent success", async () => {
    // Determinism the racy CONCURRENT test can't guarantee: hold a competing insert
    // OPEN so creditPackage's pre-check sees nothing, let its own insert BLOCK on the
    // unique index, then COMMIT — its insert then fails 23505 and must recover by
    // re-reading the now-committed row (name-agnostic: any 23505 + findByCharge).
    const db = getDb();
    const chargeId = mintCharge("recover");
    const racer = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await racer.connect();
    let committed = false;

    try {
      await client.query("BEGIN");
      const expiresAt = new Date(Date.now() + 60 * 86_400_000).toISOString();
      const ins = await client.query<{ id: string }>(
        `insert into packages (type, category, hours_total, hours_left, expires_at, owner_user_id, purchase_charge_id)
         values ($1, 'group', $2, $2, $3, $4, $5) returning id`,
        [item.id, item.hours, expiresAt, userId, chargeId],
      );
      const winnerPkgId = ins.rows[0]!.id;
      await client.query(
        `insert into credit_ledger (package_id, delta, actor_user_id, reason)
         values ($1, $2, $3, 'purchase')`,
        [winnerPkgId, item.hours, userId],
      );

      // Launch (do NOT await) so it reaches and blocks on its own insert, THEN commit.
      const pending = creditPackage({ chargeId, item, owner: ownerOf(), actorUserId: userId });
      await sleep(400);
      await client.query("COMMIT");
      committed = true;

      const outcome = await pending; // must resolve, not throw
      expect(outcome.created).toBe(false);
      expect(outcome.packageId).toBe(winnerPkgId);
      expect(outcome.hoursLeft).toBe(item.hours);
    } finally {
      if (!committed) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // best-effort
        }
      }
      client.release();
      await racer.end();
    }

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1); // the loser created no second package
    const ledger = await purchaseLedgerFor(pkgs[0]!.id);
    expect(ledger).toHaveLength(1); // and no second +hours row
  });

  // ─────────────────────── 2. posSellPackage cash idempotency ───────────────────────

  describe("posSellPackage cash", () => {
    it("SAME idempotencyKey twice → exactly one credit (no double-credit)", async () => {
      const idempotencyKey = crypto.randomUUID();
      const args = { customerId: userId, packageId: "p10", method: "cash" as const, idempotencyKey };

      const first = await posSellPackage(args);
      const second = await posSellPackage(args);

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("expected two ok cash sales");
      if (first.sale.method !== "cash" || second.sale.method !== "cash") {
        throw new Error("expected cash receipts");
      }
      const chargeId = `cash_${idempotencyKey}`;
      expect(first.sale.chargeId).toBe(chargeId);
      expect(second.sale.packageId).toBe(first.sale.packageId); // same package, not a new one
      expect(second.sale.hoursLeft).toBe(10); // balance not doubled

      const pkgs = await packagesForCharge(chargeId);
      expect(pkgs).toHaveLength(1);
      expect(pkgs[0]!.hoursLeft).toBe(10);
      const ledger = await purchaseLedgerFor(pkgs[0]!.id);
      expect(ledger).toHaveLength(1);
    });

    it("DIFFERENT idempotencyKeys → two distinct credits", async () => {
      const k1 = crypto.randomUUID();
      const k2 = crypto.randomUUID();

      const r1 = await posSellPackage({ customerId: userId, packageId: "p5", method: "cash", idempotencyKey: k1 });
      const r2 = await posSellPackage({ customerId: userId, packageId: "p5", method: "cash", idempotencyKey: k2 });

      expect(r1.ok && r2.ok).toBe(true);
      if (!r1.ok || !r2.ok || r1.sale.method !== "cash" || r2.sale.method !== "cash") {
        throw new Error("expected two cash receipts");
      }
      expect(r1.sale.packageId).not.toBe(r2.sale.packageId);

      const p1 = await packagesForCharge(`cash_${k1}`);
      const p2 = await packagesForCharge(`cash_${k2}`);
      expect(p1).toHaveLength(1);
      expect(p2).toHaveLength(1);
      expect(p1[0]!.hoursLeft).toBe(5);
      expect(p2[0]!.hoursLeft).toBe(5);

      expect(await purchaseLedgerFor(p1[0]!.id)).toHaveLength(1);
      expect(await purchaseLedgerFor(p2[0]!.id)).toHaveLength(1);
    });
  });
});
