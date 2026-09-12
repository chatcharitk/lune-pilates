"use server";

// Server actions for the customer "Buy credits / PromptPay" flow. These are the
// typed contracts the frontend imports and calls directly.
//
// Security (CLAUDE.md §8): the client only supplies a catalog item id. Everything
// money-critical — identity, tier, household, the price, the hours granted, and
// who owns the resulting balance — is resolved/recomputed server-side from the
// catalog and the session. No client-supplied price, hour count, or owner is ever
// trusted.
//
// Feature 3 (slip verification) split the flow into THREE steps so MONEY IS GRANTED
// ONLY ON ADMIN APPROVE — the always-paid mock provider is no longer a money gate:
//   createCheckout()     → look up the item, open a PromptPay charge, return the QR.
//   uploadPaymentSlip()  → the customer uploads their transfer slip; the charge moves
//                          to "awaiting_review". NO credit is granted here.
//   (admin) approveSlip()→ the front desk verifies the slip and credits ONCE via the
//                          shared primitive (app/actions/admin-payments.ts).
//
// The actual atomic, idempotent credit lives in the SHARED primitive
// `lib/credits/creditPackage.ts` (`creditPackage`), reused by the admin POS
// (app/actions/admin-pos.ts) and the slip approval so there is ONE money-critical
// credit path. Idempotency (approving the same charge twice must not double-credit)
// is guaranteed there two ways: a pre-check inside the transaction returns the
// existing balance, and the UNIQUE constraint on packages.purchase_charge_id is the
// hard backstop for races.
//
// `confirmPayment()` no longer credits — it only REPORTS the charge's lifecycle
// status so the UI can poll while the slip is in review. The money gate moved to the
// admin approval (see above), so the always-"paid" mock provider can never grant
// credits for an unpaid PromptPay.

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { charges, paymentSlips } from "@/lib/db/schema";
import { getCatalogItem, type CatalogItem } from "@/lib/catalog/packages";
import { termsSnapshotFor } from "@/lib/catalog/chargeTerms";
import { componentsForItem, isBundle, totalHours } from "@/lib/catalog/components";
import { hasEverPurchased, isItemPurchasableBy } from "@/lib/catalog/eligibility";
import {
  evaluatePromoCode,
  isValidPromoCodeShape,
  type PromoCode,
  type PromoRefusal,
} from "@/lib/promos/codes";
import { loadPromoCode, loadPromoUsage } from "@/lib/promos/queries";
import { promoRedemptions } from "@/lib/db/schema";
import { serializeComponentsSnapshot } from "@/lib/catalog/componentsSnapshot";
import { loadActiveTerms, SEED_TERMS } from "@/lib/settings/terms";
import { getPaymentProvider } from "@/lib/payments";
import { validateSlipDataUrl } from "@/lib/payments/slip";
import { getSlipStorage } from "@/lib/storage";
import type { Bilingual } from "@/lib/i18n";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { and, eq, ne } from "drizzle-orm";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── create checkout ─────────────────────────

const createCheckoutInput = z.object({
  packageId: z.string().min(1),
  /**
   * The id of the Terms & Conditions version the customer was shown and ticked to
   * accept. Not a permission — an ACKNOWLEDGEMENT the server re-validates against
   * the currently-active version (see TERMS_OUTDATED below).
   */
  termsVersionId: z.string().min(1),
  /**
   * An optional event discount code. Only the STRING crosses the wire — the server
   * loads the code, re-checks its window/caps/applicability and recomputes the
   * price. A client-supplied discount is never trusted (CLAUDE.md §8).
   */
  promoCode: z.string().trim().max(32).optional(),
});
export type CreateCheckoutInput = z.infer<typeof createCheckoutInput>;

/** A display-only summary of the item being purchased (safe to render). */
export interface CheckoutItemSummary {
  id: string;
  category: CatalogItem["category"];
  hours: number;
  /** Authoritative price in THB (integer) — resolved from the catalog, not the client. */
  price: number;
  perHour: number;
  validity: CatalogItem["validity"];
  label: Bilingual;
  sublabel: Bilingual;
}

export type CreateCheckoutFailureCode =
  | "INVALID_INPUT"
  | "UNKNOWN_PACKAGE"
  /**
   * The customer ticked a T&C version that is no longer the active one — the owner
   * published new terms while this buy screen was open. The purchase is refused so
   * nobody is ever bound to text they did not read; the UI re-fetches and re-shows
   * the current terms for a fresh acceptance.
   */
  | "TERMS_OUTDATED"
  /**
   * A first-purchase-only offer (the trial) attempted by a customer who has already
   * bought before. Server-side rule — the buy screen hides such items, but the gate
   * here is what actually enforces it (CLAUDE.md §8).
   */
  | "NOT_ELIGIBLE"
  /**
   * The promo code could not be applied. The specific reason travels alongside in
   * `promoRefusal` so the buy screen can say "that code has run out" rather than a
   * flat "invalid code" — which is what generates front-desk phone calls.
   */
  | "PROMO_REJECTED";

export interface CheckoutSession {
  chargeId: string;
  /** EMVCo QR payload the client renders as a PromptPay QR. */
  qrPayload: string;
  /** THB amount (integer) the charge was opened for — from the catalog. */
  amount: number;
  /** Opaque reference tying the charge to this user + item (verified on confirm). */
  reference: string;
  item: CheckoutItemSummary;
  /** The applied code + what it took off, when one was used. Display only. */
  promo?: { code: string; label: Bilingual; discount: number; originalAmount: number };
}

export type CreateCheckoutResult =
  | { ok: true; checkout: CheckoutSession }
  | { ok: false; code: CreateCheckoutFailureCode; promoRefusal?: PromoRefusal };

/**
 * Open a PromptPay charge for the catalog item `packageId`. Resolves the price
 * and hours from the server-side catalog (never the client) and returns the QR
 * payload plus a display summary. Does NOT credit anything — credit is granted only
 * when an admin approves the uploaded slip (Feature 3:
 * app/actions/admin-payments.ts → approveSlip). confirmPayment only REPORTS status.
 */
export async function createCheckout(raw: CreateCheckoutInput): Promise<CreateCheckoutResult> {
  const parsed = createCheckoutInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  const item = await getCatalogItem(parsed.data.packageId);
  if (!item) {
    return { ok: false, code: "UNKNOWN_PACKAGE" };
  }

  // T&C CONSENT GATE (2026-09-07). The customer must have ticked the CURRENTLY
  // active terms. Re-resolved here server-side: the client tells us which version
  // it displayed, and if the owner has published a newer one since that screen
  // loaded we refuse rather than binding the customer to unseen text. A charge is
  // never opened without a recorded acceptance.
  const activeTerms = await loadActiveTerms();
  if (parsed.data.termsVersionId !== activeTerms.id) {
    return { ok: false, code: "TERMS_OUTDATED" };
  }
  const termsAcceptedAt = new Date();

  const viewer = await getCurrentUser();

  // FIRST-PURCHASE GATE. A trial offer is only for someone who has never bought.
  // Checked here rather than trusted from the client, which only ever sends an item id.
  if (item.firstPurchaseOnly && !isItemPurchasableBy(item, await hasEverPurchased(viewer.id))) {
    return { ok: false, code: "NOT_ELIGIBLE" };
  }

  // PROMO CODE. Optional; when present the server loads it, re-checks its window,
  // caps and applicability, and recomputes what is owed. Nothing about the discount
  // comes from the client beyond the code string itself.
  let promo: { code: PromoCode; discount: number; amount: number } | null = null;
  if (parsed.data.promoCode && parsed.data.promoCode.trim() !== "") {
    const typed = parsed.data.promoCode;
    if (!isValidPromoCodeShape(typed)) {
      return { ok: false, code: "PROMO_REJECTED", promoRefusal: "NOT_FOUND" };
    }
    const loaded = await loadPromoCode(typed);
    if (!loaded) {
      return { ok: false, code: "PROMO_REJECTED", promoRefusal: "NOT_FOUND" };
    }
    const usage = await loadPromoUsage(loaded.code, viewer.id);
    const evaluated = evaluatePromoCode({
      code: loaded,
      item: { id: item.id, category: item.category, price: item.price },
      redemptionsUsed: usage.total,
      redemptionsByCustomer: usage.byCustomer,
      // A first-purchase-only CODE asks the same question the trial ITEM does.
      hasPurchasedBefore: await hasEverPurchased(viewer.id),
      now: new Date(),
    });
    if (!evaluated.ok) {
      return { ok: false, code: "PROMO_REJECTED", promoRefusal: evaluated.reason };
    }
    promo = { code: loaded, discount: evaluated.discount, amount: evaluated.amount };
  }

  /** What the customer actually pays — the catalog price unless a code applied. */
  const chargeAmount = promo ? promo.amount : item.price;

  // Resolve what this item actually grants. A plain item yields its single implicit
  // component (nothing to snapshot); a BUNDLE yields several, which are frozen onto
  // the charge below so a later edit cannot change this purchase.
  const components = await componentsForItem(item);
  const bundleComponents = isBundle(components) ? components : null;

  // Reference ties the charge to this user + item + an instant, so confirm can be
  // audited and a stray confirm can't credit a different item. Amount comes from
  // the catalog — the client never gets to set what is charged.
  const reference = `pkg_${item.id}_u_${viewer.id}_${Date.now()}`;

  const charge = await getPaymentProvider().createPromptPayCharge({
    amount: chargeAmount,
    reference,
  });

  // Persist the server-derived intent BEFORE returning the QR: this binds the
  // provider's chargeId to exactly { packageId, userId, amount } as resolved from
  // the catalog + session. confirmPayment treats this row — not the client — as the
  // authoritative source of what the charge pays for (CLAUDE.md §8). Amount, hours,
  // owner and recipient are all server-derived; the client never gets to set them.
  // (No-DB dev path: skip persisting — the mock provider's QR still renders, so the
  // whole checkout UI is exercisable without a database.)
  if (!mockDataMode()) {
    await getDb()
      .insert(charges)
      .values({
        chargeId: charge.chargeId,
        packageId: item.id,
        userId: viewer.id,
        amount: chargeAmount,
        // Why `amount` differs from the catalog price. Frozen here so editing or
        // retiring the code later cannot change what this charge was billed, and so
        // the front desk can match a transfer slip against the original price.
        promoCode: promo?.code.code ?? null,
        promoDiscount: promo?.discount ?? null,
        originalAmount: promo ? item.price : null,
        reference: charge.reference,
        // The consent record: WHICH terms this customer accepted, and when. Because
        // terms_versions is append-only, this stays a verbatim pointer to the exact
        // text they saw, however many times the owner rewrites the T&C later.
        //
        // The id is stored ONLY when the active version is a real row. An unseeded
        // database serves SEED_TERMS, whose synthetic id has no row to reference —
        // writing it would violate the foreign key and fail the whole checkout. The
        // acceptance TIMESTAMP is always recorded either way, so consent is never
        // silently missing; the version pointer is simply null until the owner
        // publishes their own terms (which is the first thing Settings does).
        termsVersionId: activeTerms.id === SEED_TERMS.id ? null : activeTerms.id,
        termsAcceptedAt,
        // Freeze the BUNDLE SHAPE too, for the same reason: components are
        // owner-editable, so re-resolving them at approval time would let an edit
        // change what an already-paid purchase grants. Null for a plain item —
        // there is nothing to freeze and crediting resolves its single implicit
        // component either way.
        componentsJson: bundleComponents
          ? serializeComponentsSnapshot(bundleComponents)
          : null,
        // Freeze the PURCHASED TERMS alongside the price. The catalog is
        // owner-editable at runtime, and this charge may sit in awaiting_review for
        // days — approveSlip credits from this snapshot so an edit to the item can
        // never retroactively change what an already-paid charge grants
        // (lib/catalog/chargeTerms.ts).
        ...termsSnapshotFor(item),
      });

    // Claim the redemption slot IN THE SAME breath as the charge. Recording it now
    // (rather than at approval) is what stops a capped code overselling while
    // several people pay at once; charge_id is the primary key there, so a retried
    // checkout cannot consume a second slot. If the charge is later cancelled or
    // rejected the row stays as audit but stops counting, handing the slot back.
    if (promo) {
      await getDb().insert(promoRedemptions).values({
        chargeId: charge.chargeId,
        code: promo.code.code,
        userId: viewer.id,
        discountAmount: promo.discount,
      });
    }
  }

  return {
    ok: true,
    checkout: {
      chargeId: charge.chargeId,
      qrPayload: charge.qrPayload,
      amount: charge.amount,
      reference: charge.reference,
      ...(promo
        ? {
            promo: {
              code: promo.code.code,
              label: promo.code.label,
              discount: promo.discount,
              originalAmount: item.price,
            },
          }
        : {}),
      item: {
        id: item.id,
        category: item.category,
        // For a BUNDLE this is the total across every component (the trial grants 2
        // private credits + 1 group = 3), so the receipt and the "+N hours" line
        // state what the customer actually receives rather than just the paid half.
        hours: totalHours(components),
        price: item.price,
        perHour: item.perHour,
        validity: item.validity,
        label: item.label,
        sublabel: item.sublabel,
      },
    },
  };
}

// ───────────────────────── upload payment slip ─────────────────────────

const uploadSlipInput = z.object({
  chargeId: z.string().min(1),
  /** A `data:<mime>;base64,…` URL of the transfer slip image (validated server-side). */
  slipDataUrl: z.string().min(1),
});
export type UploadPaymentSlipInput = z.infer<typeof uploadSlipInput>;

export type UploadPaymentSlipFailureCode =
  | "INVALID_INPUT"
  // No charge intent persisted for this chargeId — never opened (or already gone).
  | "UNKNOWN_CHARGE"
  // The session viewer is not the user who opened this charge.
  | "FORBIDDEN"
  // The decoded image is not a JPEG/PNG/WebP (sniffed magic bytes, not the prefix).
  | "INVALID_FILE"
  // The decoded image exceeds 5 MB.
  | "TOO_LARGE"
  // The charge is already approved/credited — no further slips accepted.
  | "ALREADY_PAID";

export type UploadPaymentSlipResult =
  | { ok: true }
  | { ok: false; code: UploadPaymentSlipFailureCode };

/**
 * Upload a PromptPay transfer slip for the customer's own charge. This DOES NOT grant
 * any credit — money is granted only when an admin approves the slip (Feature 3). It
 * moves the charge from "pending"/"rejected" to "awaiting_review" and records the
 * slip image for the front desk to verify.
 *
 * Security (CLAUDE.md §8):
 *   - identity comes from the session (`getCurrentUser`), never the client;
 *   - only the charge's BOUND owner may upload (FORBIDDEN otherwise);
 *   - the file is validated SERVER-SIDE — the mime is SNIFFED from the decoded magic
 *     bytes (not the declared data-URL prefix) and must be JPEG/PNG/WebP, and the
 *     decoded size must be ≤ 5 MB (guarded pre-decode by the base64 length too);
 *   - already-approved ("paid") charges reject (ALREADY_PAID) — checked early AND
 *     re-checked at the charge flip (a conditional `status <> 'paid'` update) so an
 *     upload racing an admin approve can never revert a just-paid charge; a previously
 *     "rejected" charge MAY re-upload (the row UPSERTs back to awaiting_review).
 *
 * Emits `payment.slip_submitted` (the CRM is a thin listener — CLAUDE.md §5/§6).
 */
export async function uploadPaymentSlip(
  raw: UploadPaymentSlipInput,
): Promise<UploadPaymentSlipResult> {
  const parsed = uploadSlipInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { chargeId, slipDataUrl } = parsed.data;

  const viewer = await getCurrentUser();

  // No-DB dev path: accept the slip so the upload → under-review UI is exercisable
  // on mock data (nothing persists; production always has a database).
  if (mockDataMode()) return { ok: true };

  // The charge intent persisted at checkout is authoritative. Look it up by the
  // provider's chargeId; if there is no binding, this charge was never opened here.
  const db = getDb();
  const [intent] = await db
    .select()
    .from(charges)
    .where(eq(charges.chargeId, chargeId))
    .limit(1);
  if (!intent) {
    return { ok: false, code: "UNKNOWN_CHARGE" };
  }

  // Only the charge owner may upload a slip for it — owner is server-bound.
  if (intent.userId !== viewer.id) {
    return { ok: false, code: "FORBIDDEN" };
  }

  // An already-credited charge takes no further slips. A "rejected" charge MAY
  // re-upload (UPSERT below resets it to awaiting_review); "pending"/"awaiting_review"
  // can (re)upload while still under review.
  if (intent.status === "paid") {
    return { ok: false, code: "ALREADY_PAID" };
  }

  // Validate the file SERVER-SIDE — sniff the real type + enforce the 5 MB cap.
  const validated = validateSlipDataUrl(slipDataUrl);
  if (!validated.ok) {
    return { ok: false, code: validated.code };
  }

  // Persist the image via the storage adapter (mock keeps it in the row) and UPSERT
  // the slip row keyed by chargeId — a re-upload after rejection replaces the prior
  // slip and resets the review fields.
  const { storageKey, dataUrlToPersist } = await getSlipStorage().put({
    dataUrl: slipDataUrl,
    mimeType: validated.mimeType,
    chargeId,
  });

  await db
    .insert(paymentSlips)
    .values({
      chargeId,
      // The mock persists the data-URL here (the column IS its store); a real object
      // store returns null and resolves the image via storageKey. No mode branching.
      dataUrl: dataUrlToPersist,
      storageKey,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      uploadedByUserId: viewer.id,
    })
    .onConflictDoUpdate({
      target: paymentSlips.chargeId,
      set: {
        dataUrl: dataUrlToPersist,
        storageKey,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        uploadedByUserId: viewer.id,
        uploadedAt: new Date(),
        // Clear any prior review so the new slip starts fresh.
        reviewedByAdminId: null,
        reviewedAt: null,
        reviewDecision: null,
        reviewNote: null,
      },
    });

  // Move the charge to awaiting_review (clearing any prior rejection reason). Guard the
  // flip on `status <> 'paid'` so a re-upload that RACES an admin approve can never
  // revert a just-paid charge back to awaiting_review: the conditional update affects
  // zero rows once the charge is paid. If nothing changed, the charge is already paid →
  // ALREADY_PAID (the early check above only saw the pre-race status). The slip UPSERT
  // above is harmless review-metadata on an already-credited charge.
  const moved = await db
    .update(charges)
    .set({ status: "awaiting_review", rejectionReason: null, reviewedAt: null })
    .where(and(eq(charges.chargeId, chargeId), ne(charges.status, "paid")))
    .returning({ chargeId: charges.chargeId });
  if (moved.length !== 1) {
    return { ok: false, code: "ALREADY_PAID" };
  }

  // CRM is a thin listener on the domain event — attach handlers, then emit.
  registerNotificationHandlers();
  await emit({
    type: "payment.slip_submitted",
    chargeId,
    userId: viewer.id,
    amount: intent.amount,
  });

  return { ok: true };
}

// ───────────────────────── report payment status ─────────────────────────

const confirmPaymentInput = z.object({
  chargeId: z.string().min(1),
});
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentInput>;

export type ConfirmPaymentFailureCode =
  | "INVALID_INPUT"
  // No charge intent persisted for this chargeId — never opened (or already gone).
  | "UNKNOWN_CHARGE"
  // The session viewer is not the user who opened this charge.
  | "FORBIDDEN";

/** The charge's lifecycle as the customer UI reads it while polling for approval. */
export type PaymentLifecycle = "pending" | "awaiting_review" | "paid" | "rejected";

export type ConfirmPaymentResult =
  | { ok: true; status: PaymentLifecycle; rejectionReason: string | null }
  | { ok: false; code: ConfirmPaymentFailureCode };

/**
 * Report the lifecycle status of the customer's own charge — it no longer credits
 * anything (Feature 3 moved the money gate to admin approval, so the always-"paid"
 * mock provider can never grant credits). The customer UI calls this to poll while a
 * slip is in review and to render the final paid/rejected outcome.
 *
 * Security (CLAUDE.md §8): identity is the session; only the charge OWNER may read
 * its status (FORBIDDEN otherwise). The status is read from the persisted charge row
 * (the source of truth), not from the payment provider.
 */
export async function confirmPayment(raw: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
  const parsed = confirmPaymentInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { chargeId } = parsed.data;

  const viewer = await getCurrentUser();

  // No-DB dev path: report "paid" so the mock flow completes end-to-end (QR → slip
  // → under-review poll → credited screen). No credit moves — mock only.
  if (mockDataMode()) {
    return { ok: true, status: "paid", rejectionReason: null };
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
  if (intent.userId !== viewer.id) {
    return { ok: false, code: "FORBIDDEN" };
  }

  // Normalise the free-text status column to the customer-facing lifecycle. Anything
  // unrecognised reads as "pending" (fail safe — never reports an unpaid charge paid).
  const status: PaymentLifecycle =
    intent.status === "paid"
      ? "paid"
      : intent.status === "rejected"
        ? "rejected"
        : intent.status === "awaiting_review"
          ? "awaiting_review"
          : "pending";

  return { ok: true, status, rejectionReason: intent.rejectionReason ?? null };
}

// ───────────────────────── preview a promo code ─────────────────────────

const previewPromoInput = z.object({
  packageId: z.string().min(1),
  code: z.string().trim().min(1).max(32),
});
export type PreviewPromoCodeInput = z.infer<typeof previewPromoInput>;

export type PreviewPromoCodeResult =
  | {
      ok: true;
      code: string;
      label: Bilingual;
      discount: number;
      /** What they would pay with the code applied. */
      amount: number;
      /** The catalog price, for the struck-through "was" figure. */
      originalAmount: number;
    }
  | { ok: false; reason: PromoRefusal };

/**
 * Check a typed code against a package WITHOUT opening a charge, so the buy screen
 * can show the new total before the customer commits.
 *
 * This is a convenience, not a gate: `createCheckout` runs the identical evaluation
 * again when the charge is actually opened. Anything that changes in between — the
 * last slot going to someone else, the owner switching the code off — is caught
 * there, which is the only place that matters (CLAUDE.md §8).
 */
export async function previewPromoCode(
  raw: PreviewPromoCodeInput,
): Promise<PreviewPromoCodeResult> {
  const parsed = previewPromoInput.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "NOT_FOUND" };

  if (!isValidPromoCodeShape(parsed.data.code)) return { ok: false, reason: "NOT_FOUND" };

  const item = await getCatalogItem(parsed.data.packageId);
  if (!item) return { ok: false, reason: "NOT_APPLICABLE" };

  const code = await loadPromoCode(parsed.data.code);
  if (!code) return { ok: false, reason: "NOT_FOUND" };

  const viewer = await getCurrentUser();
  const usage = await loadPromoUsage(code.code, viewer.id);
  const evaluated = evaluatePromoCode({
    code,
    item: { id: item.id, category: item.category, price: item.price },
    redemptionsUsed: usage.total,
    redemptionsByCustomer: usage.byCustomer,
    hasPurchasedBefore: await hasEverPurchased(viewer.id),
    now: new Date(),
  });
  if (!evaluated.ok) return { ok: false, reason: evaluated.reason };

  return {
    ok: true,
    code: code.code,
    label: code.label,
    discount: evaluated.discount,
    amount: evaluated.amount,
    originalAmount: item.price,
  };
}
