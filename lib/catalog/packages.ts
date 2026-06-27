// The canonical, server-side purchasable catalog — the single source of truth
// for what a customer can buy, how many hours it grants, and what it costs.
//
// Mirrors lune-pilates/project/lune-data.jsx (PACKAGE_CATS / PACKAGES) and the
// spec §1 pricing. Prices and hours live ONLY here; the checkout flow looks them
// up server-side and NEVER trusts a client-supplied price, hour count, or owner
// (CLAUDE.md §8 — recompute money server-side).
//
// Bilingual labels follow the prototype's content-object pattern (CLAUDE.md §6):
// catalog copy is content, carried as `{ en, th }` objects the UI renders with
// `tt(...)`, exactly as queries.ts carries TYPE_META labels. Money is integer THB.

import type { Bilingual } from "@/lib/i18n";
import type { PackageCategory } from "@/lib/domain/types";

/**
 * How long a purchased package stays usable. Maps to a concrete `expires_at` via
 * `expiryFromValidity` (the single place validity → months lives). `single_visit`
 * (drop-in) is given a 1-month window to use the single credit.
 */
export type Validity = "single_visit" | "one_month" | "two_months" | "three_months";

/** Promotional badge a catalog item can carry. */
export type CatalogTag = "popular" | "best_value";

/**
 * One purchasable item. `category` is the package balance bucket it credits
 * (group | private | rental) — the same enum a booking debits against
 * (selectPackage.ts). `hours` is the credit value granted on purchase.
 */
export interface CatalogItem {
  /** Stable catalog id, e.g. "p10", "pv8", "r-duo". Also the package `type`. */
  id: string;
  category: PackageCategory;
  /** Credits granted (== hours_total == hours_left on a fresh purchase). */
  hours: number;
  /** Price in Thai Baht, integer (no minor units / floats). */
  price: number;
  /** Convenience per-hour rate in THB for display; derived, never authoritative. */
  perHour: number;
  validity: Validity;
  tag?: CatalogTag;
  /** Bilingual display name (e.g. "10 hours", "1:1 · 8-hour pack"). */
  label: Bilingual;
  /** Bilingual one-line descriptor under the label (validity / plan). */
  sublabel: Bilingual;
}

/** A display group of items (the prototype's PACKAGE_CATS tabs). */
export interface CatalogCategory {
  id: PackageCategory;
  label: Bilingual;
  note: Bilingual;
  items: CatalogItem[];
}

// ───────────────────────── bilingual label fragments ─────────────────────────
// Mirrors lune-data.jsx STR validity / format / plan labels. Kept local so the
// catalog is self-describing; the UI may also key these in strings.ts if needed.

const VALIDITY_LABEL: Record<Validity, Bilingual> = {
  single_visit: { en: "Single visit", th: "ครั้งเดียว" },
  one_month: { en: "Valid 1 month", th: "ใช้ได้ 1 เดือน" },
  two_months: { en: "Valid 2 months", th: "ใช้ได้ 2 เดือน" },
  three_months: { en: "Valid 3 months", th: "ใช้ได้ 3 เดือน" },
};

const FMT_LABEL = {
  solo: { en: "1:1", th: "1:1" },
  duo: { en: "Duo", th: "ดูโอ" },
  trio: { en: "Trio", th: "ทรีโอ" },
} as const;

const PLAN_LABEL = {
  drop: { en: "Drop-in", th: "ดรอปอิน" },
  pack8: { en: "8-hour pack", th: "แพ็ก 8 ชม." },
  rental: { en: "Full apparatus", th: "อุปกรณ์ครบชุด" },
} as const;

type Fmt = keyof typeof FMT_LABEL;
type Plan = keyof typeof PLAN_LABEL;

function hoursLabel(hours: number): Bilingual {
  return hours === 1
    ? { en: "1 hour", th: "1 ชั่วโมง" }
    : { en: `${hours} hours`, th: `${hours} ชั่วโมง` };
}

/** "1:1 · 8-hour pack" — joins a format with a plan for non-group items. */
function fmtPlanLabel(fmt: Fmt, plan: Plan): Bilingual {
  const f = FMT_LABEL[fmt];
  const p = PLAN_LABEL[plan];
  return { en: `${f.en} · ${p.en}`, th: `${f.th} · ${p.th}` };
}

// ───────────────────────── the catalog (canonical numbers) ─────────────────────────
// Numbers copied verbatim from lune-data.jsx PACKAGE_CATS. Group = sharable hour
// credits; Private & Semi = format packs (1:1 / Duo / Trio); Rental = per-hour
// apparatus. perHour is derived (price / hours) and kept for display parity.

const GROUP_ITEMS: CatalogItem[] = [
  {
    id: "drop", category: "group", hours: 1, price: 650, perHour: 650, validity: "single_visit",
    label: hoursLabel(1), sublabel: VALIDITY_LABEL.single_visit,
  },
  {
    id: "p5", category: "group", hours: 5, price: 2950, perHour: 590, validity: "one_month",
    label: hoursLabel(5), sublabel: VALIDITY_LABEL.one_month,
  },
  {
    id: "p10", category: "group", hours: 10, price: 5500, perHour: 550, validity: "two_months",
    tag: "popular", label: hoursLabel(10), sublabel: VALIDITY_LABEL.two_months,
  },
  {
    id: "p15", category: "group", hours: 15, price: 7500, perHour: 500, validity: "three_months",
    tag: "best_value", label: hoursLabel(15), sublabel: VALIDITY_LABEL.three_months,
  },
];

const PRIVATE_ITEMS: CatalogItem[] = [
  {
    id: "pv-drop", category: "private", hours: 1, price: 1700, perHour: 1700, validity: "single_visit",
    label: fmtPlanLabel("solo", "drop"), sublabel: VALIDITY_LABEL.single_visit,
  },
  {
    id: "pv8", category: "private", hours: 8, price: 12000, perHour: 1500, validity: "two_months",
    tag: "best_value", label: fmtPlanLabel("solo", "pack8"), sublabel: VALIDITY_LABEL.two_months,
  },
  {
    id: "duo-drop", category: "private", hours: 1, price: 2000, perHour: 2000, validity: "single_visit",
    label: fmtPlanLabel("duo", "drop"), sublabel: VALIDITY_LABEL.single_visit,
  },
  {
    id: "duo8", category: "private", hours: 8, price: 14400, perHour: 1800, validity: "two_months",
    label: fmtPlanLabel("duo", "pack8"), sublabel: VALIDITY_LABEL.two_months,
  },
  {
    id: "trio-drop", category: "private", hours: 1, price: 2200, perHour: 2200, validity: "single_visit",
    label: fmtPlanLabel("trio", "drop"), sublabel: VALIDITY_LABEL.single_visit,
  },
  {
    id: "trio8", category: "private", hours: 8, price: 16000, perHour: 2000, validity: "two_months",
    label: fmtPlanLabel("trio", "pack8"), sublabel: VALIDITY_LABEL.two_months,
  },
];

const RENTAL_ITEMS: CatalogItem[] = [
  {
    id: "r-solo", category: "rental", hours: 1, price: 600, perHour: 600, validity: "single_visit",
    label: fmtPlanLabel("solo", "rental"), sublabel: VALIDITY_LABEL.single_visit,
  },
  {
    id: "r-duo", category: "rental", hours: 1, price: 800, perHour: 800, validity: "single_visit",
    label: fmtPlanLabel("duo", "rental"), sublabel: VALIDITY_LABEL.single_visit,
  },
  {
    id: "r-trio", category: "rental", hours: 1, price: 1000, perHour: 1000, validity: "single_visit",
    label: fmtPlanLabel("trio", "rental"), sublabel: VALIDITY_LABEL.single_visit,
  },
];

const CATALOG: CatalogCategory[] = [
  {
    id: "group",
    label: { en: "Group Class", th: "คลาสกลุ่ม" },
    note: { en: "Hour credits · sharable for members", th: "เครดิตชั่วโมง · สมาชิกแบ่งปันได้" },
    items: GROUP_ITEMS,
  },
  {
    id: "private",
    label: { en: "Private & Semi", th: "ส่วนตัว & กลุ่มเล็ก" },
    note: {
      en: "Choose your instructor · 8-hr packs valid 2 months",
      th: "เลือกผู้สอน · แพ็ก 8 ชม. ใช้ได้ 2 เดือน",
    },
    items: PRIVATE_ITEMS,
  },
  {
    id: "rental",
    label: { en: "Studio Rental", th: "เช่าสตูดิโอ" },
    note: { en: "Full apparatus · per hour", th: "อุปกรณ์ครบชุด · ต่อชั่วโมง" },
    items: RENTAL_ITEMS,
  },
];

/** Flat id → item index for O(1) server-side price/hour lookups. */
const ITEM_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.flatMap((c) => c.items).map((item) => [item.id, item]),
);

/**
 * The full catalog, grouped by category for the buy-credits UI. Returns the
 * canonical structure (read-only by contract — do not mutate).
 */
export function listPackageCatalog(): CatalogCategory[] {
  return CATALOG;
}

/**
 * Look up a single catalog item by id, or `undefined` if no such item exists.
 * This is the ONLY trusted source of an item's price/hours for checkout — the
 * server resolves the item here and ignores any price the client may have sent.
 */
export function getCatalogItem(id: string): CatalogItem | undefined {
  return ITEM_BY_ID.get(id);
}
