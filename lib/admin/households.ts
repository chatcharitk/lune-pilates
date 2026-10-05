// Read model for the admin "Households" screen (2026-10-05). The Members screen is
// person-first; this one is HOUSE-first, because "who shares which classes" was
// hard to see from a list of people — paid classes sat unnoticed in a house nobody
// lived in after a house number was corrected. For every house number it answers:
// who is in it, and how many classes the house has left (by class type).
//
// Same rules as lib/admin/members.ts (CLAUDE.md §5 invariants 2 & 3): a house's
// pool is the packages it owns (owner_household_id); guests never read it. The
// balance is the sum of the cached hours_left, which always reconciles to the
// ledger. Studio-own view — no tiered visibility. OWNER-CONTEXT: reached only from
// the owner-gated /admin/households page.

import { and, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { households, packages, users } from "@/lib/db/schema";
import type { PackageCategory, UserTier } from "@/lib/domain/types";
import type { Bilingual } from "@/lib/i18n";
import { loadCatalogMap } from "@/lib/catalog/packages";
import { EXPIRING_SOON_DAYS } from "@/lib/admin/members";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── contract (frontend imports these) ─────────────────────────

export interface HouseholdMember {
  id: string;
  name: string;
  phone: string;
  tier: UserTier;
}

/** One package the house owns, for the detail drawer. */
export interface HouseholdPackage {
  id: string;
  label: Bilingual;
  category: PackageCategory;
  /** Rental packs are for an exact head-count; null for every other type. */
  partySize: number | null;
  hoursLeft: number;
  hoursTotal: number;
  /** ISO; null = a bundle part whose clock has not started (not usable yet). */
  expiresAt: string | null;
}

export interface AdminHousehold {
  id: string;
  houseNumber: string;
  members: HouseholdMember[];
  /** Usable classes left across the house (non-expired, started, hours_left > 0). */
  balance: number;
  /** Usable classes per class type; only types with classes left appear. */
  byCategory: { category: PackageCategory; hours: number }[];
  /** Soonest expiry among the usable packages (ISO), or null. */
  expiry: string | null;
  /** The soonest usable package expires within EXPIRING_SOON_DAYS. */
  expiringSoon: boolean;
  /** Packages with classes left: usable ones, plus bundle parts not yet started. */
  packages: HouseholdPackage[];
}

const CATEGORY_ORDER: PackageCategory[] = ["group", "private", "duo", "trio", "rental"];

// ───────────────────────── query ─────────────────────────

/**
 * Every house number with its members and remaining classes, ordered so the ones
 * that need attention come first: houses holding classes with NO members (nobody
 * can use them), then by house number. Houses with neither members nor classes are
 * left out — they are leftovers of edits and carry nothing to act on.
 */
export async function listHouseholds(now: Date = new Date()): Promise<AdminHousehold[]> {
  if (mockDataMode()) return mockHouseholds(now);

  const db = getDb();
  const [houseRows, memberRows, pkgRows, catalog] = await Promise.all([
    db.select({ id: households.id, houseNumber: households.houseNumber }).from(households),
    db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        tier: users.tier,
        householdId: users.householdId,
      })
      .from(users)
      .where(and(eq(users.active, true), isNotNull(users.householdId))),
    db
      .select({
        id: packages.id,
        type: packages.type,
        category: packages.category,
        partySize: packages.partySize,
        hoursLeft: packages.hoursLeft,
        hoursTotal: packages.hoursTotal,
        expiresAt: packages.expiresAt,
        ownerHouseholdId: packages.ownerHouseholdId,
      })
      .from(packages)
      .where(
        and(
          isNotNull(packages.ownerHouseholdId),
          gt(packages.hoursLeft, 0),
          // Usable (clock running, not expired) or a dormant bundle part.
          or(gt(packages.expiresAt, now), isNull(packages.expiresAt)),
        ),
      ),
    loadCatalogMap(),
  ]);

  const membersBy = new Map<string, HouseholdMember[]>();
  for (const m of memberRows) {
    const list = membersBy.get(m.householdId!) ?? [];
    list.push({ id: m.id, name: m.name, phone: m.phone, tier: m.tier });
    membersBy.set(m.householdId!, list);
  }

  const pkgsBy = new Map<string, HouseholdPackage[]>();
  for (const p of pkgRows) {
    const list = pkgsBy.get(p.ownerHouseholdId!) ?? [];
    list.push({
      id: p.id,
      label: catalog.get(p.type)?.label ?? { en: p.type, th: p.type },
      category: p.category,
      partySize: p.partySize ?? null,
      hoursLeft: p.hoursLeft,
      hoursTotal: p.hoursTotal,
      expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    });
    pkgsBy.set(p.ownerHouseholdId!, list);
  }

  return houseRows
    .map((h) => shapeHousehold(h, membersBy.get(h.id) ?? [], pkgsBy.get(h.id) ?? [], now))
    .filter((h) => h.members.length > 0 || h.packages.length > 0)
    .sort(byAttentionThenNumber);
}

// ───────────────────────── pure helpers ─────────────────────────

/** Roll one house's members + packages into the screen's row. Pure (unit-testable). */
export function shapeHousehold(
  h: { id: string; houseNumber: string },
  members: HouseholdMember[],
  pkgs: HouseholdPackage[],
  now: Date,
): AdminHousehold {
  const usable = pkgs.filter((p) => p.expiresAt !== null && new Date(p.expiresAt) > now);
  const perCat = new Map<PackageCategory, number>();
  let balance = 0;
  let expiry: string | null = null;
  for (const p of usable) {
    balance += p.hoursLeft;
    perCat.set(p.category, (perCat.get(p.category) ?? 0) + p.hoursLeft);
    if (expiry === null || p.expiresAt! < expiry) expiry = p.expiresAt;
  }
  const expiringSoon =
    expiry !== null && new Date(expiry).getTime() - now.getTime() <= EXPIRING_SOON_DAYS * 86_400_000;

  return {
    id: h.id,
    houseNumber: h.houseNumber,
    members: [...members].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    balance,
    byCategory: CATEGORY_ORDER.filter((c) => perCat.has(c)).map((c) => ({ category: c, hours: perCat.get(c)! })),
    expiry,
    expiringSoon,
    // Soonest expiry first; not-yet-started bundle parts last.
    packages: [...pkgs].sort((a, b) => {
      if (a.expiresAt === b.expiresAt) return a.id.localeCompare(b.id);
      if (a.expiresAt === null) return 1;
      if (b.expiresAt === null) return -1;
      return a.expiresAt.localeCompare(b.expiresAt);
    }),
  };
}

/** Houses holding classes with nobody in them first; then natural house-number order. */
function byAttentionThenNumber(a: AdminHousehold, b: AdminHousehold): number {
  const strandedA = a.members.length === 0 && a.balance > 0 ? 0 : 1;
  const strandedB = b.members.length === 0 && b.balance > 0 ? 0 : 1;
  return (
    strandedA - strandedB ||
    a.houseNumber.localeCompare(b.houseNumber, undefined, { numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}

// ───────────────────────── no-DB fallback ─────────────────────────

function mockHouseholds(now: Date): AdminHousehold[] {
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
  return [
    shapeHousehold(
      { id: "mock-h1", houseNumber: "A-114" },
      [
        { id: "mock-u1", name: "Mai", phone: "0810000001", tier: "member" },
        { id: "mock-u2", name: "Ploy", phone: "0810000002", tier: "member" },
      ],
      [
        { id: "mock-p1", label: { en: "10 classes", th: "10 คลาส" }, category: "group", partySize: null, hoursLeft: 6, hoursTotal: 10, expiresAt: inDays(40) },
        { id: "mock-p2", label: { en: "1:1 · 5 classes", th: "1:1 · 5 คลาส" }, category: "private", partySize: null, hoursLeft: 2, hoursTotal: 5, expiresAt: inDays(5) },
      ],
      now,
    ),
    shapeHousehold(
      { id: "mock-h2", houseNumber: "B-27" },
      [{ id: "mock-u3", name: "Fah", phone: "0810000003", tier: "member" }],
      [],
      now,
    ),
  ].sort(byAttentionThenNumber);
}
