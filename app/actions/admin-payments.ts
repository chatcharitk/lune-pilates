"use server";

// Server actions for the admin "verify a PromptPay slip" flow (Feature 3). These are
// the typed contracts the admin frontend imports and calls directly.
//
// Every action is gated by `requireAdmin()` (lib/auth/admin.ts) as LINE 1 of the body
// — BEFORE input parsing and the no-DB branch — so it can never be reordered past
// them (pinned by tests/admin-auth.test.ts), mirroring app/actions/admin-pos.ts.
//
// MONEY IS GRANTED ONLY ON APPROVE (CLAUDE.md §5 invariant 1): approveSlip is the
// ONE place a slip-verified PromptPay purchase becomes credit, via the SAME atomic,
// idempotent primitive the cash POS and customer flows use
// (lib/credits/creditPackage.ts → creditPackage). A double-approve / racing approve
// can NEVER double-credit — the packages.purchase_charge_id UNIQUE backstop + the
// in-tx pre-check resolve every repeat to the same already-credited balance.
//
// OWNER RESOLUTION (invariants 2 & 3): the credit lands on the CHARGE'S BOUND
// CUSTOMER (resolved from the stored `userId` via loadPoolOwner + ownerForPool —
// member→household pool, guest→own), NEVER the session admin and NEVER the client.
//
// PII: slip images contain bank details. getSlip serves them ONLY behind this admin
// gate; they are never publicly fetchable.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { charges, paymentSlips } from "@/lib/db/schema";
import { getCatalogItem } from "@/lib/catalog/packages";
import { getSlipStorage } from "@/lib/storage";
import { loadPoolOwner } from "@/lib/credits/selectPackage";
import { creditPackage, ownerForPool, type CreditOwner } from "@/lib/credits/creditPackage";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { requireAdmin } from "@/lib/auth/admin";

// ───────────────────────── approve slip ─────────────────────────

const approveSlipInput = z.object({
  chargeId: z.string().min(1),
});
export type ApproveSlipInput = z.infer<typeof approveSlipInput>;

export type ApproveSlipFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  // No charge intent persisted for this chargeId.
  | "UNKNOWN_CHARGE"
  // No slip was uploaded for this charge — nothing to approve.
  | "NO_SLIP"
  // The charge is not in a reviewable state (e.g. 'rejected' or never-uploaded
  // 'pending') — only 'awaiting_review' may be approved. ('paid' is handled as an
  // idempotent already-credited success, NOT this error.)
  | "NOT_REVIEWABLE"
  // The charge's stored packageId no longer resolves to a catalog item (drift).
  | "UNKNOWN_PACKAGE"
  // The charge's bound customer no longer resolves to a pool owner (deleted).
  | "UNKNOWN_CUSTOMER";

export interface ApproveSlipReceipt {
  chargeId: string;
  /** The package row that holds the credited balance. */
  packageId: string;
  /** Credits granted by this approval. */
  hoursAdded: number;
  /** The new usable balance on the credited package. */
  hoursLeft: number;
  /** true when this approval actually created the package; false on a repeat approve. */
  created: boolean;
  /** Where the balance landed (household pool XOR user). */
  owner: CreditOwner;
}

export type ApproveSlipResult =
  | { ok: true; receipt: ApproveSlipReceipt }
  | { ok: false; code: ApproveSlipFailureCode };

/**
 * Approve an uploaded slip and CREDIT the package exactly once via the shared atomic
 * primitive — to the CHARGE'S BOUND CUSTOMER, resolved from the DB (not the admin).
 * Idempotent: a repeat/racing approve returns the already-credited balance (the
 * purchase_charge_id UNIQUE backstop guarantees at-most-once). Stamps the slip's
 * review fields + charges.reviewed_at, and emits `credit.purchased`.
 */
export async function approveSlip(raw: ApproveSlipInput): Promise<ApproveSlipResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = approveSlipInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { chargeId } = parsed.data;
  const now = new Date();

  const db = getDb();
  const [intent] = await db
    .select()
    .from(charges)
    .where(eq(charges.chargeId, chargeId))
    .limit(1);
  if (!intent) {
    return { ok: false, code: "UNKNOWN_CHARGE" };
  }

  // There must be a slip to approve.
  const [slip] = await db
    .select({ id: paymentSlips.id })
    .from(paymentSlips)
    .where(eq(paymentSlips.chargeId, chargeId))
    .limit(1);
  if (!slip) {
    return { ok: false, code: "NO_SLIP" };
  }

  // Charge-status guard. Only an 'awaiting_review' charge is approvable. An already
  // 'paid' charge resolves to the SAME already-credited receipt (idempotent — the
  // creditPackage pre-check / purchase_charge_id UNIQUE backstop returns the existing
  // balance with created=false; we never double-credit). Any other state ('rejected',
  // or a never-uploaded 'pending') is NOT_REVIEWABLE. Note: concurrent approves that
  // all observe 'awaiting_review' still pass this guard and converge to exactly one
  // credit via that same backstop — the guard only blocks non-reviewable states.
  if (intent.status !== "awaiting_review" && intent.status !== "paid") {
    return { ok: false, code: "NOT_REVIEWABLE" };
  }

  // Resolve the item from the STORED packageId — never the client's (§8).
  const item = getCatalogItem(intent.packageId);
  if (!item) {
    return { ok: false, code: "UNKNOWN_PACKAGE" };
  }

  // Resolve the recipient's pool from the charge's bound customer, from the DB
  // (member→household, guest→own — invariants 2 & 3).
  const target = await loadPoolOwner(intent.userId);
  if (!target) {
    return { ok: false, code: "UNKNOWN_CUSTOMER" };
  }
  const owner = ownerForPool(target);

  // Credit ONCE — the money gate. creditPackage flips charges.status to "paid" in the
  // same transaction; the unique backstop makes a double/racing approve safe.
  const outcome = await creditPackage({
    chargeId,
    item,
    owner,
    actorUserId: intent.userId,
    now,
  });

  // Stamp the review audit on the slip + the charge's reviewed_at. (Idempotent re-run
  // just rewrites the same approval stamp — harmless.)
  await db
    .update(paymentSlips)
    .set({
      reviewedByAdminId: admin.id,
      reviewedAt: now,
      reviewDecision: "approved",
    })
    .where(eq(paymentSlips.chargeId, chargeId));
  await db.update(charges).set({ reviewedAt: now }).where(eq(charges.chargeId, chargeId));

  // CRM is a thin listener on the SAME domain event the customer/POS flows emit.
  registerNotificationHandlers();
  await emit({
    type: "credit.purchased",
    packageId: outcome.packageId,
    userId: intent.userId,
    ownerHouseholdId: owner.ownerHouseholdId,
    ownerUserId: owner.ownerUserId,
    hours: outcome.hoursAdded,
    hoursLeft: outcome.hoursLeft,
  });

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

// ───────────────────────── reject slip ─────────────────────────

const rejectSlipInput = z.object({
  chargeId: z.string().min(1),
  reason: z.string().max(500).optional(),
});
export type RejectSlipInput = z.infer<typeof rejectSlipInput>;

export type RejectSlipFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_CHARGE"
  | "NO_SLIP"
  // The charge is already credited — it cannot be rejected.
  | "ALREADY_PAID";

export type RejectSlipResult =
  | { ok: true }
  | { ok: false; code: RejectSlipFailureCode };

/**
 * Reject an uploaded slip: mark the charge "rejected" (with an optional reason),
 * stamp the slip's review fields. NO credit is granted. The customer may re-upload
 * (uploadPaymentSlip UPSERTs the slip back to awaiting_review). Emits
 * `payment.slip_rejected`.
 */
export async function rejectSlip(raw: RejectSlipInput): Promise<RejectSlipResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = rejectSlipInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { chargeId, reason } = parsed.data;
  const now = new Date();

  const db = getDb();
  const [intent] = await db
    .select()
    .from(charges)
    .where(eq(charges.chargeId, chargeId))
    .limit(1);
  if (!intent) {
    return { ok: false, code: "UNKNOWN_CHARGE" };
  }
  // Never reject an already-credited charge (the credit is irreversible here).
  if (intent.status === "paid") {
    return { ok: false, code: "ALREADY_PAID" };
  }

  const [slip] = await db
    .select({ id: paymentSlips.id })
    .from(paymentSlips)
    .where(eq(paymentSlips.chargeId, chargeId))
    .limit(1);
  if (!slip) {
    return { ok: false, code: "NO_SLIP" };
  }

  const reasonOrNull = reason && reason.trim().length > 0 ? reason.trim() : null;

  await db
    .update(charges)
    .set({ status: "rejected", rejectionReason: reasonOrNull, reviewedAt: now })
    .where(eq(charges.chargeId, chargeId));
  await db
    .update(paymentSlips)
    .set({
      reviewedByAdminId: admin.id,
      reviewedAt: now,
      reviewDecision: "rejected",
      reviewNote: reasonOrNull,
    })
    .where(eq(paymentSlips.chargeId, chargeId));

  registerNotificationHandlers();
  await emit({
    type: "payment.slip_rejected",
    chargeId,
    userId: intent.userId,
    reason: reasonOrNull,
  });

  revalidatePath("/admin/payments");
  return { ok: true };
}

// ───────────────────────── view slip (admin only) ─────────────────────────

const getSlipInput = z.object({
  chargeId: z.string().min(1),
});
export type GetSlipInput = z.infer<typeof getSlipInput>;

export type GetSlipFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | "NO_SLIP";

export interface SlipImage {
  /** The renderable `data:<mime>;base64,…` URL the admin viewer shows. */
  dataUrl: string;
  mimeType: string;
  /** Decoded size in bytes (for an "N KB" hint in the viewer). */
  sizeBytes: number;
  /** When the customer uploaded it (ISO 8601). */
  uploadedAt: string;
  /** The slip's review decision so far: null until reviewed. */
  reviewDecision: "approved" | "rejected" | null;
}

export type GetSlipResult =
  | { ok: true; slip: SlipImage }
  | { ok: false; code: GetSlipFailureCode };

/**
 * Return the uploaded slip image for a charge — ADMIN ONLY. Slip images carry
 * bank/PII, so this is gated behind requireAdmin and never publicly fetchable. The
 * image bytes come from the storage adapter (getSlipStorage().get); the metadata from
 * the slip row.
 */
export async function getSlip(raw: GetSlipInput): Promise<GetSlipResult> {
  if (!(await requireAdmin())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = getSlipInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { chargeId } = parsed.data;

  const db = getDb();
  const [row] = await db
    .select({
      storageKey: paymentSlips.storageKey,
      mimeType: paymentSlips.mimeType,
      sizeBytes: paymentSlips.sizeBytes,
      uploadedAt: paymentSlips.uploadedAt,
      reviewDecision: paymentSlips.reviewDecision,
    })
    .from(paymentSlips)
    .where(eq(paymentSlips.chargeId, chargeId))
    .limit(1);
  if (!row) {
    return { ok: false, code: "NO_SLIP" };
  }

  const stored = await getSlipStorage().get(row.storageKey);
  if (!stored) {
    return { ok: false, code: "NO_SLIP" };
  }

  const decision =
    row.reviewDecision === "approved" || row.reviewDecision === "rejected"
      ? row.reviewDecision
      : null;

  return {
    ok: true,
    slip: {
      dataUrl: stored.dataUrl,
      mimeType: stored.mimeType,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.uploadedAt.toISOString(),
      reviewDecision: decision,
    },
  };
}
