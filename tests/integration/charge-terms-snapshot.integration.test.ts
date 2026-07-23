// DB-backed integration tests for the PURCHASED-TERMS SNAPSHOT on `charges`
// (lib/catalog/chargeTerms.ts, drizzle/0002_charge_terms_snapshot.sql).
//
// THE BUG THIS PINS. The catalog became owner-editable at runtime, but `charges`
// only froze the PRICE (`amount`) — the hours, validity and category were re-resolved
// LIVE at approval time. A slip can sit in `awaiting_review` for hours or days, so:
//
//   customer opens checkout for a 10h / ฿5,500 pack and uploads a slip
//     → owner edits that item to 20h
//       → front desk approves → 20 HOURS GRANTED FOR A ฿5,500 PAYMENT.
//
// The reverse (10h → 5h) shortchanges someone who already paid, and the ledger records
// nothing about the mismatch — a CLAUDE.md §8 violation in substance: the customer paid
// against terms the server no longer honours. Same window for `validity` (the expiry
// was recomputed from the CURRENT validity) and for the POS confirm path.
//
// The fix snapshots hours/validity/category onto the charge at creation and credits
// from THAT. These specs prove it end-to-end against a real database, plus:
//   - the LEGACY path: a charge whose snapshot columns are NULL (written before the
//     migration) still credits from the live item, exactly as before;
//   - audit H1: ARCHIVING an item mid-flight no longer changes what a pending charge
//     grants — the snapshot makes it correct by construction.
//
// REQUIRES drizzle/0002_charge_terms_snapshot.sql to have been applied.
// Gated on DATABASE_URL; skips cleanly without it. Fixtures are uniquely tagged and
// torn down in afterAll.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

// approveSlip / posConfirmPayment call revalidatePath — stub it outside Next.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

import { getDb, closeDb } from "@/lib/db/client";
import {
  catalogItems,
  charges,
  creditLedger,
  packages,
  paymentSlips,
  users,
} from "@/lib/db/schema";
import { approveSlip } from "@/app/actions/admin-payments";
import { createCatalogItem, updateCatalogItem, archiveCatalogItem } from "@/app/actions/admin-catalog";
import { expiryFromValidity } from "@/lib/catalog/validity";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("purchased-terms snapshot (integration · requires DATABASE_URL)", () => {
  const tag = `zzts${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
  let userId: string;
  const itemIds: string[] = [];

  /** A fresh 10h / ฿5,500 / two_months group item, created through the real action. */
  async function makeItem(suffix: string): Promise<string> {
    const id = `${tag}-${suffix}`;
    itemIds.push(id);
    const res = await createCatalogItem({
      id,
      category: "group",
      hours: 10,
      price: 5500,
      validityAmount: 2,
      validityUnit: "month",
      labelEn: "10 hours",
      labelTh: "10 ชั่วโมง",
    });
    if (!res.ok) throw new Error(`fixture item create failed: ${res.code}`);
    return id;
  }

  /**
   * A charge in `awaiting_review` with a slip attached — the exact state a customer
   * checkout + slip upload leaves behind. `snapshot` false writes the LEGACY shape
   * (null terms columns) that pre-migration rows have.
   */
  async function makeAwaitingCharge(params: {
    itemId: string;
    snapshot: boolean;
    hours?: number;
    validity?: string;
  }): Promise<string> {
    const db = getDb();
    const chargeId = `${tag}_${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(charges).values({
      chargeId,
      packageId: params.itemId,
      userId,
      amount: 5500,
      reference: chargeId,
      method: "promptpay",
      status: "awaiting_review",
      ...(params.snapshot
        ? {
            hours: params.hours ?? 10,
            validity: params.validity ?? "two_months",
            category: "group" as const,
          }
        : {}),
    });
    await db.insert(paymentSlips).values({
      chargeId,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      storageKey: chargeId,
      mimeType: "image/png",
      sizeBytes: 12,
      uploadedByUserId: userId,
    });
    return chargeId;
  }

  beforeAll(async () => {
    delete process.env.ADMIN_AUTH;
    delete process.env.ADMIN_ROLE;
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
      await db.delete(paymentSlips).where(eq(paymentSlips.uploadedByUserId, userId));
      await db.delete(charges).where(eq(charges.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
      if (itemIds.length) {
        await db.delete(catalogItems).where(inArray(catalogItems.id, itemIds));
      }
      await db.delete(catalogItems).where(like(catalogItems.id, `${tag}-%`));
    } finally {
      await closeDb();
    }
  });

  // ─────────────── the headline scenario ───────────────

  it("EDIT 10h → 20h while the slip is pending: approval still grants the 10h that was PAID for", async () => {
    const itemId = await makeItem("edit-up");
    const chargeId = await makeAwaitingCharge({ itemId, snapshot: true });

    // The owner doubles the pack AFTER the customer paid and BEFORE the desk approves.
    const edit = await updateCatalogItem({
      id: itemId,
      hours: 20,
      price: 5500,
      validityAmount: 2,
      validityUnit: "month",
      labelEn: "20 hours",
      labelTh: "20 ชั่วโมง",
    });
    expect(edit.ok).toBe(true);

    const res = await approveSlip({ chargeId });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(`approve failed: ${res.code}`);

    // The money answer: 10, not 20. ฿5,500 bought ten hours.
    expect(res.receipt.hoursAdded).toBe(10);
    expect(res.receipt.hoursLeft).toBe(10);

    // …and the ledger — the source of truth — agrees.
    const db = getDb();
    const [pkg] = await db.select().from(packages).where(eq(packages.id, res.receipt.packageId));
    expect(pkg!.hoursTotal).toBe(10);
    expect(pkg!.hoursLeft).toBe(10);
    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.packageId, res.receipt.packageId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.delta).toBe(10);
  });

  it("EDIT 10h → 5h: the customer who already paid is NOT shortchanged either", async () => {
    const itemId = await makeItem("edit-down");
    const chargeId = await makeAwaitingCharge({ itemId, snapshot: true });

    const edit = await updateCatalogItem({
      id: itemId,
      hours: 5,
      price: 5500,
      validityAmount: 2,
      validityUnit: "month",
      labelEn: "5 hours",
      labelTh: "5 ชั่วโมง",
    });
    expect(edit.ok).toBe(true);

    const res = await approveSlip({ chargeId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.hoursAdded).toBe(10); // the terms sold, not today's
  });

  it("EDIT validity two_months → three_months: expiry still comes from the PAID validity", async () => {
    const itemId = await makeItem("edit-validity");
    const chargeId = await makeAwaitingCharge({ itemId, snapshot: true });

    const edit = await updateCatalogItem({
      id: itemId,
      hours: 10,
      price: 5500,
      validityAmount: 3,
      validityUnit: "month",
      labelEn: "10 hours",
      labelTh: "10 ชั่วโมง",
    });
    expect(edit.ok).toBe(true);

    const before = new Date();
    const res = await approveSlip({ chargeId });
    const after = new Date();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [pkg] = await getDb().select().from(packages).where(eq(packages.id, res.receipt.packageId));
    const expiresAt = new Date(pkg!.expiresAt).getTime();

    // Two months from approval (the snapshot), NOT three (the edited item). Bracketed
    // by the call window so the assertion doesn't race the clock.
    expect(expiresAt).toBeGreaterThanOrEqual(expiryFromValidity(2, "month", before).getTime() - 1000);
    expect(expiresAt).toBeLessThanOrEqual(expiryFromValidity(2, "month", after).getTime() + 1000);
    // And comfortably short of the three-month window the live item now advertises.
    expect(expiresAt).toBeLessThan(expiryFromValidity(3, "month", before).getTime() - 86_400_000);
  });

  // ─────────────── audit H1: the archive window ───────────────

  it("H1: ARCHIVING the item mid-flight does not change what the pending charge grants", async () => {
    const itemId = await makeItem("archived");
    const chargeId = await makeAwaitingCharge({ itemId, snapshot: true });

    expect((await archiveCatalogItem(itemId)).ok).toBe(true);

    // Archived items still RESOLVE (guardrail 3) so the label is available, and the
    // grant comes from the snapshot — so the archive window is closed by construction.
    const res = await approveSlip({ chargeId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.hoursAdded).toBe(10);
  });

  it("H1: archived AND edited is still exactly the paid terms", async () => {
    const itemId = await makeItem("arch-edit");
    const chargeId = await makeAwaitingCharge({ itemId, snapshot: true });

    expect(
      (
        await updateCatalogItem({
          id: itemId,
          hours: 99,
          price: 1,
          validityAmount: 3,
          validityUnit: "month",
          labelEn: "99 hours",
          labelTh: "99 ชั่วโมง",
        })
      ).ok,
    ).toBe(true);
    expect((await archiveCatalogItem(itemId)).ok).toBe(true);

    const res = await approveSlip({ chargeId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.hoursAdded).toBe(10);
  });

  // ─────────────── the legacy fallback ───────────────

  it("LEGACY: a charge with NULL snapshot columns credits from the live item, as before", async () => {
    const itemId = await makeItem("legacy");
    // Pre-migration shape: no hours/validity/category on the charge.
    const chargeId = await makeAwaitingCharge({ itemId, snapshot: false });

    const [row] = await getDb()
      .select({ hours: charges.hours, validity: charges.validity, category: charges.category })
      .from(charges)
      .where(eq(charges.chargeId, chargeId));
    expect(row!.hours).toBeNull();
    expect(row!.validity).toBeNull();
    expect(row!.category).toBeNull();

    const res = await approveSlip({ chargeId });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(`approve failed: ${res.code}`);
    expect(res.receipt.hoursAdded).toBe(10); // == the live item's hours
  });

  it("LEGACY: with no snapshot, a catalog edit DOES still move the grant (documented fallback)", async () => {
    // Not a bug — the terms those rows were sold under were never recorded, so the
    // live item is the only answer available. Pinned so the fallback stays deliberate
    // and anyone tightening it sees the trade-off spelled out.
    const itemId = await makeItem("legacy-edit");
    const chargeId = await makeAwaitingCharge({ itemId, snapshot: false });

    expect(
      (
        await updateCatalogItem({
          id: itemId,
          hours: 20,
          price: 5500,
          validityAmount: 2,
          validityUnit: "month",
          labelEn: "20 hours",
          labelTh: "20 ชั่วโมง",
        })
      ).ok,
    ).toBe(true);

    const res = await approveSlip({ chargeId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.hoursAdded).toBe(20);
  });

  // ─────────────── partial snapshots fail safe ───────────────

  it("a HALF-written snapshot is treated as legacy, never mixed with live values", async () => {
    const itemId = await makeItem("partial");
    const db = getDb();
    const chargeId = `${tag}_partial_${Math.random().toString(36).slice(2, 8)}`;
    // hours present, validity/category null — must NOT credit 7h on a 2-month window
    // stitched together from two different sources.
    await db.insert(charges).values({
      chargeId,
      packageId: itemId,
      userId,
      amount: 5500,
      reference: chargeId,
      method: "promptpay",
      status: "awaiting_review",
      hours: 7,
    });
    await db.insert(paymentSlips).values({
      chargeId,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      storageKey: chargeId,
      mimeType: "image/png",
      sizeBytes: 12,
      uploadedByUserId: userId,
    });

    const res = await approveSlip({ chargeId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.hoursAdded).toBe(10); // whole live item, not the stray 7
  });
});
