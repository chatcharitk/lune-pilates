"use server";

// Server actions for the admin "Packages" screen — CRUD over the purchasable
// package catalog (`catalog_items`), which the studio owner now edits instead of a
// developer editing a TS constant (lib/catalog/packages.ts SEED_CATALOG is only the
// seed + empty-table fallback, exactly like BASELINE_SLOTS for the schedule).
//
// OWNER-ONLY: every action's line 1 is `requireOwner()` (lib/auth/admin.ts — v1 mock
// provider; the real staff provider swaps in at `getAdminAuth()`). An instructor is
// rejected like unauth (UNAUTHORIZED). The gate sits BEFORE input parsing and before
// the no-DB branch so it can never be reordered past them (tests/admin-auth.test.ts).
//
// GUARDRAILS — all enforced server-side (CLAUDE.md §8), never in the UI:
//
//   1. `id` is IMMUTABLE after creation. It is already the stored value in
//      `packages.type` and `charges.package_id`; renaming it would orphan every
//      historical charge and every unspent credit. Update takes the id as the KEY
//      and has no field to change it.
//   2. `category` is IMMUTABLE after creation. It decides which credit bucket a
//      booking debits (lib/credits/selectPackage.ts). Flipping it would silently
//      re-bucket already-sold balances and corrupt them. A CATEGORY_IMMUTABLE
//      failure is returned rather than quietly ignoring the field.
//   3. NEVER hard-delete. Retiring an item ARCHIVES it (active = false) so
//      `getCatalogItem` keeps resolving it forever for historical rows; only
//      `listPackageCatalog` (the purchasable list) filters it out.
//   4. hours and price are POSITIVE INTEGERS — whole credits, integer THB, no
//      floats anywhere in the money path (CLAUDE.md §8).
//   5. BOTH `labelEn` and `labelTh` are REQUIRED and non-empty (owner's decision;
//      CLAUDE.md §6 — no half-translated customer-facing copy).
//
// PROMO COUPLING (do not restructure here — documented deliberately): the 1+1 free
// trial promo keys off the LITERAL catalog id "drop" (PROMO_ITEM_ID in
// lib/credits/creditPackage.ts → `promoBonusHours`). Archiving the "drop" item, or
// replacing it with a differently-slugged drop-in, DISABLES the promo — nothing
// will match and no bonus hour is granted. Any owner-facing rename of the drop-in
// must keep the id "drop", or the promo must be re-pointed in creditPackage.ts.

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { catalogItems } from "@/lib/db/schema";
import {
  listAllCatalogItems,
  perHourFor,
  sublabelForValidity,
  type AdminCatalogItem,
  type CatalogTag,
  type Validity,
} from "@/lib/catalog/packages";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── shared validation ─────────────────────────

/** URL-safe slug: lowercase alphanumerics separated by single hyphens. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CATEGORY = z.enum(["group", "private", "rental"]);
const VALIDITY = z.enum(["single_visit", "one_month", "two_months", "three_months"]);
const TAG = z.enum(["popular", "best_value"]);

/** Whole credits, strictly positive — matches the catalog_item_hours_positive CHECK. */
const hoursField = z.number().int().positive().max(500);
/** Integer THB, non-negative — matches the catalog_item_price_nonneg CHECK. */
const priceField = z.number().int().min(0).max(10_000_000);
/** Required, non-empty bilingual copy: BOTH languages, always. */
const labelField = z.string().trim().min(1).max(60);

const createInput = z.object({
  id: z.string().trim().toLowerCase().min(2).max(40).regex(SLUG_RE),
  category: CATEGORY,
  hours: hoursField,
  price: priceField,
  validity: VALIDITY,
  tag: TAG.nullable().optional(),
  labelEn: labelField,
  labelTh: labelField,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreateCatalogItemInput = z.infer<typeof createInput>;

// `id` is absent by design (immutable — it is the KEY, passed separately).
// `category` is accepted ONLY so a stale client can be told CATEGORY_IMMUTABLE
// rather than silently having the change dropped.
const updateInput = z.object({
  id: z.string().trim().min(1).max(40),
  category: CATEGORY.optional(),
  hours: hoursField,
  price: priceField,
  validity: VALIDITY,
  tag: TAG.nullable().optional(),
  labelEn: labelField,
  labelTh: labelField,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type UpdateCatalogItemInput = z.infer<typeof updateInput>;

const idInput = z.object({ id: z.string().trim().min(1).max(40) });

const reorderInput = z.object({
  /** Item ids in their new display order (within their own categories). */
  ids: z.array(z.string().trim().min(1).max(40)).min(1).max(200),
});
export type ReorderCatalogInput = z.infer<typeof reorderInput>;

// ───────────────────────── result contracts ─────────────────────────

/**
 * MOCK_NO_DB — the action ran in `mockDataMode()` (no DATABASE_URL / mock data dev
 * mode), so the input VALIDATED but NOTHING was persisted. It is returned as a
 * FAILURE deliberately: reporting ok:true here made the UI flash a success toast and
 * then re-render the unchanged seed list, which reads as data loss. The frontend
 * should surface it as "demo mode — not saved" (i18n key `err_cat_mock_no_db`), not
 * as a generic error.
 */
export type MockNoDbCode = "MOCK_NO_DB";

export type CreateCatalogItemFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "DUPLICATE_ID"
  | MockNoDbCode;

export type CreateCatalogItemResult =
  | { ok: true; item: AdminCatalogItem }
  | { ok: false; code: CreateCatalogItemFailureCode };

export type UpdateCatalogItemFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_ITEM"
  | "CATEGORY_IMMUTABLE"
  | MockNoDbCode;

export type UpdateCatalogItemResult =
  | { ok: true; item: AdminCatalogItem }
  | { ok: false; code: UpdateCatalogItemFailureCode };

export type ArchiveCatalogItemFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_ITEM"
  | MockNoDbCode;

export type ArchiveCatalogItemResult =
  | { ok: true; id: string; active: boolean }
  | { ok: false; code: ArchiveCatalogItemFailureCode };

export type ReorderCatalogFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | MockNoDbCode;

export type ReorderCatalogResult =
  | { ok: true }
  | { ok: false; code: ReorderCatalogFailureCode };

export type ListCatalogFailureCode = "UNAUTHORIZED";

export type ListCatalogResult =
  | { ok: true; items: AdminCatalogItem[] }
  | { ok: false; code: ListCatalogFailureCode };

// ───────────────────────── read ─────────────────────────

/**
 * Every catalog item INCLUDING archived ones, for the management screen. Ordered by
 * category then sortOrder. Owner-only (pricing is commercially sensitive).
 */
export async function listCatalogForAdmin(): Promise<ListCatalogResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };
  return { ok: true, items: await listAllCatalogItems() };
}

// ───────────────────────── create ─────────────────────────

/**
 * Add a new purchasable item. The id is a stable, url-safe slug the owner chooses;
 * it becomes `packages.type` / `charges.package_id` forever, so it is validated for
 * shape AND uniqueness — including against ARCHIVED items, since reusing a retired
 * slug would silently re-point every historical row at the new item's price/hours.
 */
export async function createCatalogItem(
  raw: CreateCatalogItemInput,
): Promise<CreateCatalogItemResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = createInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  // Mock-data dev mode: the input is fully validated above, but there is no database
  // to write to. Report MOCK_NO_DB rather than a fake success — see MockNoDbCode.
  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  const db = getDb();

  // Collision check across ALL items, archived included (see doc comment). The PK
  // is the real backstop — a racing insert surfaces as DUPLICATE_ID below.
  const existing = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(eq(catalogItems.id, input.id))
    .limit(1);
  if (existing.length > 0) return { ok: false, code: "DUPLICATE_ID" };

  const sortOrder = input.sortOrder ?? (await nextSortOrder(input.category));

  try {
    const [row] = await db
      .insert(catalogItems)
      .values({
        id: input.id,
        category: input.category,
        hours: input.hours,
        price: input.price,
        validity: input.validity,
        tag: input.tag ?? null,
        labelEn: input.labelEn,
        labelTh: input.labelTh,
        active: true,
        sortOrder,
      })
      .returning({ id: catalogItems.id });
    if (!row) return { ok: false, code: "INVALID_INPUT" };
  } catch {
    // Unique-violation on the PK (a concurrent create of the same slug) — the
    // pre-check above lost the race. Fail closed rather than overwriting.
    return { ok: false, code: "DUPLICATE_ID" };
  }

  revalidateCatalog();
  return { ok: true, item: synthesizeItem(input, true, sortOrder) };
}

// ───────────────────────── update ─────────────────────────

/**
 * Edit an existing item's price / hours / validity / tag / labels / order.
 *
 * `id` is the KEY and cannot be changed (guardrail 1). `category` may be SENT (a
 * form round-trips it) but any value differing from the stored one is rejected with
 * CATEGORY_IMMUTABLE (guardrail 2) — never silently ignored, so the owner learns the
 * change did not apply rather than assuming it did.
 *
 * Archived items remain editable (fixing a typo on a retired package is harmless);
 * `active` is changed only through archive/restore.
 */
export async function updateCatalogItem(
  raw: UpdateCatalogItemInput,
): Promise<UpdateCatalogItemResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  // Mock-data dev mode: the guardrails still answer truthfully against the seed
  // catalog (an unknown id / a category move is wrong in ANY mode), but a valid edit
  // has nowhere to persist — so it reports MOCK_NO_DB instead of a fake success.
  if (mockDataMode()) {
    const seedItem = (await listAllCatalogItems()).find((i) => i.id === input.id);
    if (!seedItem) return { ok: false, code: "UNKNOWN_ITEM" };
    if (input.category !== undefined && input.category !== seedItem.category) {
      return { ok: false, code: "CATEGORY_IMMUTABLE" };
    }
    return { ok: false, code: "MOCK_NO_DB" };
  }

  const db = getDb();
  const [current] = await db
    .select({
      category: catalogItems.category,
      active: catalogItems.active,
      sortOrder: catalogItems.sortOrder,
    })
    .from(catalogItems)
    .where(eq(catalogItems.id, input.id))
    .limit(1);
  if (!current) return { ok: false, code: "UNKNOWN_ITEM" };

  // GUARDRAIL 2 — the credit bucket a booking debits can never move.
  if (input.category !== undefined && input.category !== current.category) {
    return { ok: false, code: "CATEGORY_IMMUTABLE" };
  }

  const sortOrder = input.sortOrder ?? current.sortOrder;

  // NOTE the omitted columns: `id` and `category` are never in the SET clause.
  await db
    .update(catalogItems)
    .set({
      hours: input.hours,
      price: input.price,
      validity: input.validity,
      tag: input.tag ?? null,
      labelEn: input.labelEn,
      labelTh: input.labelTh,
      sortOrder,
    })
    .where(eq(catalogItems.id, input.id));

  revalidateCatalog();
  return {
    ok: true,
    item: synthesizeItem({ ...input, category: current.category }, current.active, sortOrder),
  };
}

// ───────────────────────── archive / restore ─────────────────────────

/**
 * Retire an item from sale. ARCHIVE ONLY — never a DELETE (guardrail 3): the row
 * must survive so `packages.type` / `charges.package_id` keep resolving to a real
 * label, hour count and category for every past purchase and every unspent credit.
 *
 * Archiving "drop" disables the 1+1 trial promo — see the PROMO COUPLING note at the
 * top of this file.
 */
export async function archiveCatalogItem(rawId: string): Promise<ArchiveCatalogItemResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };
  return await setActive(rawId, false);
}

/** Put an archived item back on sale. */
export async function restoreCatalogItem(rawId: string): Promise<ArchiveCatalogItemResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };
  return await setActive(rawId, true);
}

async function setActive(rawId: string, active: boolean): Promise<ArchiveCatalogItemResult> {
  const parsed = idInput.safeParse({ id: rawId });
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { id } = parsed.data;

  // Mock-data dev mode: an unknown id is still UNKNOWN_ITEM, but a real retire has
  // nowhere to persist — MOCK_NO_DB rather than a success the list won't reflect.
  if (mockDataMode()) {
    const exists = (await listAllCatalogItems()).some((i) => i.id === id);
    return exists ? { ok: false, code: "MOCK_NO_DB" } : { ok: false, code: "UNKNOWN_ITEM" };
  }

  const db = getDb();
  const rows = await db
    .update(catalogItems)
    .set({ active })
    .where(eq(catalogItems.id, id))
    .returning({ id: catalogItems.id });
  if (rows.length === 0) return { ok: false, code: "UNKNOWN_ITEM" };

  revalidateCatalog();
  return { ok: true, id, active };
}

// ───────────────────────── reorder ─────────────────────────

/**
 * Re-sequence the display order. `ids` is the new order; each item's sortOrder is
 * set to its index × 10 (leaving gaps for a later single insert). Unknown ids are
 * simply not matched — reordering is cosmetic and must never fail a whole save.
 */
export async function reorderCatalog(raw: ReorderCatalogInput): Promise<ReorderCatalogResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = reorderInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { ids } = parsed.data;
  if (new Set(ids).size !== ids.length) return { ok: false, code: "INVALID_INPUT" };

  // Mock-data dev mode: nothing to persist — see MockNoDbCode.
  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  const db = getDb();
  // One transaction so a partial reorder can never leave two items sharing a slot.
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(catalogItems)
        .set({ sortOrder: index * 10 })
        .where(eq(catalogItems.id, id));
    }
  });

  revalidateCatalog();
  return { ok: true };
}

// ───────────────────────── helpers ─────────────────────────

/**
 * The next free sortOrder slot at the end of a category (gaps of 10).
 *
 * NOTE: this is a bare aggregate with NO group-by, so it must NOT carry an ORDER BY
 * on the un-aggregated `sort_order` column — Postgres rejects that outright
 * ("column must appear in the GROUP BY clause or be used in an aggregate function"),
 * which made EVERY create throw. The aggregate already returns exactly one row, so
 * ordering was meaningless as well as illegal. COALESCE keeps the empty-category
 * case (no rows → max is NULL) inside SQL rather than relying on the driver's null.
 */
async function nextSortOrder(category: "group" | "private" | "rental"): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ next: sql<number>`coalesce(max(${catalogItems.sortOrder}), -10) + 10` })
    .from(catalogItems)
    .where(eq(catalogItems.category, category));
  return Number(row?.next ?? 0);
}

/** Shape the action's echo of the written row, deriving perHour + sublabel. */
function synthesizeItem(
  input: {
    id: string;
    category: "group" | "private" | "rental";
    hours: number;
    price: number;
    validity: Validity;
    tag?: CatalogTag | null;
    labelEn: string;
    labelTh: string;
  },
  active: boolean,
  sortOrder: number,
): AdminCatalogItem {
  return {
    id: input.id,
    category: input.category,
    hours: input.hours,
    price: input.price,
    perHour: perHourFor(input.price, input.hours),
    validity: input.validity,
    ...(input.tag ? { tag: input.tag } : {}),
    label: { en: input.labelEn, th: input.labelTh },
    sublabel: sublabelForValidity(input.validity),
    active,
    sortOrder,
  };
}

/** Every surface that renders a price or a package list. */
function revalidateCatalog(): void {
  revalidatePath("/admin/packages");
  revalidatePath("/admin/payments");
  revalidatePath("/buy");
}
