// Owner-configurable tiered-visibility lead time (CLAUDE.md §5 invariant 4),
// replacing the hardcoded DEFAULT_PUBLIC_LEAD_HOURS constant. Mirrors the
// catalog_items / class_templates pattern (lib/catalog/packages.ts
// loadCatalogMap): the `visibility_windows` table is authoritative once
// populated; SEED_VISIBILITY_WINDOWS below is only the seed + the
// empty-table/no-DB fallback.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { visibilityWindows } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import { mockDataMode } from "@/lib/mock-mode";

export type VisibilityUnit = "day" | "week" | "month";

export const VISIBILITY_UNITS: readonly VisibilityUnit[] = ["day", "week", "month"] as const;

/** One class type's owner-set visibility window, per tier. */
export interface VisibilityWindow {
  type: ClassType;
  memberAmount: number;
  memberUnit: VisibilityUnit;
  guestAmount: number;
  guestUnit: VisibilityUnit;
}

/**
 * Flat, fixed-ratio conversion to hours: day=24, week=168, month=720 (a flat
 * 30-day month). This is a UX visibility CUTOFF, not money or a legal
 * deadline (unlike package expiry, which cares about calendar-exactness) — a
 * class becoming visible a few hours earlier or later than a "true" calendar
 * month never matters to anyone. Do NOT "fix" this into calendar-month
 * arithmetic (e.g. addMonths) later; the flat ratio is deliberate and keeps
 * the conversion a pure, timezone-independent multiply.
 */
export function leadHoursFor(amount: number, unit: VisibilityUnit): number {
  switch (unit) {
    case "day":
      return amount * 24;
    case "week":
      return amount * 168;
    case "month":
      return amount * 720;
  }
}

/**
 * The seed/fallback visibility windows. CRITICAL — chosen so deploying this
 * feature never silently TIGHTENS today's effective behavior:
 *
 *   - GUEST seed = today's exact hardcoded DEFAULT_PUBLIC_LEAD_HOURS values:
 *     group/private/duo/trio = 1 day (24h); rental = 2 weeks (336h), matching
 *     the prior 336-hour constant exactly.
 *   - MEMBER seed = a deliberately generous 3 months (2160h) for every type.
 *     Today members have NO gate at all (isBookableForViewer returned `true`
 *     unconditionally for members); since this migration introduces a REAL
 *     gate for members for the first time, an aggressive seed could hide an
 *     already-visible class the moment this ships. 3 months is longer than
 *     any realistic publish-to-start lead time in this studio's schedule, so
 *     no currently-visible class becomes hidden on deploy day. The owner can
 *     tighten it later via the admin settings screen.
 */
export const SEED_VISIBILITY_WINDOWS: Record<
  ClassType,
  { memberAmount: number; memberUnit: VisibilityUnit; guestAmount: number; guestUnit: VisibilityUnit }
> = {
  group: { memberAmount: 3, memberUnit: "month", guestAmount: 1, guestUnit: "day" },
  private: { memberAmount: 3, memberUnit: "month", guestAmount: 1, guestUnit: "day" },
  duo: { memberAmount: 3, memberUnit: "month", guestAmount: 1, guestUnit: "day" },
  trio: { memberAmount: 3, memberUnit: "month", guestAmount: 1, guestUnit: "day" },
  rental: { memberAmount: 3, memberUnit: "month", guestAmount: 2, guestUnit: "week" },
};

const ALL_TYPES: readonly ClassType[] = ["group", "private", "duo", "trio", "rental"] as const;

function seedWindows(): VisibilityWindow[] {
  return ALL_TYPES.map((type) => ({ type, ...SEED_VISIBILITY_WINDOWS[type] }));
}

function isVisibilityUnit(v: string): v is VisibilityUnit {
  return (VISIBILITY_UNITS as readonly string[]).includes(v);
}

/**
 * Every visibility window, one per class type — DB-backed with the seed as the
 * empty-table/no-DB fallback (mirrors loadCatalogMap in lib/catalog/packages.ts).
 * Types missing a DB row (e.g. a fresh deploy that has only some rows seeded)
 * fall back individually to the seed for that type, so a partial table can
 * never leave a type ungated.
 */
export async function loadVisibilityWindows(): Promise<Map<ClassType, VisibilityWindow>> {
  if (mockDataMode()) {
    return new Map(seedWindows().map((w) => [w.type, w]));
  }

  const db = getDb();
  const rows = await db.select().from(visibilityWindows);

  const byType = new Map<ClassType, VisibilityWindow>();
  for (const r of rows) {
    const memberUnit = isVisibilityUnit(r.memberUnit) ? r.memberUnit : "month";
    const guestUnit = isVisibilityUnit(r.guestUnit) ? r.guestUnit : "day";
    byType.set(r.type, {
      type: r.type,
      memberAmount: r.memberAmount,
      memberUnit,
      guestAmount: r.guestAmount,
      guestUnit,
    });
  }

  // Fill in any type with no stored row (empty table, or a partially-seeded one)
  // from the seed/fallback — so every type always resolves to a real window.
  for (const type of ALL_TYPES) {
    if (!byType.has(type)) {
      byType.set(type, { type, ...SEED_VISIBILITY_WINDOWS[type] });
    }
  }
  return byType;
}

/**
 * Resolve `(memberLeadHours, guestLeadHours)` for one class type from an
 * already-loaded window map (call `loadVisibilityWindows` ONCE per action —
 * never per-instance in a loop, mirrors `loadCatalogMap`'s convention).
 */
export function leadHoursForType(
  windows: Map<ClassType, VisibilityWindow>,
  type: ClassType,
): { memberLeadHours: number; guestLeadHours: number } {
  const w = windows.get(type) ?? { type, ...SEED_VISIBILITY_WINDOWS[type] };
  return {
    memberLeadHours: leadHoursFor(w.memberAmount, w.memberUnit),
    guestLeadHours: leadHoursFor(w.guestAmount, w.guestUnit),
  };
}
