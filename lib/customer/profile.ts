// Read model for the customer Profile screen (completeness findings C2 + H1).
//
// One server-resolved view the Profile UI renders directly (lune-extra.jsx
// `ProfileScreen`): identity (name / tier / house), the shared-pool balance + soonest
// expiry, the household-sharing surface ("who's on the house number"), and the pool's
// package purchase history. The frontend builds the UI; this is the typed contract.
//
// NON-NEGOTIABLES (CLAUDE.md §5/§8):
//   - Everything is server-resolved from the session (`getCurrentUser`); the client
//     passes NOTHING trust-bearing (no identity, tier, household, balance, or price).
//   - The balance is single-sourced from `getCreditOverview` — we do NOT recompute the
//     ledger by hand, so Profile and Home can never show divergent numbers (invariant 2).
//   - Guests have NO household (invariant 3): house number is null and the housemate
//     list is empty by construction.
//   - No-DB dev fallback (mirrors `getCurrentUser`'s MOCK_SESSION_USER and the prototype
//     ProfileScreen) so the screen renders without a database.

import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { charges, households, packages, users } from "@/lib/db/schema";
import { getCatalogItem } from "@/lib/catalog/packages";
import type { UserTier } from "@/lib/domain/types";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { getCreditOverview } from "@/lib/credits/selectPackage";
import { getMockSession } from "@/lib/mock/session";

/** A person sharing the household pool (invariant 2 — one shared house number). */
export interface Housemate {
  id: string;
  name: string;
  tier: UserTier;
  /** true for the current viewer, so the UI can mark "you". */
  isViewer: boolean;
}

/** One past package purchase for the pool. `pricePaid` is null when no charge backs
 *  the package (e.g. a seeded/comped package) — we surface the real price or null,
 *  never an invented one. */
export interface PurchaseHistoryItem {
  /** The package row id. */
  id: string;
  /** Catalog item id the package was bought as (e.g. "p10"), for label resolution. */
  itemId: string;
  /** Bilingual catalog name (e.g. "10 hours"), resolved server-side from the catalog. */
  label: { en: string; th: string };
  /** Hours the package granted (== hours_total at purchase). */
  hours: number;
  /** THB paid, integer — null when no charge backs the package. */
  pricePaid: number | null;
  /** When the package was acquired (charge instant when present, else package createdAt). */
  purchasedAt: Date;
}

/** The full Profile read model the customer screen renders. */
export interface ProfileOverview {
  /** The current viewer's identity, all server-resolved from the session. */
  identity: {
    userId: string;
    name: string;
    tier: UserTier;
    /** House number for a member with a household; null for guests (invariant 3). */
    houseNumber: string | null;
  };
  /** The shared-pool balance summary — single-sourced from `getCreditOverview`. */
  balance: {
    /** Usable group hours in the viewer's pool. */
    hours: number;
    /** Soonest expiry across the pool, or null when empty. */
    nearestExpiry: Date | null;
    /** true when this is a shared household pool (member) vs a personal one. */
    isHouseholdPool: boolean;
  };
  /** Who shares the house number (H1). Empty for a guest or a member without a household. */
  housemates: Housemate[];
  /** The pool's package purchases, most-recent first. */
  purchaseHistory: PurchaseHistoryItem[];
}

/** Cap on purchase-history rows returned (most-recent first). */
const PURCHASE_HISTORY_LIMIT = 20;

/** True when `viewer` reads a shared HOUSEHOLD pool (member WITH a household). The
 *  single place this member-vs-guest rule is mirrored from selectPackage's `ownerWhere`.
 *  Exported so the invariant-3 boundary (guests never share a pool) is unit-testable. */
export function sharesHousehold(
  viewer: Pick<SessionUser, "tier" | "householdId">,
): boolean {
  return viewer.tier === "member" && viewer.householdId !== null;
}

/**
 * The package-ownership filter for `viewer`'s pool — the SAME rule as
 * selectPackage's `ownerWhere`: a member with a household reads the shared
 * household-owned packages; a guest (or member without a household) reads only their
 * own. Single-sourcing the rule keeps purchase history aligned with the balance.
 */
function poolPackagesWhere(viewer: SessionUser): SQL {
  return sharesHousehold(viewer)
    ? (and(eq(packages.ownerHouseholdId, viewer.householdId!), isNull(packages.ownerUserId)) as SQL)
    : (and(eq(packages.ownerUserId, viewer.id), isNull(packages.ownerHouseholdId)) as SQL);
}

/**
 * The mock Profile for the no-DB dev path. Identity matches `getCurrentUser`'s
 * MOCK_SESSION_USER and the mock session; housemates + purchase history mirror the
 * prototype ProfileScreen sample so the screen renders fully without a database.
 */
function mockProfileOverview(): ProfileOverview {
  const session = getMockSession();
  const viewerName = session.name.en;
  return {
    identity: {
      userId: "00000000-0000-4000-8000-000000000001",
      name: viewerName,
      tier: session.isMember ? "member" : "guest",
      houseNumber: session.house,
    },
    balance: {
      hours: session.credits,
      nearestExpiry: null,
      isHouseholdPool: session.isHouseholdPool,
    },
    // Same house number — the viewer plus one housemate (mirrors the prototype's
    // "shared household" framing). The viewer is marked so the UI can render "you".
    housemates: [
      { id: "00000000-0000-4000-8000-000000000001", name: viewerName, tier: "member", isViewer: true },
      { id: "00000000-0000-4000-8000-000000000002", name: "Nan", tier: "member", isViewer: false },
    ],
    // The prototype's two sample purchases (p10, p5), most-recent first.
    purchaseHistory: [
      buildMockPurchase("h1", "p10", 5500, "2026-05-18T10:00:00+07:00"),
      buildMockPurchase("h2", "p5", 2950, "2026-05-02T10:00:00+07:00"),
    ],
  };
}

/** Build one mock purchase row from a catalog id, resolving its label/hours from the catalog. */
function buildMockPurchase(id: string, itemId: string, price: number, iso: string): PurchaseHistoryItem {
  const item = getCatalogItem(itemId);
  return {
    id,
    itemId,
    label: item?.label ?? { en: itemId, th: itemId },
    hours: item?.hours ?? 0,
    pricePaid: price,
    purchasedAt: new Date(iso),
  };
}

/**
 * Resolve the full Profile read model for the current session user.
 *
 * - Identity / tier / house number from the server-side session (`getCurrentUser`).
 * - Balance single-sourced from `getCreditOverview` (no hand-rolled ledger math).
 * - Housemates (H1): every user sharing the viewer's `household_id` — only for a
 *   member WITH a household; empty for a guest / member without a household (invariant 3).
 * - Purchase history: the pool's packages, LEFT-joined to the charge that credited
 *   them for the real `pricePaid` (null when none), newest-first, capped at
 *   PURCHASE_HISTORY_LIMIT. Labels/hours resolved from the canonical catalog.
 *
 * No-DB dev fallback returns the mock so the Profile screen renders without a database.
 */
export async function getProfileOverview(now: Date = new Date()): Promise<ProfileOverview> {
  if (!process.env.DATABASE_URL) {
    return mockProfileOverview();
  }

  const viewer = await getCurrentUser();

  // Balance (single-sourced from the shared credit-overview logic, invariant 2),
  // housemates and purchase history all depend only on `viewer` — ONE parallel round.
  const [credit, housemates, purchaseHistory] = await Promise.all([
    getCreditOverview(viewer, now),
    loadHousemates(viewer),
    loadPurchaseHistory(viewer),
  ]);

  return {
    identity: {
      userId: viewer.id,
      name: viewer.name,
      tier: viewer.tier,
      houseNumber: viewer.houseNumber,
    },
    balance: {
      hours: credit.hours,
      nearestExpiry: credit.nearestExpiry,
      isHouseholdPool: credit.isHouseholdPool,
    },
    housemates,
    purchaseHistory,
  };
}

/** The users sharing the viewer's household pool (H1). Empty unless the viewer is a
 *  member WITH a household. The viewer is included and marked `isViewer`. */
async function loadHousemates(viewer: SessionUser): Promise<Housemate[]> {
  if (!sharesHousehold(viewer)) return [];
  const db = getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, tier: users.tier })
    .from(users)
    .innerJoin(households, eq(users.householdId, households.id))
    .where(eq(users.householdId, viewer.householdId!))
    .orderBy(users.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tier: r.tier,
    isViewer: r.id === viewer.id,
  }));
}

/** The pool's package purchases, newest-first (capped). `pricePaid` comes from the
 *  charge that credited the package, or null when no charge backs it. */
async function loadPurchaseHistory(viewer: SessionUser): Promise<PurchaseHistoryItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: packages.id,
      itemId: packages.type,
      hoursTotal: packages.hoursTotal,
      createdAt: packages.createdAt,
      pricePaid: charges.amount,
      chargedAt: charges.createdAt,
    })
    .from(packages)
    // LEFT join: seeded/comped packages have no purchaseChargeId → pricePaid null.
    .leftJoin(charges, eq(packages.purchaseChargeId, charges.chargeId))
    .where(poolPackagesWhere(viewer))
    .orderBy(desc(packages.createdAt))
    .limit(PURCHASE_HISTORY_LIMIT);

  return rows.map((r) => {
    const item = getCatalogItem(r.itemId);
    return {
      id: r.id,
      itemId: r.itemId,
      label: item?.label ?? { en: r.itemId, th: r.itemId },
      hours: item?.hours ?? r.hoursTotal,
      pricePaid: r.pricePaid ?? null,
      purchasedAt: r.chargedAt ?? r.createdAt,
    };
  });
}
