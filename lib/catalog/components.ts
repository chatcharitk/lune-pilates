// Bundle components: how one purchasable catalog item can grant SEVERAL balances,
// each in its own credit category and on its own expiry clock.
//
// Motivating offer (owner, 2026-09-08): the ฿1,800 trial is one private (1:1) class
// usable within 14 days of payment, PLUS one free group class usable within 7 days
// of that private class.
//
// The model, in one paragraph: an item's components each say WHICH bucket
// (`category`), HOW MANY credits (`hours`), HOW LONG they last once running
// (`validity`), and WHEN the clock starts (`anchorComponentKey`). A null anchor
// means "at purchase" — the ordinary case, and what every existing package does. A
// non-null anchor names a SIBLING component: this one stays DORMANT until that
// sibling is spent on a class, then runs its window from that class's start time.
//
// Backwards compatibility is total: an item with no rows in `catalog_item_components`
// resolves to ONE implicit "main" component built from its own category/hours/
// validity, which is precisely the old behaviour. Nothing about existing packages,
// prices or expiries changes.
//
// The DB table is authoritative once populated; SEED_COMPONENTS below is the seed +
// the empty-table/no-DB fallback, mirroring SEED_CATALOG / SEED_VISIBILITY_WINDOWS.

import { asc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { catalogItemComponents } from "@/lib/db/schema";
import type { PackageCategory } from "@/lib/domain/types";
import type { Bilingual } from "@/lib/i18n";
import { mockDataMode } from "@/lib/mock-mode";
import type { CatalogItem, Validity, ValidityUnit } from "./packages";

/** The component key given to an ordinary, single-balance package. */
export const MAIN_COMPONENT_KEY = "main";

/** One balance an item grants, with its own category, size and clock. */
export interface CatalogComponent {
  /** Stable slug, unique within the item. Written onto the package it creates. */
  componentKey: string;
  category: PackageCategory;
  /** Whole credits granted (2 buys one private/duo/trio class, 1 a group/rental). */
  hours: number;
  /** How long this balance lasts once its clock starts. */
  validity: Validity;
  /**
   * Null → the clock starts at purchase. Otherwise the sibling component whose use
   * starts it; this component is dormant (no expiry, unbookable) until then.
   */
  anchorComponentKey: string | null;
  sortOrder: number;
  /** Bilingual name for the customer-facing breakdown ("1:1 class", "Free group class"). */
  label: Bilingual;
}

/**
 * The single implicit component of an item that defines none — exactly the old
 * one-balance behaviour, expressed in the new vocabulary so every downstream caller
 * can treat simple items and bundles identically.
 */
export function implicitMainComponent(item: CatalogItem): CatalogComponent {
  return {
    componentKey: MAIN_COMPONENT_KEY,
    category: item.category,
    hours: item.hours,
    validity: item.validity,
    anchorComponentKey: null,
    sortOrder: 0,
    label: item.label,
  };
}

/** True when this item grants more than one balance. */
export function isBundle(components: CatalogComponent[]): boolean {
  return components.length > 1;
}

/** Total credits an item grants across all its components (the receipt figure). */
export function totalHours(components: CatalogComponent[]): number {
  return components.reduce((sum, c) => sum + c.hours, 0);
}

// ───────────────────────── seed: the ฿1,800 trial ─────────────────────────

/** The catalog id of the trial bundle (also its `packages.type`). */
export const TRIAL_ITEM_ID = "trial-1to1";

/**
 * Seed / no-DB fallback components, keyed by catalog item id. Only the trial is
 * defined: every other item is a plain single-balance package and resolves to its
 * implicit "main" component.
 */
export const SEED_COMPONENTS: Record<string, CatalogComponent[]> = {
  [TRIAL_ITEM_ID]: [
    {
      componentKey: "private",
      category: "private",
      hours: 1, // one credit = one class (lib/credits/cost.ts)
      validity: { amount: 14, unit: "day" },
      anchorComponentKey: null, // starts at purchase
      sortOrder: 0,
      label: { en: "1:1 private class", th: "คลาสส่วนตัว 1:1" },
    },
    {
      componentKey: "free_group",
      category: "group",
      hours: 1, // one group class
      validity: { amount: 7, unit: "day" },
      anchorComponentKey: "private", // dormant until the private class is taken
      sortOrder: 1,
      label: { en: "Free group class", th: "คลาสกลุ่มฟรี" },
    },
  ],
};

// ───────────────────────── loading ─────────────────────────

function isValidityUnit(v: string): v is ValidityUnit {
  return v === "day" || v === "month";
}

function rowToComponent(r: {
  componentKey: string;
  category: PackageCategory;
  hours: number;
  validityAmount: number;
  validityUnit: string;
  anchorComponentKey: string | null;
  sortOrder: number;
  labelEn: string;
  labelTh: string;
}): CatalogComponent {
  return {
    componentKey: r.componentKey,
    category: r.category,
    hours: r.hours,
    validity: {
      amount: r.validityAmount,
      // A malformed unit falls back to "day", the SHORTER window — never silently
      // extends a package beyond what the owner configured.
      unit: isValidityUnit(r.validityUnit) ? r.validityUnit : "day",
    },
    anchorComponentKey: r.anchorComponentKey,
    sortOrder: r.sortOrder,
    label: { en: r.labelEn, th: r.labelTh },
  };
}

/**
 * Components for several items at once, keyed by item id. Items with no configured
 * components are simply absent from the map — callers fall back to
 * `implicitMainComponent`. One query for a whole catalog page (never per-item in a
 * loop, mirroring loadCatalogMap's convention).
 */
export async function loadComponentsMap(
  itemIds: string[],
): Promise<Map<string, CatalogComponent[]>> {
  const byItem = new Map<string, CatalogComponent[]>();
  if (itemIds.length === 0) return byItem;

  if (mockDataMode()) {
    for (const id of itemIds) {
      const seeded = SEED_COMPONENTS[id];
      if (seeded) byItem.set(id, seeded.map((c) => ({ ...c })));
    }
    return byItem;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(catalogItemComponents)
    .where(inArray(catalogItemComponents.itemId, itemIds))
    .orderBy(asc(catalogItemComponents.sortOrder));

  for (const r of rows) {
    const list = byItem.get(r.itemId) ?? [];
    list.push(rowToComponent(r));
    byItem.set(r.itemId, list);
  }
  // Empty table (fresh deploy) → fall back to the seed for any item it defines, so
  // the trial works before anyone has touched the admin editor.
  for (const id of itemIds) {
    if (!byItem.has(id) && SEED_COMPONENTS[id]) {
      byItem.set(id, SEED_COMPONENTS[id]!.map((c) => ({ ...c })));
    }
  }
  return byItem;
}

/**
 * The components ONE item grants, always non-empty: its configured components, or
 * the single implicit "main" component derived from the item itself.
 */
export async function componentsForItem(item: CatalogItem): Promise<CatalogComponent[]> {
  const map = await loadComponentsMap([item.id]);
  const configured = map.get(item.id);
  if (!configured || configured.length === 0) return [implicitMainComponent(item)];
  return sortComponents(configured);
}

/** Purchase-anchored components first, then by sortOrder — a stable grant order. */
export function sortComponents(components: CatalogComponent[]): CatalogComponent[] {
  return [...components].sort((a, b) => {
    const aRoot = a.anchorComponentKey === null ? 0 : 1;
    const bRoot = b.anchorComponentKey === null ? 0 : 1;
    if (aRoot !== bRoot) return aRoot - bRoot;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.componentKey.localeCompare(b.componentKey);
  });
}

/**
 * Order components so that every anchor comes BEFORE the components that depend on
 * it. Crediting inserts rows in this order, so a dependent component always has its
 * anchor's package id to point at — including down a chain (A → B → C), which a
 * plain "roots first, then sortOrder" sort would not guarantee.
 *
 * Assumes an acyclic set (`validateComponentSet` enforces that before storage). If a
 * cycle ever slipped through, the unresolved remainder is appended rather than
 * dropped, so crediting would still grant every balance the customer paid for — the
 * cyclic ones simply arrive without an anchor and stay dormant, which is the safe
 * direction (recoverable by the owner, versus silently losing credit).
 */
export function topoSortComponents(components: CatalogComponent[]): CatalogComponent[] {
  const remaining = sortComponents(components);
  const placed = new Set<string>();
  const out: CatalogComponent[] = [];

  let progress = true;
  while (remaining.length > 0 && progress) {
    progress = false;
    for (let i = 0; i < remaining.length; ) {
      const c = remaining[i]!;
      const ready = c.anchorComponentKey === null || placed.has(c.anchorComponentKey);
      if (ready) {
        out.push(c);
        placed.add(c.componentKey);
        remaining.splice(i, 1);
        progress = true;
      } else {
        i++;
      }
    }
  }
  return [...out, ...remaining];
}

// ───────────────────────── validation ─────────────────────────

export type ComponentSetProblem =
  | "EMPTY"
  | "DUPLICATE_KEY"
  | "UNKNOWN_ANCHOR"
  | "NO_PURCHASE_ANCHORED_COMPONENT"
  | "ANCHOR_CYCLE";

/**
 * Check a proposed set of components is coherent BEFORE it is stored. The two that
 * really matter are structural: at least one component must start at purchase, and
 * the anchor graph must be acyclic — otherwise some balance could never activate and
 * the customer would have paid for credit they can never spend.
 */
export function validateComponentSet(components: CatalogComponent[]): ComponentSetProblem | null {
  if (components.length === 0) return "EMPTY";

  const keys = new Set<string>();
  for (const c of components) {
    if (keys.has(c.componentKey)) return "DUPLICATE_KEY";
    keys.add(c.componentKey);
  }

  for (const c of components) {
    if (c.anchorComponentKey !== null && !keys.has(c.anchorComponentKey)) {
      return "UNKNOWN_ANCHOR";
    }
  }

  if (!components.some((c) => c.anchorComponentKey === null)) {
    return "NO_PURCHASE_ANCHORED_COMPONENT";
  }

  // Walk each component's anchor chain; it must terminate at a purchase-anchored
  // root within `length` hops, or it is a cycle.
  const byKey = new Map(components.map((c) => [c.componentKey, c]));
  for (const start of components) {
    let cursor: CatalogComponent | undefined = start;
    for (let hops = 0; cursor; hops++) {
      if (hops > components.length) return "ANCHOR_CYCLE";
      if (cursor.anchorComponentKey === null) break;
      cursor = byKey.get(cursor.anchorComponentKey);
    }
  }

  return null;
}
