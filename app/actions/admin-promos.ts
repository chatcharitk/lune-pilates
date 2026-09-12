"use server";

// Owner-only management of event discount codes (Settings → Promo codes).
//
// Follows the conventions of app/actions/admin-visibility.ts and admin-settings.ts:
// `requireOwner()` is line 1 of every action — BEFORE input parsing and before the
// no-DB branch — so an unauthorised caller always reads UNAUTHORIZED rather than
// INVALID_INPUT (which would leak schema validity) or MOCK_NO_DB (which would leak
// deploy mode). A validated write in `mockDataMode()` reports MOCK_NO_DB rather than
// a fake success.
//
// Codes are never hard-deleted once they have been redeemed: `promo_redemptions`
// references them and is the audit trail of who got what discount. Retiring a code
// switches it off instead, which stops new redemptions while leaving history intact.

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { promoCodeRules, promoCodes, promoRedemptions } from "@/lib/db/schema";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";
import { studioEndOfDay, studioInstant, studioParts, studioStartOfDay } from "@/lib/time";
import {
  PROMO_CODE_PATTERN,
  normalizePromoCode,
  type PromoCode,
} from "@/lib/promos/codes";
import { listPromoCodes, loadPromoUsageByCode } from "@/lib/promos/queries";

export type MockNoDbCode = "MOCK_NO_DB";

/** A code plus how many live redemptions it has — the admin list row. */
export interface AdminPromoCode extends PromoCode {
  /** Redemptions counted against the cap (cancelled/rejected charges excluded). */
  used: number;
  /** Window bounds as Bangkok calendar days, for the date inputs. */
  startsOn: string | null;
  endsOn: string | null;
}

export type ListPromosResult =
  | { ok: true; codes: AdminPromoCode[] }
  | { ok: false; code: "UNAUTHORIZED" };

/** Bangkok "YYYY-MM-DD" for an instant, or null. */
function toYmd(d: Date | null): string | null {
  if (!d) return null;
  const { year, month0, day } = studioParts(d);
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function listPromosForAdmin(): Promise<ListPromosResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };
  const [codes, usage] = await Promise.all([listPromoCodes(), loadPromoUsageByCode()]);
  return {
    ok: true,
    codes: codes.map((c) => ({
      ...c,
      used: usage.get(c.code) ?? 0,
      startsOn: toYmd(c.startsAt),
      endsOn: toYmd(c.endsAt),
    })),
  };
}

// ───────────────────────── save (create or update) ─────────────────────────

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One format's discount. Formats the owner leaves blank simply aren't sent. */
const ruleInput = z.object({
  category: z.enum(["group", "private", "duo", "trio", "rental"]),
  kind: z.enum(["percent", "fixed"]),
  value: z.number().int().positive().max(1_000_000),
});

const saveInput = z.object({
  code: z.string().trim().toUpperCase().regex(PROMO_CODE_PATTERN),
  labelEn: z.string().trim().min(1).max(60),
  labelTh: z.string().trim().min(1).max(60),
  /**
   * The discount PER CLASS FORMAT. A code covers exactly the formats listed here,
   * so an empty list would be a code that can never apply — refused as NO_RULES.
   */
  rules: z.array(ruleInput).max(5),
  /** Bangkok calendar days; the end day counts in full. Empty string = unbounded. */
  startsOn: z.union([z.literal(""), YMD]),
  endsOn: z.union([z.literal(""), YMD]),
  /** 0 / absent = unlimited. */
  maxRedemptions: z.number().int().min(0).max(1_000_000),
  maxPerCustomer: z.number().int().positive().max(1_000),
  appliesToItemId: z.string().trim().max(40).nullable(),
  firstPurchaseOnly: z.boolean(),
  active: z.boolean(),
});
export type SavePromoInput = z.infer<typeof saveInput>;

export type SavePromoFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  /** No format was given a discount — the code could never apply to anything. */
  | "NO_RULES"
  /** A percentage over 100 would mean a negative price. */
  | "PERCENT_TOO_LARGE"
  /** The window ends before it starts. */
  | "BAD_WINDOW"
  | MockNoDbCode;

export type SavePromoResult = { ok: true; code: string } | { ok: false; code: SavePromoFailureCode };

/**
 * Create or update a code (upsert on the code itself).
 *
 * Dates are Bangkok calendar days: the start opens at 00:00 of its day and the end
 * closes at the LAST INSTANT of its day, so a code dated "to 31 Oct" works all of
 * the 31st — the same inclusive-day rule package expiry uses.
 */
export async function savePromoCode(raw: SavePromoInput): Promise<SavePromoResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = saveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  if (input.rules.length === 0) return { ok: false, code: "NO_RULES" };
  if (input.rules.some((r) => r.kind === "percent" && r.value > 100)) {
    return { ok: false, code: "PERCENT_TOO_LARGE" };
  }
  // One rule per format — a duplicate would make the stored discount ambiguous.
  if (new Set(input.rules.map((r) => r.category)).size !== input.rules.length) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  const startsAt = input.startsOn === "" ? null : startOfYmd(input.startsOn);
  const endsAt = input.endsOn === "" ? null : endOfYmd(input.endsOn);
  if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
    return { ok: false, code: "BAD_WINDOW" };
  }

  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  const code = normalizePromoCode(input.code);
  const values = {
    labelEn: input.labelEn,
    labelTh: input.labelTh,
    startsAt,
    endsAt,
    maxRedemptions: input.maxRedemptions > 0 ? input.maxRedemptions : null,
    maxPerCustomer: input.maxPerCustomer,
    appliesToItemId: input.appliesToItemId && input.appliesToItemId !== "" ? input.appliesToItemId : null,
    firstPurchaseOnly: input.firstPurchaseOnly,
    active: input.active,
  };

  // The code and its per-format rules move together: a half-applied save could
  // leave a live code with the wrong discounts, so both go in one transaction and
  // the rules are REPLACED wholesale (removing a format is as meaningful as adding
  // one — it takes that format out of the code's coverage).
  await getDb().transaction(async (tx) => {
    await tx
      .insert(promoCodes)
      .values({ code, ...values })
      .onConflictDoUpdate({ target: promoCodes.code, set: values });
    await tx.delete(promoCodeRules).where(eq(promoCodeRules.code, code));
    await tx.insert(promoCodeRules).values(
      input.rules.map((r) => ({
        code,
        category: r.category,
        kind: r.kind,
        value: r.value,
      })),
    );
  });

  revalidatePath("/admin/settings/promos");
  return { ok: true, code };
}

/** Bangkok 00:00 of a "YYYY-MM-DD". */
function startOfYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return studioStartOfDay(studioInstant(y, m - 1, d, 12, 0));
}

/** The LAST usable instant of a "YYYY-MM-DD" in Bangkok. */
function endOfYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(studioEndOfDay(studioInstant(y, m - 1, d, 12, 0)).getTime() - 1);
}

// ───────────────────────── retire / restore ─────────────────────────

const toggleInput = z.object({ code: z.string().trim().min(1).max(32), active: z.boolean() });
export type TogglePromoInput = z.infer<typeof toggleInput>;

export type TogglePromoResult =
  | { ok: true }
  | { ok: false; code: "UNAUTHORIZED" | "INVALID_INPUT" | "UNKNOWN_CODE" | MockNoDbCode };

/**
 * Switch a code off (or back on). Never deletes: `promo_redemptions` references the
 * code and records who received which discount, so a retired code keeps its history
 * while stopping new redemptions immediately.
 */
export async function setPromoActive(raw: TogglePromoInput): Promise<TogglePromoResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = toggleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  const updated = await getDb()
    .update(promoCodes)
    .set({ active: parsed.data.active })
    .where(eq(promoCodes.code, normalizePromoCode(parsed.data.code)))
    .returning({ code: promoCodes.code });

  if (updated.length === 0) return { ok: false, code: "UNKNOWN_CODE" };

  revalidatePath("/admin/settings/promos");
  return { ok: true };
}

// ───────────────────────── redemption detail ─────────────────────────

export interface PromoRedemptionRow {
  chargeId: string;
  discountAmount: number;
  createdAt: string;
}

export type PromoRedemptionsResult =
  | { ok: true; rows: PromoRedemptionRow[] }
  | { ok: false; code: "UNAUTHORIZED" };

/** Who has redeemed one code — the drill-down behind the "used" count. */
export async function listPromoRedemptions(code: string): Promise<PromoRedemptionsResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };
  if (mockDataMode()) return { ok: true, rows: [] };

  const rows = await getDb()
    .select({
      chargeId: promoRedemptions.chargeId,
      discountAmount: promoRedemptions.discountAmount,
      createdAt: promoRedemptions.createdAt,
    })
    .from(promoRedemptions)
    .where(eq(promoRedemptions.code, normalizePromoCode(code)))
    .orderBy(sql`${promoRedemptions.createdAt} desc`);

  return {
    ok: true,
    rows: rows.map((r) => ({
      chargeId: r.chargeId,
      discountAmount: r.discountAmount,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
