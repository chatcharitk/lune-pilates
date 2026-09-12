// Promo codes for studio events — pre-opening, soft opening, grand opening
// (owner request, 2026-09-12).
//
// Everything money-critical lives in `evaluatePromoCode` and `discountFor`, both
// PURE: the client only ever sends a code string, and the server recomputes the
// price from the stored code + the catalog item (CLAUDE.md §8). A discount is never
// read from, or trusted from, the browser.
//
// The refusal reasons are deliberately specific. A customer who mistypes, arrives a
// day early, or hits a sold-out code should be told which of those happened —
// "invalid code" for all three is the kind of thing that generates front-desk
// phone calls.

import type { PackageCategory } from "@/lib/domain/types";
import type { Bilingual } from "@/lib/i18n";

export type PromoKind = "percent" | "fixed";

/** What one code is worth for ONE class format. */
export interface PromoRule {
  kind: PromoKind;
  /** 1–100 for `percent`; whole THB for `fixed`. */
  value: number;
}

/** One owner-created campaign. */
export interface PromoCode {
  /** Stored and compared UPPERCASE. */
  code: string;
  label: Bilingual;
  /**
   * The discount PER CLASS FORMAT (2026-09-12). One code can be worth ฿200 off a
   * group pack and ฿500 off a 1:1 — the studio advertises a single code and it
   * behaves differently per format.
   *
   * A format with NO rule is not covered: this doubles as the "which formats does
   * this code apply to" restriction, so there is one place to look rather than a
   * separate flag that could disagree with the amounts.
   */
  rules: Partial<Record<PackageCategory, PromoRule>>;
  /**
   * Per-PACKAGE overrides, keyed by catalog item id (2026-09-12). The format amount
   * is the default for every package of that format; an entry here replaces it for
   * one package — "฿200 off a single class, ฿800 off the 10-class pack" in one code.
   *
   * A package listed here is covered even when its format is not, so a code can
   * discount the 10-class pack and nothing else.
   */
  itemRules: Record<string, PromoRule>;
  /** Usable from this instant. Null = no start bound. */
  startsAt: Date | null;
  /** Last usable instant (end of its Bangkok day). Null = no end bound. */
  endsAt: Date | null;
  /** Total redemptions allowed across everyone. Null = unlimited. */
  maxRedemptions: number | null;
  maxPerCustomer: number;
  /** Restrict to one catalog item. Null = any. */
  appliesToItemId: string | null;
  firstPurchaseOnly: boolean;
  active: boolean;
}

/**
 * The floor a discounted charge may not go below.
 *
 * A ฿0 PromptPay QR is meaningless, and crediting someone without a payment is a
 * different money path entirely (no slip to verify, no transfer to match). So a
 * discount is clamped rather than allowed to reach zero: a true giveaway stays a
 * deliberate front-desk action, not something a code can do by accident.
 */
export const MIN_CHARGED_THB = 1;

/**
 * THB taken off `priceThb` by this code — always a whole number, never more than
 * the price allows.
 *
 * Percentages round DOWN (Math.floor), so rounding can only ever favour the studio
 * by at most ฿1 rather than quietly giving away more than the code advertises.
 */
export function discountFor(rule: PromoRule, priceThb: number): number {
  const raw =
    rule.kind === "percent"
      ? Math.floor((priceThb * rule.value) / 100)
      : Math.floor(rule.value);
  const maxAllowed = Math.max(0, priceThb - MIN_CHARGED_THB);
  return Math.max(0, Math.min(raw, maxAllowed));
}

/** What the customer pays once `code` is applied to `priceThb`. */
export function discountedAmount(rule: PromoRule, priceThb: number): number {
  return priceThb - discountFor(rule, priceThb);
}

/**
 * The rule that governs `item` — its own, else its format's, else none.
 *
 * The single place the precedence is decided, so the checkout, the admin preview and
 * the coverage checks can never disagree about what a code is worth.
 */
export function ruleForItem(
  code: PromoCode,
  item: { id: string; category: PackageCategory },
): PromoRule | null {
  return code.itemRules[item.id] ?? code.rules[item.category] ?? null;
}

export type PromoRefusal =
  /** No such code (or it was mistyped). */
  | "NOT_FOUND"
  /** The owner has switched it off. */
  | "INACTIVE"
  /** Its window has not opened yet. */
  | "NOT_STARTED"
  /** Its window has closed. */
  | "EXPIRED"
  /** The overall redemption cap is used up. */
  | "EXHAUSTED"
  /** This customer has already used it as many times as allowed. */
  | "ALREADY_USED"
  /** Not valid on the package being bought. */
  | "NOT_APPLICABLE"
  /** Reserved for customers who have never bought before. */
  | "NOT_FIRST_PURCHASE";

export interface PromoEvaluationInput {
  code: PromoCode;
  /** The item being bought — its id, format and price. */
  item: { id: string; category: PackageCategory; price: number };
  /** Redemptions already counted against this code, across everyone. */
  redemptionsUsed: number;
  /** Redemptions this customer has already made of this code. */
  redemptionsByCustomer: number;
  /** Whether the customer has any prior paid purchase. */
  hasPurchasedBefore: boolean;
  now: Date;
}

export type PromoEvaluation =
  | { ok: true; discount: number; amount: number }
  | { ok: false; reason: PromoRefusal };

/**
 * Decide whether `code` may be applied, and what it is worth.
 *
 * Order matters: existence and the owner's own switch first, then the calendar,
 * then the caps, then applicability. A customer hitting several problems at once is
 * told the most fundamental one, which is the one they can act on.
 */
export function evaluatePromoCode(input: PromoEvaluationInput): PromoEvaluation {
  const { code, item, now } = input;

  if (!code.active) return { ok: false, reason: "INACTIVE" };

  if (code.startsAt && now.getTime() < code.startsAt.getTime()) {
    return { ok: false, reason: "NOT_STARTED" };
  }
  if (code.endsAt && now.getTime() > code.endsAt.getTime()) {
    return { ok: false, reason: "EXPIRED" };
  }

  if (code.maxRedemptions !== null && input.redemptionsUsed >= code.maxRedemptions) {
    return { ok: false, reason: "EXHAUSTED" };
  }
  if (input.redemptionsByCustomer >= code.maxPerCustomer) {
    return { ok: false, reason: "ALREADY_USED" };
  }

  if (code.firstPurchaseOnly && input.hasPurchasedBefore) {
    return { ok: false, reason: "NOT_FIRST_PURCHASE" };
  }

  if (code.appliesToItemId !== null && code.appliesToItemId !== item.id) {
    return { ok: false, reason: "NOT_APPLICABLE" };
  }

  // This package's own amount, else its format's. Neither → not covered.
  const rule = ruleForItem(code, item);
  if (!rule) return { ok: false, reason: "NOT_APPLICABLE" };

  const discount = discountFor(rule, item.price);
  // A code that lands on zero off (a fixed code on an already-cheap item, or a
  // rounding-down percentage) is refused rather than applied as a no-op, so the
  // customer is never shown "code applied" beside an unchanged total.
  if (discount <= 0) return { ok: false, reason: "NOT_APPLICABLE" };

  return { ok: true, discount, amount: item.price - discount };
}

/** Canonical form: trimmed, uppercased. Compare and store only this. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Codes are typed by hand off a poster or a LINE message — keep them unambiguous. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,23}$/;

/** Whether `raw` is a plausibly-shaped code (2–24 chars, A–Z 0–9 and dashes). */
export function isValidPromoCodeShape(raw: string): boolean {
  return PROMO_CODE_PATTERN.test(normalizePromoCode(raw));
}
