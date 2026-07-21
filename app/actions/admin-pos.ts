"use server";

// Server actions for the admin "Payments & POS" screen (spec §4: "POS checkout:
// Sell packages & retail, take PromptPay or cash, issue a receipt."; prototype
// admin-mobile-pos.jsx `MPos`/`MPayFlow`). These are the typed contracts the
// frontend imports and calls directly.
//
// Every action is OWNER-ONLY: gated by `requireOwner()` (lib/auth/admin.ts — v1
// mock provider; the real staff/LINE provider swaps in at `getAdminAuth()`). An
// instructor is rejected like unauth (UNAUTHORIZED). The gate is line 1 of the
// body, BEFORE input parsing and the no-DB branch, so it can never be reordered
// past them (see tests/admin-auth.test.ts).
//
// MONEY IS RECOMPUTED SERVER-SIDE (CLAUDE.md §8): the client supplies only a
// customerId, a catalog packageId, and the tender method. The price, the hours, the
// validity, and — critically — WHO OWNS the resulting balance are all resolved
// server-side from the catalog + the customer's DB row. The admin never supplies a
// balance, price, or owner.
//
// OWNER RESOLUTION (invariants 2 & 3): the package is credited to the TARGET
// customer's pool — a member with a household credits the SHARED household pool
// (owner = household_id); a guest (or member without a household) credits their OWN
// (owner = user_id), non-transferable. We resolve this from the DB via
// `loadPoolOwner`, never from the session admin and never from the client.
//
// CREDITING goes through the SAME atomic, idempotent primitive the customer flow
// uses (`lib/credits/creditPackage.ts` → `creditPackage`), so a POS sale can never
// double-credit and reconciles to the ledger exactly like a self-purchase
// (CLAUDE.md §5 invariant 1). Cash credits immediately; PromptPay credits on
// confirm.
//
// SCOPE (v1): PACKAGE sales with PromptPay + Cash only. Retail items and Card
// payment are OUT of scope — no products model exists yet (see the TODOs below); do
// not build one here. A true walk-in (no account) cannot receive package credits,
// because a package needs an owner to credit — `customerId` is therefore REQUIRED.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { charges } from "@/lib/db/schema";
import { getCatalogItem, type CatalogItem } from "@/lib/catalog/packages";
import { itemForCredit, termsSnapshotFor } from "@/lib/catalog/chargeTerms";
import { getPaymentProvider } from "@/lib/payments";
import { loadPoolOwner } from "@/lib/credits/selectPackage";
import { creditPackage, ownerForPool, type CreditOwner } from "@/lib/credits/creditPackage";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── shared owner resolution ─────────────────────────

/**
 * Resolve where a sale to `customerId` lands: the customer's pool, recomputed from
 * the DB (member→household, guest→own — invariants 2 & 3). Returns null when the
 * customer doesn't exist. NEVER trusts a client-supplied owner/tier/household.
 */
async function resolveOwnerFor(customerId: string): Promise<CreditOwner | null> {
  const target = await loadPoolOwner(customerId);
  if (!target) return null;
  return ownerForPool(target);
}

// ───────────────────────── sell package ─────────────────────────

const posSellInput = z.object({
  /** REQUIRED: a package sale needs an owner to credit — no true-walk-in package sale. */
  customerId: z.string().uuid(),
  /** Catalog item id (e.g. "p10"); price/hours/validity resolved server-side from it. */
  packageId: z.string().min(1),
  method: z.enum(["promptpay", "cash"]),
  /**
   * Client-generated idempotency token (one per sale attempt, REUSED across retries
   * of the same sale). For CASH it becomes the charge/credit key, so a dropped-
   * response retry or a double-tap can't double-credit (a retry reuses the token →
   * the package `purchase_charge_id` UNIQUE dedupes it). PromptPay doesn't need it
   * (the provider's chargeId is already stable across confirms).
   */
  idempotencyKey: z.string().uuid(),
});
export type PosSellPackageInput = z.infer<typeof posSellInput>;

export type PosSellFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_PACKAGE"
  | "UNKNOWN_CUSTOMER";

/** The receipt for a CASH sale — credited immediately. */
export interface PosCashReceipt {
  method: "cash";
  chargeId: string;
  /** The package row that holds the credited balance. */
  packageId: string;
  /** Credits granted by this sale. */
  hoursAdded: number;
  /** The new usable balance on the credited package. */
  hoursLeft: number;
  /** Authoritative THB amount charged (from the catalog). */
  amount: number;
  /** Where the balance landed (household pool XOR user) — for the receipt. */
  owner: CreditOwner;
}

/** The pending PromptPay charge for a QR sale — credited later on confirm. */
export interface PosPromptPaySale {
  method: "promptpay";
  chargeId: string;
  /** EMVCo QR payload the client renders as a PromptPay QR. */
  qrPayload: string;
  /** Authoritative THB amount the charge was opened for (from the catalog). */
  amount: number;
  reference: string;
}

export type PosSellPackageResult =
  | { ok: true; sale: PosCashReceipt | PosPromptPaySale }
  | { ok: false; code: PosSellFailureCode };

/**
 * Sell a package at the front desk to `customerId`, tendered by `method`.
 *
 * CASH → credit the package IMMEDIATELY via the shared atomic primitive, recording
 * a `charges` row with `status="paid", method="cash"`. The chargeId is SYNTHESIZED
 * deterministically (`cash_<packageId>_<customerId>_<instant>`) so the package's
 * `purchaseChargeId` unique constraint still guarantees idempotency — a retried
 * cash sale with the same synthesized id can't double-credit. The charge row is
 * written first (intent) then credited, mirroring the PromptPay lifecycle but
 * collapsed into one front-desk step. Returns the receipt (hours added, balance,
 * owner) for the "+N hrs → customer" confirmation.
 *
 * PROMPTPAY → open a PromptPay charge bound server-side to { packageId, customerId,
 * amount }, recording `status="pending", method="promptpay"`, and return the QR.
 * NOTHING is credited yet — crediting happens in `posConfirmPayment` once the
 * provider reports paid (so a charge is never credited before it is paid, exactly
 * like the customer flow).
 *
 * No-DB dev path: returns ok with synthesized values so the UI works on mock data.
 *
 * TODO(retail): retail (non-package) line items have no owner to credit and no
 * products model — out of scope for v1; add a `products` table + a retail sale path
 * when the catalog grows beyond packages.
 */
export async function posSellPackage(raw: PosSellPackageInput): Promise<PosSellPackageResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = posSellInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { customerId, packageId, method, idempotencyKey } = parsed.data;
  const now = new Date();

  // Resolve the item server-side — the ONLY trusted source of price/hours (§8).
  const item = await getCatalogItem(packageId);
  if (!item) {
    return { ok: false, code: "UNKNOWN_PACKAGE" };
  }

  if (mockDataMode()) {
    // UI dev against mock data — synthesize a believable sale for the chosen tender.
    if (method === "cash") {
      return {
        ok: true,
        sale: {
          method: "cash",
          chargeId: `cash_${idempotencyKey}`,
          packageId: "00000000-0000-4000-8000-0000000000d1",
          hoursAdded: item.hours,
          hoursLeft: item.hours,
          amount: item.price,
          owner: { ownerHouseholdId: null, ownerUserId: customerId },
        },
      };
    }
    return {
      ok: true,
      sale: {
        method: "promptpay",
        chargeId: `mock_${item.id}`,
        qrPayload: `MOCKPROMPTPAY|${item.price}|pos_${item.id}|mock`,
        amount: item.price,
        reference: `pos_${item.id}_u_${customerId}`,
      },
    };
  }

  // Resolve WHO the credit belongs to from the DB (member→household, guest→own).
  const owner = await resolveOwnerFor(customerId);
  if (!owner) {
    return { ok: false, code: "UNKNOWN_CUSTOMER" };
  }

  if (method === "cash") {
    return await sellForCash({ customerId, item, owner, idempotencyKey, now });
  }
  return await sellForPromptPay({ customerId, item, now });
}

/**
 * Cash path: persist a paid `charges` row then credit ONCE via the shared primitive.
 * The synthesized chargeId is the idempotency key (package.purchase_charge_id
 * unique), so a retried sale resolves to the same already-credited package.
 */
async function sellForCash(params: {
  customerId: string;
  item: CatalogItem;
  owner: CreditOwner;
  idempotencyKey: string;
  now: Date;
}): Promise<PosSellPackageResult> {
  const { customerId, item, owner, idempotencyKey, now } = params;
  const db = getDb();

  // The chargeId IS the client's idempotency token, so a retried sale (dropped
  // response, double-tap) reuses the same key → the package `purchase_charge_id`
  // UNIQUE constraint dedupes it and `creditPackage` returns the already-credited
  // balance instead of granting a second package. A genuinely separate cash sale
  // carries a fresh token from the client and credits anew.
  const chargeId = `cash_${idempotencyKey}`;
  const reference = `pos_cash_${item.id}_u_${customerId}_${idempotencyKey}`;

  // Persist the intent first (the front-desk equivalent of createCheckout) so the
  // payments ledger reflects the sale even if the credit throws; creditPackage flips
  // it to "paid" inside the same transaction as the package + ledger row. Tolerate a
  // retried identical chargeId (do-nothing) so the credit's own idempotency governs.
  await db
    .insert(charges)
    .values({
      chargeId,
      packageId: item.id,
      userId: customerId,
      amount: item.price,
      reference,
      method: "cash",
      status: "pending",
      // Freeze the purchased terms with the price (lib/catalog/chargeTerms.ts). The
      // cash path credits in the same breath so the window is tiny, but the snapshot
      // is what the receipt and any later reconciliation read back.
      ...termsSnapshotFor(item),
    })
    .onConflictDoNothing();

  // Credit immediately — cash is tendered at the desk, so it is paid on sale.
  // A retried sale (same idempotency key) reuses the ALREADY-STORED snapshot, so a
  // catalog edit between the first attempt and the retry can't change the grant.
  const [stored] = await db
    .select({ hours: charges.hours, validity: charges.validity, category: charges.category })
    .from(charges)
    .where(eq(charges.chargeId, chargeId))
    .limit(1);
  const granted = stored ? itemForCredit(item, stored) : item;

  const outcome = await creditPackage({
    chargeId,
    item: granted,
    owner,
    actorUserId: customerId,
    now,
  });

  await emitPurchased({ outcome, customerId, owner });

  revalidatePath("/admin/payments");
  return {
    ok: true,
    sale: {
      method: "cash",
      chargeId,
      packageId: outcome.packageId,
      hoursAdded: outcome.hoursAdded,
      hoursLeft: outcome.hoursLeft,
      amount: item.price,
      owner,
    },
  };
}

/**
 * PromptPay path: open a charge bound to { packageId, customerId, amount } and
 * return the QR. Crediting is deferred to `posConfirmPayment` — nothing is credited
 * here.
 */
async function sellForPromptPay(params: {
  customerId: string;
  item: CatalogItem;
  now: Date;
}): Promise<PosSellPackageResult> {
  const { customerId, item, now } = params;
  const db = getDb();

  const reference = `pos_${item.id}_u_${customerId}_${now.getTime()}`;
  const charge = await getPaymentProvider().createPromptPayCharge({
    amount: item.price,
    reference,
  });

  // Bind the provider chargeId to exactly what it pays for + WHO it credits — the
  // authoritative source confirm reads, never the client (§8).
  await db.insert(charges).values({
    chargeId: charge.chargeId,
    packageId: item.id,
    userId: customerId,
    amount: item.price,
    reference: charge.reference,
    method: "promptpay",
    status: "pending",
    // Freeze the purchased terms with the price — posConfirmPayment credits from
    // this snapshot, not from the (editable) live catalog item.
    ...termsSnapshotFor(item),
  });

  return {
    ok: true,
    sale: {
      method: "promptpay",
      chargeId: charge.chargeId,
      qrPayload: charge.qrPayload,
      amount: charge.amount,
      reference: charge.reference,
    },
  };
}

// ───────────────────────── confirm PromptPay ─────────────────────────

const posConfirmInput = z.object({
  chargeId: z.string().min(1),
});
export type PosConfirmPaymentInput = z.infer<typeof posConfirmInput>;

export type PosConfirmFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  // No charge intent persisted for this chargeId — never opened (or already gone).
  | "UNKNOWN_CHARGE"
  // The charge's stored packageId no longer resolves to a catalog item (drift).
  | "UNKNOWN_PACKAGE"
  // The charge's bound customer no longer resolves to a pool owner (deleted).
  | "UNKNOWN_CUSTOMER"
  | "NOT_PAID";

export interface PosConfirmReceipt {
  chargeId: string;
  packageId: string;
  hoursAdded: number;
  hoursLeft: number;
  /** true when this confirm actually created the package; false on a repeat confirm. */
  created: boolean;
  owner: CreditOwner;
}

export type PosConfirmPaymentResult =
  | { ok: true; receipt: PosConfirmReceipt }
  | { ok: false; code: PosConfirmFailureCode };

/**
 * Admin confirm for the PromptPay POS path: verify the charge is paid, then credit
 * ONCE via the shared primitive — to the CHARGE'S BOUND CUSTOMER (resolved from the
 * stored `userId`), not the session admin. Idempotent: a repeat confirm returns the
 * already-credited balance (creditPackage's unique-constraint guarantee).
 *
 * Everything authoritative is read from the persisted charge (§8): the recipient,
 * the item (via the stored packageId), and the amount. The admin supplies only the
 * chargeId. Mirrors the customer `confirmPayment` but with a DB-resolved recipient
 * instead of the session user.
 *
 * No-DB dev path: returns ok with synthesized values so the UI works on mock data.
 */
export async function posConfirmPayment(
  raw: PosConfirmPaymentInput,
): Promise<PosConfirmPaymentResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = posConfirmInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { chargeId } = parsed.data;
  const now = new Date();

  if (mockDataMode()) {
    return {
      ok: true,
      receipt: {
        chargeId,
        packageId: "00000000-0000-4000-8000-0000000000d2",
        hoursAdded: 10,
        hoursLeft: 10,
        created: true,
        owner: { ownerHouseholdId: null, ownerUserId: "00000000-0000-4000-8000-000000000001" },
      },
    };
  }

  const db = getDb();
  const [intent] = await db
    .select()
    .from(charges)
    .where(eq(charges.chargeId, chargeId))
    .limit(1);
  if (!intent) {
    return { ok: false, code: "UNKNOWN_CHARGE" };
  }

  // Resolve the item from the STORED packageId — never the client's (§8). The live
  // item supplies the LABEL and the catalog id; the HOURS / VALIDITY / CATEGORY that
  // are actually granted come from the charge's own purchased-terms snapshot, so a
  // catalog edit between opening the QR and confirming it cannot change what this
  // already-paid charge is worth (lib/catalog/chargeTerms.ts). Pre-snapshot charges
  // (null columns) fall back to the live item, as before.
  const live = await getCatalogItem(intent.packageId);
  if (!live) {
    return { ok: false, code: "UNKNOWN_PACKAGE" };
  }
  const item = itemForCredit(live, intent);

  // Resolve the recipient's pool from the charge's bound customer, from the DB.
  const owner = await resolveOwnerFor(intent.userId);
  if (!owner) {
    return { ok: false, code: "UNKNOWN_CUSTOMER" };
  }

  // Verify payment before crediting. Fail closed on anything not an explicit "paid".
  const status = await getPaymentProvider().getStatus(chargeId);
  if (status !== "paid") {
    return { ok: false, code: "NOT_PAID" };
  }

  // The recipient (whose credit it is) is the ledger actor, mirroring the customer
  // flow's actor semantics — the audit of who STAFFED the sale is a separate concern.
  const outcome = await creditPackage({
    chargeId,
    item,
    owner,
    actorUserId: intent.userId,
    now,
  });

  await emitPurchased({ outcome, customerId: intent.userId, owner });

  revalidatePath("/admin/payments");
  return {
    ok: true,
    receipt: {
      chargeId,
      packageId: outcome.packageId,
      hoursAdded: outcome.hoursAdded,
      hoursLeft: outcome.hoursLeft,
      created: outcome.created,
      owner,
    },
  };
}

// ───────────────────────── events ─────────────────────────

/**
 * Emit `credit.purchased` after a successful credit — the SAME domain event the
 * customer flow emits, so the CRM stays a thin listener (one truth, never a parallel
 * one — CLAUDE.md §5/§6). Best-effort: a failing handler never breaks the sale.
 */
async function emitPurchased(params: {
  outcome: { packageId: string; hoursAdded: number; hoursLeft: number };
  customerId: string;
  owner: CreditOwner;
}): Promise<void> {
  const { outcome, customerId, owner } = params;
  registerNotificationHandlers();
  await emit({
    type: "credit.purchased",
    packageId: outcome.packageId,
    userId: customerId,
    ownerHouseholdId: owner.ownerHouseholdId,
    ownerUserId: owner.ownerUserId,
    hours: outcome.hoursAdded,
    hoursLeft: outcome.hoursLeft,
  });
}
