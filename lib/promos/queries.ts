// Reads for promo codes: loading a code, and counting what has been redeemed.
//
// The counting rule is the subtle part. A redemption row is written at CHECKOUT so
// a capped code ("first 30") cannot oversell while several people are paying at
// once. But an abandoned or refused checkout must hand its slot back, so a row only
// counts while its charge is still alive — pending, awaiting review, or paid.
// Cancelled and rejected charges are excluded. Rows are never deleted: they are the
// audit trail of who redeemed what.

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { charges, promoCodes, promoRedemptions } from "@/lib/db/schema";
import { mockDataMode } from "@/lib/mock-mode";
import type { PackageCategory } from "@/lib/domain/types";
import { normalizePromoCode, type PromoCode, type PromoKind } from "./codes";

/** Charge states that still hold their redemption slot. */
const LIVE_CHARGE_STATUSES = ["pending", "awaiting_review", "paid"] as const;

function rowToCode(r: {
  code: string;
  labelEn: string;
  labelTh: string;
  kind: string;
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerCustomer: number;
  appliesToCategory: PackageCategory | null;
  appliesToItemId: string | null;
  firstPurchaseOnly: boolean;
  active: boolean;
}): PromoCode {
  return {
    code: r.code,
    label: { en: r.labelEn, th: r.labelTh },
    // The column is CHECK-constrained to these two, but narrow defensively rather
    // than cast: an unknown kind falls back to "fixed", whose value is read as flat
    // THB — the conservative reading, since a stray "percent" of a large number
    // would give far more away than a flat one.
    kind: (r.kind === "percent" ? "percent" : "fixed") as PromoKind,
    value: r.value,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    maxRedemptions: r.maxRedemptions,
    maxPerCustomer: r.maxPerCustomer,
    appliesToCategory: r.appliesToCategory,
    appliesToItemId: r.appliesToItemId,
    firstPurchaseOnly: r.firstPurchaseOnly,
    active: r.active,
  };
}

/** One code by its (case-insensitive) string, or null when there is no such code. */
export async function loadPromoCode(raw: string): Promise<PromoCode | null> {
  if (mockDataMode()) return null; // no codes without a database
  const code = normalizePromoCode(raw);
  const [row] = await getDb()
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.code, code))
    .limit(1);
  return row ? rowToCode(row) : null;
}

export interface PromoUsage {
  /** Live redemptions across everyone — what the overall cap is measured against. */
  total: number;
  /** Live redemptions by this customer — what the per-customer cap is measured against. */
  byCustomer: number;
}

/** How much of `code` has been used, counting only still-live charges. */
export async function loadPromoUsage(code: string, userId: string): Promise<PromoUsage> {
  if (mockDataMode()) return { total: 0, byCustomer: 0 };

  const db = getDb();
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      byCustomer: sql<number>`count(*) filter (where ${promoRedemptions.userId} = ${userId})::int`,
    })
    .from(promoRedemptions)
    .innerJoin(charges, eq(charges.chargeId, promoRedemptions.chargeId))
    .where(
      and(
        eq(promoRedemptions.code, normalizePromoCode(code)),
        inArray(charges.status, [...LIVE_CHARGE_STATUSES]),
      ),
    );

  const row = rows[0];
  return { total: row?.total ?? 0, byCustomer: row?.byCustomer ?? 0 };
}

/** Live redemption counts for every code — the admin list's "used" column. */
export async function loadPromoUsageByCode(): Promise<Map<string, number>> {
  if (mockDataMode()) return new Map();

  const rows = await getDb()
    .select({ code: promoRedemptions.code, used: sql<number>`count(*)::int` })
    .from(promoRedemptions)
    .innerJoin(charges, eq(charges.chargeId, promoRedemptions.chargeId))
    .where(inArray(charges.status, [...LIVE_CHARGE_STATUSES]))
    .groupBy(promoRedemptions.code);

  return new Map(rows.map((r) => [r.code, r.used]));
}

/** Every code, newest first — the admin list. */
export async function listPromoCodes(): Promise<PromoCode[]> {
  if (mockDataMode()) return [];
  const rows = await getDb()
    .select()
    .from(promoCodes)
    .orderBy(sql`${promoCodes.createdAt} desc`);
  return rows.map(rowToCode);
}
