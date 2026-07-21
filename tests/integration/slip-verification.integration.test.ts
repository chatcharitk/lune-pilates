// DB-backed integration tests for the PromptPay slip upload → admin verification
// flow (Feature 3). The money-critical guarantees here can only be proven against a
// real interactive transaction + the packages.purchase_charge_id UNIQUE backstop:
//
//   1. uploadPaymentSlip → the charge moves to awaiting_review and NO credit exists.
//   2. approveSlip → exactly ONE package + ONE +hours ledger row; the charge flips to
//      "paid"; the recipient's balance increases by the package hours.
//   3. DOUBLE approveSlip (sequential AND concurrent) → still exactly ONE credit
//      (idempotency via the unique backstop) — never a double-credit.
//   4. rejectSlip → the charge is "rejected", NO credit; a re-upload then moves it
//      back to awaiting_review (UPSERT) so the customer can try again.
//
// Gated: requires DATABASE_URL (loaded by setup-env.ts). Skips entirely when unset so
// the default no-DB `npm test` is unaffected. Fixtures are owned by one throwaway
// guest and torn down in afterAll, safe against the shared dev DB.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

// The admin actions call revalidatePath, which throws outside a Next request scope.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

// getCurrentUser resolves the session viewer; uploadPaymentSlip checks the charge
// owner against it. Stub it to the throwaway fixture user (set in beforeAll).
const sessionMock = vi.hoisted(() => ({ current: "" }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: sessionMock.current,
    name: "Slip Fixture",
    tier: "guest" as const,
    householdId: null,
    houseNumber: null,
  })),
}));

import { getDb, closeDb } from "@/lib/db/client";
import { charges, creditLedger, packages, paymentSlips, users } from "@/lib/db/schema";
import { getCatalogItem, type CatalogItem } from "@/lib/catalog/packages";
import { uploadPaymentSlip } from "@/app/actions/purchase";
import { approveSlip, rejectSlip, getSlip } from "@/app/actions/admin-payments";

const HAS_DB = !!process.env.DATABASE_URL;

// A real 1x1 PNG — passes the server-side magic-byte sniff in lib/payments/slip.ts.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe.skipIf(!HAS_DB)("slip verification (integration · requires DATABASE_URL)", () => {
  const tag = `slip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // DB-backed catalog: resolved async in beforeAll (see drizzle/0001_catalog_items.sql).
  let item: CatalogItem; // 10h group pack
  let userId: string;

  const packagesForCharge = (chargeId: string) =>
    getDb().select().from(packages).where(eq(packages.purchaseChargeId, chargeId));
  const purchaseLedgerFor = (packageId: string) =>
    getDb()
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.packageId, packageId), eq(creditLedger.reason, "purchase")));
  const chargeRow = async (chargeId: string) => {
    const [c] = await getDb().select().from(charges).where(eq(charges.chargeId, chargeId)).limit(1);
    return c;
  };

  /** Open a fresh pending PromptPay charge owned by the fixture user; returns its id. */
  async function openCharge(prefix: string): Promise<string> {
    const chargeId = `${tag}_${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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

  beforeAll(async () => {
    delete process.env.ADMIN_AUTH; // POS/admin auth gate resolves the mock admin
    process.env.STORAGE_MODE = "mock";
    item = (await getCatalogItem("p10"))!;
    const db = getDb();
    const [u] = await db
      .insert(users)
      .values({ phone: `${tag}-cust`, name: tag, tier: "guest" })
      .returning({ id: users.id });
    userId = u!.id;
    sessionMock.current = userId;
  });

  afterEach(() => {
    sessionMock.current = userId; // restore after any per-test override
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
      // Slips reference charges; delete slips for this user's charges first.
      const myCharges = await db
        .select({ chargeId: charges.chargeId })
        .from(charges)
        .where(eq(charges.userId, userId));
      const chargeIds = myCharges.map((c) => c.chargeId);
      if (chargeIds.length) {
        await db.delete(paymentSlips).where(inArray(paymentSlips.chargeId, chargeIds));
      }
      await db.delete(packages).where(eq(packages.ownerUserId, userId));
      await db.delete(charges).where(eq(charges.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    } finally {
      await closeDb();
    }
  });

  // ─────────────────────── 1. upload → awaiting_review, no credit ───────────────────────

  it("upload moves the charge to awaiting_review and grants NO credit", async () => {
    const chargeId = await openCharge("up");

    const res = await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });
    expect(res.ok).toBe(true);

    expect((await chargeRow(chargeId))!.status).toBe("awaiting_review");
    expect(await packagesForCharge(chargeId)).toHaveLength(0); // NO credit on upload

    // The slip is admin-viewable (PII behind requireAdmin).
    const slip = await getSlip({ chargeId });
    expect(slip.ok).toBe(true);
    if (slip.ok) {
      expect(slip.slip.mimeType).toBe("image/png");
      expect(slip.slip.dataUrl).toBe(PNG_DATA_URL);
    }
  });

  // ─────────────────────── 2. approve → exactly one credit ───────────────────────

  it("approveSlip credits exactly once, flips to paid, and increases the balance", async () => {
    const chargeId = await openCharge("approve");
    await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });

    const res = await approveSlip({ chargeId });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(`approve failed: ${res.code}`);
    expect(res.receipt.created).toBe(true);
    expect(res.receipt.hoursAdded).toBe(item.hours);
    expect(res.receipt.hoursLeft).toBe(item.hours);
    expect(res.receipt.owner).toEqual({ ownerHouseholdId: null, ownerUserId: userId });

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.hoursLeft).toBe(item.hours);
    expect(await purchaseLedgerFor(pkgs[0]!.id)).toHaveLength(1);
    expect((await chargeRow(chargeId))!.status).toBe("paid");
    expect((await chargeRow(chargeId))!.reviewedAt).not.toBeNull();
  });

  // ─────────────────────── 3. double approve → still one credit ───────────────────────

  it("SEQUENTIAL double approve credits exactly once (idempotent)", async () => {
    const chargeId = await openCharge("seq");
    await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });

    const first = await approveSlip({ chargeId });
    const second = await approveSlip({ chargeId });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected two ok approvals");
    expect(first.receipt.created).toBe(true);
    expect(second.receipt.created).toBe(false); // the repeat created nothing
    expect(second.receipt.packageId).toBe(first.receipt.packageId);
    expect(second.receipt.hoursLeft).toBe(item.hours); // balance NOT doubled

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(await purchaseLedgerFor(pkgs[0]!.id)).toHaveLength(1);
  });

  it("CONCURRENT double approve credits exactly once (idempotent under a race)", async () => {
    const chargeId = await openCharge("conc");
    await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });

    const RACERS = 8;
    const results = await Promise.all(
      Array.from({ length: RACERS }, () => approveSlip({ chargeId })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const created = results.filter((r) => r.ok && r.receipt.created);
    expect(created).toHaveLength(1); // exactly one real credit across the race

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(await purchaseLedgerFor(pkgs[0]!.id)).toHaveLength(1);
    expect(pkgs[0]!.hoursLeft).toBe(item.hours); // never doubled
  });

  // ─────────────────────── 4. reject → no credit, re-upload allowed ───────────────────────

  it("rejectSlip leaves no credit; a re-upload then returns to awaiting_review", async () => {
    const chargeId = await openCharge("reject");
    await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });

    const rej = await rejectSlip({ chargeId, reason: "Amount does not match" });
    expect(rej.ok).toBe(true);
    const afterReject = await chargeRow(chargeId);
    expect(afterReject!.status).toBe("rejected");
    expect(afterReject!.rejectionReason).toBe("Amount does not match");
    expect(await packagesForCharge(chargeId)).toHaveLength(0); // NO credit

    // Re-upload after rejection is allowed (UPSERT) → back to awaiting_review.
    const reUpload = await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });
    expect(reUpload.ok).toBe(true);
    const afterReupload = await chargeRow(chargeId);
    expect(afterReupload!.status).toBe("awaiting_review");
    expect(afterReupload!.rejectionReason).toBeNull(); // cleared on re-upload
    expect(await packagesForCharge(chargeId)).toHaveLength(0); // still no credit

    // Still exactly one slip row for the charge (UPSERT replaced, not appended).
    const slips = await getDb()
      .select()
      .from(paymentSlips)
      .where(eq(paymentSlips.chargeId, chargeId));
    expect(slips).toHaveLength(1);
    expect(slips[0]!.reviewDecision).toBeNull(); // review reset on re-upload

    // And it can now be approved → exactly one credit.
    const ok = await approveSlip({ chargeId });
    expect(ok.ok).toBe(true);
    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(await purchaseLedgerFor(pkgs[0]!.id)).toHaveLength(1);
  });

  // ─────────────────── 5. charge-status guards on approve/upload ───────────────────

  it("approving a REJECTED charge → NOT_REVIEWABLE and grants no credit", async () => {
    const chargeId = await openCharge("rejnorev");
    await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });
    const rej = await rejectSlip({ chargeId, reason: "Wrong account" });
    expect(rej.ok).toBe(true);
    expect((await chargeRow(chargeId))!.status).toBe("rejected");

    // A slip exists (NO_SLIP would mask the guard), but the charge is not reviewable.
    const res = await approveSlip({ chargeId });
    expect(res).toEqual({ ok: false, code: "NOT_REVIEWABLE" });

    // No credit was granted, and the charge stays rejected.
    expect(await packagesForCharge(chargeId)).toHaveLength(0);
    expect((await chargeRow(chargeId))!.status).toBe("rejected");
  });

  it("approving an ALREADY-PAID charge → idempotent ok, still exactly one credit", async () => {
    const chargeId = await openCharge("paididem");
    await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });

    const first = await approveSlip({ chargeId });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(`first approve failed: ${first.code}`);
    expect(first.receipt.created).toBe(true);
    expect((await chargeRow(chargeId))!.status).toBe("paid");

    // The charge is now 'paid'. A repeat approve must NOT return NOT_REVIEWABLE — it is
    // an idempotent success that returns the already-credited balance (created=false).
    const second = await approveSlip({ chargeId });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(`second approve failed: ${second.code}`);
    expect(second.receipt.created).toBe(false);
    expect(second.receipt.packageId).toBe(first.receipt.packageId);
    expect(second.receipt.hoursLeft).toBe(item.hours); // NOT doubled

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(await purchaseLedgerFor(pkgs[0]!.id)).toHaveLength(1);
  });

  it("uploading onto an already-PAID charge → ALREADY_PAID, no new slip churn", async () => {
    const chargeId = await openCharge("paidupload");
    await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });
    const approved = await approveSlip({ chargeId });
    expect(approved.ok).toBe(true);
    expect((await chargeRow(chargeId))!.status).toBe("paid");

    // Re-uploading after the charge is paid is rejected; the charge stays 'paid' and the
    // balance is untouched (the conditional `status <> 'paid'` flip affects zero rows).
    const reUpload = await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });
    expect(reUpload).toEqual({ ok: false, code: "ALREADY_PAID" });
    expect((await chargeRow(chargeId))!.status).toBe("paid");

    const pkgs = await packagesForCharge(chargeId);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.hoursLeft).toBe(item.hours); // never re-opened / re-credited
    expect(await purchaseLedgerFor(pkgs[0]!.id)).toHaveLength(1);
  });
});
