"use server";

// Server actions for the admin "verify a PromptPay slip" flow (Feature 3). These are
// the typed contracts the admin frontend imports and calls directly.
//
// Every action is OWNER-ONLY: gated by `requireOwner()` (lib/auth/admin.ts) as LINE
// 1 of the body — BEFORE input parsing — so it can never be reordered past it
// (pinned by tests/admin-auth.test.ts), mirroring app/actions/admin-pos.ts. An
// instructor is rejected like unauth (UNAUTHORIZED); slip PII never reaches them.
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

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { charges, paymentSlips } from "@/lib/db/schema";
import { getCatalogItem } from "@/lib/catalog/packages";
import { itemForCredit } from "@/lib/catalog/chargeTerms";
import { getSlipStorage } from "@/lib/storage";
import { loadPoolOwner } from "@/lib/credits/selectPackage";
import { creditPackage, ownerForPool, type CreditOwner } from "@/lib/credits/creditPackage";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";
import { validateSlipDataUrl } from "@/lib/payments/slip";

// ───────────────────────── attach slip (admin) ─────────────────────────

const attachSlipInput = z.object({
  chargeId: z.string().min(1),
  /** A `data:<mime>;base64,…` URL of the transfer slip (validated server-side). */
  slipDataUrl: z.string().min(1),
});
export type AttachSlipInput = z.infer<typeof attachSlipInput>;

export type AttachSlipFailureCode =
  | ApproveSlipFailureCode
  | "INVALID_FILE"
  | "TOO_LARGE"
  // Already paid or cancelled — nothing left to pay for.
  | "NOT_PAYABLE";

export type AttachSlipResult =
  | { ok: true; receipt: ApproveSlipReceipt }
  | { ok: false; code: AttachSlipFailureCode };

/**
 * The front desk attaches a transfer slip on the customer's behalf and approves it
 * in one step (2026-10-08) — for a sale the admin rang up at the counter, or a
 * customer who sent their slip over LINE instead of uploading it. The slip is
 * stored exactly like a customer upload (same validation, same storage adapter,
 * same row), then credited through `approveSlip`, so there is still ONE money path.
 *
 * Only an unpaid charge takes a slip: pending, awaiting_review (the admin's slip
 * replaces the customer's) or rejected. `uploaded_by_user_id` is the charge's
 * customer (the column references users; staff are not users) and the review note
 * records that the admin attached it.
 */
export async function attachSlipAndApprove(raw: AttachSlipInput): Promise<AttachSlipResult> {
  const admin = await requireOwner();
  if (!admin) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = attachSlipInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { chargeId, slipDataUrl } = parsed.data;

  const validated = validateSlipDataUrl(slipDataUrl);
  if (!validated.ok) return { ok: false, code: validated.code };

  if (mockDataMode()) {
    return {
      ok: true,
      receipt: {
        chargeId,
        packageId: "00000000-0000-4000-8000-0000000000d3",
        hoursAdded: 10,
        hoursLeft: 10,
        created: true,
        owner: { ownerHouseholdId: null, ownerUserId: "00000000-0000-4000-8000-000000000001" },
      },
    };
  }

  const db = getDb();
  const [intent] = await db.select().from(charges).where(eq(charges.chargeId, chargeId)).limit(1);
  if (!intent) return { ok: false, code: "UNKNOWN_CHARGE" };
  const payable = ["pending", "awaiting_review", "rejected"] as const;
  if (!(payable as readonly string[]).includes(intent.status)) return { ok: false, code: "NOT_PAYABLE" };

  const { storageKey, dataUrlToPersist } = await getSlipStorage().put({
    dataUrl: slipDataUrl,
    mimeType: validated.mimeType,
    chargeId,
  });
  const now = new Date();
  const slipValues = {
    dataUrl: dataUrlToPersist,
    storageKey,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    uploadedByUserId: intent.userId,
    uploadedAt: now,
    reviewedByAdminId: null,
    reviewedAt: null,
    reviewDecision: null,
    reviewNote: `Attached by admin ${admin.id}`,
  };
  await db
    .insert(paymentSlips)
    .values({ chargeId, ...slipValues })
    .onConflictDoUpdate({ target: paymentSlips.chargeId, set: slipValues });

  // Into review — guarded so a charge that got paid/cancelled meanwhile is untouched.
  const moved = await db
    .update(charges)
    .set({ status: "awaiting_review", rejectionReason: null })
    .where(and(eq(charges.chargeId, chargeId), inArray(charges.status, [...payable])))
    .returning({ chargeId: charges.chargeId });
  if (moved.length !== 1) return { ok: false, code: "NOT_PAYABLE" };

  return approveSlip({ chargeId });
}

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
  const admin = await requireOwner();
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
  //
  // THE LIVE ITEM IS THE LABEL, NOT THE TERMS. A slip can sit in awaiting_review for
  // days, and the catalog is owner-editable at runtime — so the hours, validity and
  // category actually granted come from the charge's own purchased-terms snapshot,
  // frozen at checkout (lib/catalog/chargeTerms.ts). Without this, editing p10 from
  // 10h to 20h while a slip was pending would credit 20 hours for a ฿5,500 payment.
  // Charges created before the snapshot columns existed have nulls and fall back to
  // the live item — the pre-existing behaviour, since their terms aren't recorded.
  const live = await getCatalogItem(intent.packageId);
  if (!live) {
    return { ok: false, code: "UNKNOWN_PACKAGE" };
  }
  const item = itemForCredit(live, intent);

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
  const admin = await requireOwner();
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
 * bank/PII, so this is gated behind requireOwner and never publicly fetchable. The
 * image bytes come from the storage adapter (getSlipStorage().get); the metadata from
 * the slip row.
 */
export async function getSlip(raw: GetSlipInput): Promise<GetSlipResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = getSlipInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { chargeId } = parsed.data;

  // No-DB dev path: a placeholder slip so the admin viewers (Payments + Sales
  // detail) render on mock data instead of rejecting at getDb().
  if (mockDataMode()) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240">` +
      `<rect width="100%" height="100%" fill="#FBF6EF"/>` +
      `<text x="200" y="115" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#8C7A63">MOCK SLIP</text>` +
      `<text x="200" y="140" text-anchor="middle" font-family="monospace" font-size="12" fill="#9C8C77">${chargeId}</text>` +
      `</svg>`;
    return {
      ok: true,
      slip: {
        dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        mimeType: "image/svg+xml",
        sizeBytes: svg.length,
        uploadedAt: new Date().toISOString(),
        reviewDecision: null,
      },
    };
  }

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
