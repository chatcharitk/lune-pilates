// The canonical, server-side purchasable catalog — the single source of truth for
// what a customer can buy, how many hours it grants, and what it costs.
//
// The catalog is now EDITABLE by the studio owner: items live in the `catalog_items`
// table (admin CRUD via app/actions/admin-catalog.ts). This mirrors the schedule
// template exactly (lib/admin/schedule-template.ts): SEED_CATALOG below is ONLY the
// seed source and the empty-table FALLBACK — when the table has rows, the DB is
// authoritative. Numbers in SEED_CATALOG stay verbatim from lune-pilates/project/
// lune-data.jsx (PACKAGE_CATS / PACKAGES) and the spec §1 pricing.
//
// CATEGORY-LEVEL copy (label / note) stays a hardcoded constant — only ITEMS are
// editable. Prices and hours are read server-side and NEVER trusted from a client
// (CLAUDE.md §8 — recompute money server-side).
//
// Derived, never stored: `perHour` (price / hours) and `sublabel` (the validity
// label). Storing them would let them drift from price/hours.
//
// Bilingual labels follow the prototype's content-object pattern (CLAUDE.md §6):
// catalog copy is content, carried as `{ en, th }` objects the UI renders with
// `tt(...)`. Money is integer THB.

import { asc, eq } from "drizzle-orm";
import type { Bilingual } from "@/lib/i18n";
import type { PackageCategory } from "@/lib/domain/types";
import { getDb } from "@/lib/db/client";
import { catalogItems } from "@/lib/db/schema";
import { mockDataMode } from "@/lib/mock-mode";

/**
 * How long a purchased package stays usable, as a STRUCTURED amount + unit (decided
 * 2026-07-23, supersedes the fixed single_visit|one_month|two_months|three_months
 * enum). The owner picks any positive whole `amount` of `day`s or `month`s; maps to a
 * concrete `expires_at` via `expiryFromValidity` (the single place validity → expiry
 * lives). A drop-in is now simply `{ amount: 1, unit: "month" }`.
 */
export type ValidityUnit = "day" | "month";
export interface Validity {
  amount: number;
  unit: ValidityUnit;
}

export const VALIDITY_UNITS: readonly ValidityUnit[] = ["day", "month"] as const;

/**
 * Legacy free-text validity → structured pair (for rows written before the
 * amount/unit columns existed). The four old enum values map to their month/day
 * equivalents; a synthesized "N_unit" token round-trips; anything else fails safe to
 * 1 month (a drop-in still needs a window to use its credit).
 */
export function parseLegacyValidity(text: string): Validity {
  switch (text) {
    case "single_visit":
    case "one_month":
      return { amount: 1, unit: "month" };
    case "two_months":
      return { amount: 2, unit: "month" };
    case "three_months":
      return { amount: 3, unit: "month" };
  }
  // Synthesized "N_day" / "N_month" token (what new writes stamp on the DEAD legacy
  // column — see legacyValidityText). Parse it back so a legacy read still works.
  const m = /^(\d+)_(day|month)$/.exec(text);
  if (m) {
    const amount = Number.parseInt(m[1]!, 10);
    if (Number.isInteger(amount) && amount > 0) return { amount, unit: m[2] as ValidityUnit };
  }
  return { amount: 1, unit: "month" };
}

/**
 * The value written to the DEAD `validity` text column so its legacy NOT NULL
 * constraint is satisfied. The old enum tokens are preserved where they still match
 * (audit-friendliness); everything else becomes a "N_unit" token that
 * `parseLegacyValidity` round-trips. New rows always carry the structured columns, so
 * this text is never actually read back for them.
 */
export function legacyValidityText(v: Validity): string {
  if (v.unit === "month") {
    if (v.amount === 1) return "one_month";
    if (v.amount === 2) return "two_months";
    if (v.amount === 3) return "three_months";
  }
  return `${v.amount}_${v.unit}`;
}

/** Resolve a stored catalog/charge row's validity: structured columns win, legacy text is the fallback. */
export function validityFromRow(
  amount: number | null,
  unit: string | null,
  legacyText: string | null,
): Validity {
  if (amount !== null && amount > 0 && (unit === "day" || unit === "month")) {
    return { amount, unit };
  }
  return parseLegacyValidity(legacyText ?? "");
}

/** Promotional badge a catalog item can carry. */
export type CatalogTag = "popular" | "best_value";

export const CATALOG_TAGS: readonly CatalogTag[] = ["popular", "best_value"] as const;

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
  /** Convenience per-hour rate in THB for display; DERIVED, never authoritative. */
  perHour: number;
  validity: Validity;
  tag?: CatalogTag;
  /** Bilingual display name (e.g. "10 hours", "1:1 · 8-hour pack"). */
  label: Bilingual;
  /** Bilingual one-line descriptor under the label; DERIVED from `validity`. */
  sublabel: Bilingual;
}

/** A display group of items (the prototype's PACKAGE_CATS tabs). */
export interface CatalogCategory {
  id: PackageCategory;
  label: Bilingual;
  note: Bilingual;
  items: CatalogItem[];
}

/**
 * The admin read model: EVERY item including archived ones, carrying the editable
 * fields plus `active`/`sortOrder` so the management screen can render the list.
 */
export interface AdminCatalogItem extends CatalogItem {
  active: boolean;
  sortOrder: number;
}

// ───────────────────────── bilingual label fragments ─────────────────────────
// Mirrors lune-data.jsx STR validity / format / plan labels. Kept local so the
// catalog is self-describing.

/**
 * The bilingual sublabel for a structured validity — the ONE place the mapping lives.
 * "Valid X days/months" / "ใช้ได้ X วัน/เดือน", with X=1 handled (Thai has no plural,
 * English drops the trailing "s"). Thai uses วัน (day) / เดือน (month) with no count
 * word when amount is 1, matching the prototype's phrasing.
 */
export function sublabelForValidity(validity: Validity): Bilingual {
  const { amount, unit } = validity;
  if (unit === "day") {
    return amount === 1
      ? { en: "Valid 1 day", th: "ใช้ได้ 1 วัน" }
      : { en: `Valid ${amount} days`, th: `ใช้ได้ ${amount} วัน` };
  }
  return amount === 1
    ? { en: "Valid 1 month", th: "ใช้ได้ 1 เดือน" }
    : { en: `Valid ${amount} months`, th: `ใช้ได้ ${amount} เดือน` };
}

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

/** Derived per-hour display rate. The ONE place the derivation lives. */
export function perHourFor(price: number, hours: number): number {
  return Math.round(price / hours);
}

// ───────────────────────── the seed / fallback catalog ─────────────────────────
// Numbers copied verbatim from lune-data.jsx PACKAGE_CATS. Group = sharable hour
// credits; Private & Semi = format packs (1:1 / Duo / Trio); Rental = per-hour
// apparatus.
//
// This constant is the SEED (scripts/seed-catalog.ts upserts it into catalog_items)
// and the FALLBACK used when there is no DATABASE_URL or the table is empty —
// exactly the role BASELINE_SLOTS plays for the schedule template. Once the table
// has rows, the DB wins and edits here have no effect on a live studio.

/** The stored shape of a seed item: no derived `perHour` / `sublabel`. */
export interface CatalogSeedItem {
  id: string;
  category: PackageCategory;
  hours: number;
  price: number;
  validity: Validity;
  tag?: CatalogTag;
  label: Bilingual;
  /** Display order WITHIN the category (ascending). */
  sortOrder: number;
}

// Structured-validity shorthands, so the seed rows below stay readable. The old enum
// mapping is preserved exactly: single_visit / one_month → 1 month; two_months → 2
// months; three_months → 3 months (so effective expiries are byte-for-byte unchanged).
const V1M: Validity = { amount: 1, unit: "month" };
const V2M: Validity = { amount: 2, unit: "month" };
const V3M: Validity = { amount: 3, unit: "month" };

export const SEED_CATALOG: readonly CatalogSeedItem[] = [
  // group
  { id: "drop", category: "group", hours: 1, price: 650, validity: V1M, label: hoursLabel(1), sortOrder: 0 },
  { id: "p5", category: "group", hours: 5, price: 2950, validity: V1M, label: hoursLabel(5), sortOrder: 10 },
  { id: "p10", category: "group", hours: 10, price: 5500, validity: V2M, tag: "popular", label: hoursLabel(10), sortOrder: 20 },
  { id: "p15", category: "group", hours: 20, price: 10000, validity: V3M, tag: "best_value", label: hoursLabel(20), sortOrder: 30 },
  // private & semi
  { id: "pv-drop", category: "private", hours: 1, price: 1700, validity: V1M, label: fmtPlanLabel("solo", "drop"), sortOrder: 0 },
  { id: "pv8", category: "private", hours: 8, price: 12000, validity: V2M, tag: "best_value", label: fmtPlanLabel("solo", "pack8"), sortOrder: 10 },
  { id: "duo-drop", category: "private", hours: 1, price: 2000, validity: V1M, label: fmtPlanLabel("duo", "drop"), sortOrder: 20 },
  { id: "duo8", category: "private", hours: 8, price: 14400, validity: V2M, label: fmtPlanLabel("duo", "pack8"), sortOrder: 30 },
  { id: "trio-drop", category: "private", hours: 1, price: 2200, validity: V1M, label: fmtPlanLabel("trio", "drop"), sortOrder: 40 },
  { id: "trio8", category: "private", hours: 8, price: 16000, validity: V2M, label: fmtPlanLabel("trio", "pack8"), sortOrder: 50 },
  // studio rental
  { id: "r-solo", category: "rental", hours: 1, price: 600, validity: V1M, label: fmtPlanLabel("solo", "rental"), sortOrder: 0 },
  { id: "r-duo", category: "rental", hours: 1, price: 800, validity: V1M, label: fmtPlanLabel("duo", "rental"), sortOrder: 10 },
  { id: "r-trio", category: "rental", hours: 1, price: 1000, validity: V1M, label: fmtPlanLabel("trio", "rental"), sortOrder: 20 },
] as const;

/**
 * Category-level display copy (the prototype's PACKAGE_CATS tabs). NOT editable by
 * the owner — only the items inside a category are.
 */
export const CATEGORY_META: Record<PackageCategory, { label: Bilingual; note: Bilingual }> = {
  group: {
    label: { en: "Group Class", th: "คลาสกลุ่ม" },
    note: { en: "Hour credits · sharable for members", th: "เครดิตชั่วโมง · สมาชิกแบ่งปันได้" },
  },
  private: {
    label: { en: "Private & Semi", th: "ส่วนตัว & กลุ่มเล็ก" },
    note: {
      en: "Choose your instructor · 8-hr packs valid 2 months",
      th: "เลือกผู้สอน · แพ็ก 8 ชม. ใช้ได้ 2 เดือน",
    },
  },
  rental: {
    label: { en: "Studio Rental", th: "เช่าสตูดิโอ" },
    note: { en: "Full apparatus · per hour", th: "อุปกรณ์ครบชุด · ต่อชั่วโมง" },
  },
};

/** Display order of the categories (the tab order). */
const CATEGORY_ORDER: readonly PackageCategory[] = ["group", "private", "rental"] as const;

/**
 * Categories hidden from the buy + POS UIs. Studio rental was un-hidden 2026-07-23
 * (monthly-release model went live — lib/schedule/rental.ts), so this is now empty.
 * Kept as the single knob for hiding a category without touching the loop below.
 */
const HIDDEN_CATEGORIES: readonly PackageCategory[] = [] as const;

// ───────────────────────── row → contract shaping ─────────────────────────

/** Hydrate a seed/stored record into the full contract by deriving perHour + sublabel. */
function toCatalogItem(seed: CatalogSeedItem): CatalogItem {
  return {
    id: seed.id,
    category: seed.category,
    hours: seed.hours,
    price: seed.price,
    perHour: perHourFor(seed.price, seed.hours),
    validity: seed.validity,
    ...(seed.tag ? { tag: seed.tag } : {}),
    label: seed.label,
    sublabel: sublabelForValidity(seed.validity),
  };
}

/** Narrow a free-text stored tag; anything unknown becomes no badge. */
function asTag(v: string | null): CatalogTag | undefined {
  return v !== null && (CATALOG_TAGS as readonly string[]).includes(v) ? (v as CatalogTag) : undefined;
}

interface CatalogRow {
  id: string;
  category: PackageCategory;
  hours: number;
  price: number;
  /** Legacy free-text validity (DEAD; only the fallback for pre-migration rows). */
  validity: string;
  /** Structured validity columns (2026-07-23); null on pre-migration rows. */
  validityAmount: number | null;
  validityUnit: string | null;
  tag: string | null;
  labelEn: string;
  labelTh: string;
  active: boolean;
  sortOrder: number;
}

function rowToAdminItem(r: CatalogRow): AdminCatalogItem {
  const seed: CatalogSeedItem = {
    id: r.id,
    category: r.category,
    hours: r.hours,
    price: r.price,
    validity: validityFromRow(r.validityAmount, r.validityUnit, r.validity),
    ...(asTag(r.tag) ? { tag: asTag(r.tag)! } : {}),
    label: { en: r.labelEn, th: r.labelTh },
    sortOrder: r.sortOrder,
  };
  return { ...toCatalogItem(seed), active: r.active, sortOrder: r.sortOrder };
}

/** The seed catalog as admin items (all active), the fallback shape. */
function seedAdminItems(): AdminCatalogItem[] {
  return SEED_CATALOG.map((s) => ({ ...toCatalogItem(s), active: true, sortOrder: s.sortOrder }));
}

// ───────────────────────── public reads ─────────────────────────

const SELECT_COLUMNS = {
  id: catalogItems.id,
  category: catalogItems.category,
  hours: catalogItems.hours,
  price: catalogItems.price,
  validity: catalogItems.validity,
  validityAmount: catalogItems.validityAmount,
  validityUnit: catalogItems.validityUnit,
  tag: catalogItems.tag,
  labelEn: catalogItems.labelEn,
  labelTh: catalogItems.labelTh,
  active: catalogItems.active,
  sortOrder: catalogItems.sortOrder,
};

/**
 * EVERY catalog item — including ARCHIVED (active=false) ones — as the admin read
 * model, ordered by category then sortOrder.
 *
 * FALLBACK: when the table is EMPTY (before seeding) or there is no DATABASE_URL,
 * falls back to SEED_CATALOG so the app behaves exactly as it did before the table
 * existed. Once the table has rows, the DB is authoritative.
 */
export async function listAllCatalogItems(): Promise<AdminCatalogItem[]> {
  if (mockDataMode()) return seedAdminItems();

  const db = getDb();
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(catalogItems)
    .orderBy(asc(catalogItems.category), asc(catalogItems.sortOrder), asc(catalogItems.id));

  if (rows.length === 0) return seedAdminItems();
  return rows.map(rowToAdminItem);
}

/**
 * A `Map<id, CatalogItem>` over the WHOLE catalog (archived included), loaded once.
 *
 * This exists so PURE shaping helpers stay pure and synchronous: a query function
 * loads the map ONCE at the top and passes it into the helper, instead of every
 * helper awaiting its own read (an N+1 per row). See lib/admin/payments.ts
 * `packageLabelFor` and lib/admin/analytics.ts `categoryForPackageId`.
 */
export async function loadCatalogMap(): Promise<Map<string, CatalogItem>> {
  const items = await listAllCatalogItems();
  return new Map(items.map((i) => [i.id, i as CatalogItem]));
}

/**
 * Look up a single catalog item by id, or `undefined` if no such item exists.
 * This is the ONLY trusted source of an item's price/hours for checkout — the
 * server resolves the item here and ignores any price the client may have sent.
 *
 * Resolves ARCHIVED items too, deliberately: historical charges (charges.package_id)
 * and unspent credits (packages.type) reference ids that may since have been
 * archived, and they must keep resolving to their label/hours/category forever.
 * Gating what is PURCHASABLE is `listPackageCatalog`'s job, not this one's.
 */
export async function getCatalogItem(id: string): Promise<CatalogItem | undefined> {
  if (!id) return undefined;

  if (mockDataMode()) {
    const seed = SEED_CATALOG.find((s) => s.id === id);
    return seed ? toCatalogItem(seed) : undefined;
  }

  const db = getDb();
  const rows = await db.select(SELECT_COLUMNS).from(catalogItems).where(eq(catalogItems.id, id)).limit(1);
  const row = rows[0];
  if (row) return rowToAdminItem(row);

  // Empty-table fallback: before the seed has run, resolve from the constant.
  const anyRow = await db.select({ id: catalogItems.id }).from(catalogItems).limit(1);
  if (anyRow.length > 0) return undefined; // table is populated → genuinely unknown id

  const seed = SEED_CATALOG.find((s) => s.id === id);
  return seed ? toCatalogItem(seed) : undefined;
}

/**
 * The PURCHASABLE catalog, grouped by category for the buy-credits + POS UIs.
 * Only ACTIVE items, ordered by sortOrder; hidden categories (rental) are omitted.
 * Empty categories are dropped so the UI never renders a blank tab.
 */
export async function listPackageCatalog(): Promise<CatalogCategory[]> {
  const all = await listAllCatalogItems();

  const groups: CatalogCategory[] = [];
  for (const id of CATEGORY_ORDER) {
    if (HIDDEN_CATEGORIES.includes(id)) continue;
    const items = all
      .filter((i) => i.active && i.category === id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(
        (i): CatalogItem => ({
          id: i.id,
          category: i.category,
          hours: i.hours,
          price: i.price,
          perHour: i.perHour,
          validity: i.validity,
          ...(i.tag ? { tag: i.tag } : {}),
          label: i.label,
          sublabel: i.sublabel,
        }),
      );
    if (items.length === 0) continue;
    groups.push({ id, label: CATEGORY_META[id].label, note: CATEGORY_META[id].note, items });
  }
  return groups;
}
