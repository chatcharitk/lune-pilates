// Read model for the admin "Members / Customers & households" screen (spec §4:
// "Customers (not just members): House numbers, sharing groups, balances; add a
// new customer on the spot."; prototype admin-more.jsx `MembersScreen`). Returns a
// searchable customer table and a per-customer detail with the household sharing
// surface.
//
// Like the other admin read models (today.ts, schedule.ts, bookings.ts) this is the
// studio's OWN view — it lists EVERY customer (members AND guests), so it applies no
// tiered visibility. All money/identity shaping is server-side (CLAUDE.md §8): no
// client-supplied balance, tier, or household is ever trusted.
//
// THE BALANCE IS THE SHARED POOL (invariants 2 & 3). A customer's displayed balance
// is derived from their packages so the ledger stays the source of truth:
//   - MEMBER with a household → the SHARED HOUSEHOLD POOL: the sum of `hours_left`
//     across every non-expired package owned by that household_id. Every member of
//     the same house number therefore reads the SAME number (invariant 2).
//   - GUEST (or member without a household) → only their OWN non-expired packages
//     (owner = user_id). A guest never reads a household pool, and a member's pool
//     never leaks to a guest in the same house number (invariant 3).
// This deliberately DIVERGES from `getUsableBalance`/`selectUsablePackageRow`, which
// pick a SINGLE soonest-expiring package of ONE category for a debit. The Members
// screen shows the customer's whole sharable balance across all categories, so it
// sums the pool (the same shape `getPoolBalance` uses, but across every category).
//
// No-DB dev fallback: when DATABASE_URL is unset the functions return mock data
// mirroring admin-data.jsx (MEMBERS), so the screen renders without a database. The
// DB path is the real one.

import { and, asc, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { creditLedger, households, packages, users } from "@/lib/db/schema";
import type { PackageCategory, UserTier } from "@/lib/domain/types";
import { loadPoolOwner } from "@/lib/credits/selectPackage";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── tunables ─────────────────────────

/**
 * A usable balance whose soonest package expires within this many days is flagged
 * `status: "expiring"` (the rose "Expiring soon" treatment in the prototype). The
 * single tunable for the expiry warning; change it here without a schema change.
 */
export const EXPIRING_SOON_DAYS = 7;

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/** How a member's credits are shared across their house number. Guests get `null`. */
export interface SharingSummary {
  /** People in the same house number (≥1 — includes the customer themselves). */
  householdSize: number;
  /** True when the pool is genuinely shared (more than one person in the house). */
  shared: boolean;
}

/** One row in the admin customers table. */
export interface AdminCustomer {
  id: string;
  name: string;
  phone: string;
  tier: UserTier;
  /** House number, or null for guests / members without a household. */
  house: string | null;
  /**
   * Usable credit balance, in hours. For a member with a household this is the
   * SHARED household pool (same for every house member — invariant 2); for a guest
   * it is their personal packages only (invariant 3).
   */
  balance: number;
  /** Soonest expiry among the customer's usable packages (ISO), or null when none. */
  expiry: string | null;
  /** "expiring" when the soonest usable package is within EXPIRING_SOON_DAYS; else "active". */
  status: CustomerCreditStatus;
  /** Sharing summary for a member; null for a guest (credits non-transferable). */
  sharing: SharingSummary | null;
}

export type CustomerCreditStatus = "active" | "expiring";

/** One housemate in the customer-detail sharing group. */
export interface Housemate {
  id: string;
  name: string;
  tier: UserTier;
}

/** The full customer detail behind a table row (the drawer). */
export interface AdminCustomerDetail extends AdminCustomer {
  /**
   * The household sharing group: everyone in the same house number (members AND
   * guests living there), self included. Empty for a guest / member without a
   * household. Deterministically ordered (by name, then id).
   */
  housemates: Housemate[];
  /**
   * Which sharing note the drawer shows:
   *   - "member" → sage note "credits shared without limit across this house number"
   *   - "guest"  → cream note "non-transferable, cannot be shared"
   */
  sharingNote: "member" | "guest";
}

/** The reason a credit-ledger row was written (mirrors creditLedger.reason).
 *  "promo" = the free first-purchase 1+1 trial hour (lib/credits/creditPackage.ts). */
export type LedgerReason = "booking" | "cancel_refund" | "purchase" | "promo" | "adjustment";

/**
 * One row of a customer's credit-ledger history for the admin customer drawer. The
 * ledger is the source of truth (invariant 1/2); this is a READ MODEL over the rows
 * of every package in the customer's POOL (member→household, guest→own — invariant
 * 3), newest-first for display, each carrying a RUNNING balance.
 */
export interface CustomerLedgerEntry {
  id: string;
  /** When the row was written (ISO). */
  createdAt: string;
  /** Signed integer credit delta (−cost on book, +cost on refund, +N on purchase). */
  delta: number;
  reason: LedgerReason;
  /** Free-text audit note (the owner's adjustment reason; class-cancel refunds), or null. */
  note: string | null;
  /**
   * The pool balance AFTER this row, i.e. the running sum of all deltas up to AND
   * including this row (computed ascending by createdAt, then surfaced newest-first).
   * The newest row's balanceAfter reconciles to the pool's current hours_left.
   */
  balanceAfter: number;
}

/** Optional filter for the customers list. */
export interface ListCustomersFilter {
  /** Case-insensitive search across name / house number / phone. */
  query?: string;
}

// ───────────────────────── pure helpers ─────────────────────────

/** Fields needed to compute the usable-balance summary, independent of source. */
export interface UsablePackageSummary {
  hoursLeft: number;
  expiresAt: Date;
}

export interface CreditSummary {
  /** Sum of `hours_left` across the supplied usable packages. */
  balance: number;
  /** Soonest `expires_at` among them (ISO), or null when there are none. */
  expiry: string | null;
  status: CustomerCreditStatus;
}

/**
 * Roll a customer's usable packages (already filtered to their pool, non-expired,
 * hours_left > 0) into the table summary: the summed balance, the soonest expiry,
 * and the expiring-soon flag. Pure (no I/O) so it is unit-testable and shared by
 * the DB and mock paths. Summing whole integer credits never drifts (CLAUDE.md §8).
 */
export function summariseCredits(
  pkgs: readonly UsablePackageSummary[],
  now: Date = new Date(),
): CreditSummary {
  if (pkgs.length === 0) {
    return { balance: 0, expiry: null, status: "active" };
  }
  let balance = 0;
  let soonest = pkgs[0]!.expiresAt;
  for (const p of pkgs) {
    balance += p.hoursLeft;
    if (p.expiresAt.getTime() < soonest.getTime()) soonest = p.expiresAt;
  }
  const msUntil = soonest.getTime() - now.getTime();
  const expiringSoon = msUntil <= EXPIRING_SOON_DAYS * 24 * 3_600_000;
  return {
    balance,
    expiry: soonest.toISOString(),
    status: expiringSoon ? "expiring" : "active",
  };
}

/** Does `q` match any of name / house / phone (case-insensitive, trimmed)? */
export function matchesQuery(
  c: { name: string; house: string | null; phone: string },
  q: string | undefined,
): boolean {
  const needle = q?.trim().toLowerCase();
  if (!needle) return true;
  return (
    c.name.toLowerCase().includes(needle) ||
    (c.house?.toLowerCase().includes(needle) ?? false) ||
    c.phone.toLowerCase().includes(needle)
  );
}

/**
 * The package-ownership filter for a customer's pool, server-side. A member with a
 * household reads household-owned packages (the shared pool); a guest or member
 * without a household reads only their own. Mirrors `ownerWhere` in
 * lib/credits/selectPackage.ts so balance reads can never diverge from selection,
 * but takes a plain (tier, householdId, id) tuple rather than a SessionUser.
 */
function poolOwnerWhere(c: { id: string; tier: UserTier; householdId: string | null }): SQL {
  const sharesHousehold = c.tier === "member" && c.householdId !== null;
  return sharesHousehold
    ? (and(eq(packages.ownerHouseholdId, c.householdId!), isNull(packages.ownerUserId)) as SQL)
    : (and(eq(packages.ownerUserId, c.id), isNull(packages.ownerHouseholdId)) as SQL);
}

/** Deterministic customer ordering: by name, then phone, then id. */
function byNameThenId<T extends { name: string; phone: string; id: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name) || a.phone.localeCompare(b.phone) || a.id.localeCompare(b.id);
}

// ───────────────────────── public queries ─────────────────────────

/**
 * Every customer (members AND guests) for the admin customers table, optionally
 * filtered by a name/house/phone search. Each row carries the SHARED pool balance
 * (invariants 2 & 3), the soonest expiry, the expiring-soon status, and — for
 * members — the sharing summary. Deterministically ordered by name.
 *
 * No-DB fallback: returns mock data mirroring admin-data.jsx so the screen renders
 * without a database. The DB path is authoritative.
 */
export async function listCustomers(filter: ListCustomersFilter = {}, now: Date = new Date()): Promise<AdminCustomer[]> {
  if (mockDataMode()) {
    return mockListCustomers(filter, now);
  }

  const db = getDb();

  // 1) Every customer + their household number (left join: guests have none), and
  // 2) every usable package (hours_left > 0, not expired) with its owner key, in
  //    ONE pass — so we never fan out a per-customer balance query. The two are
  //    independent, so they run in ONE parallel round trip.
  const [userRows, pkgRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        tier: users.tier,
        householdId: users.householdId,
        house: households.houseNumber,
      })
      .from(users)
      .leftJoin(households, eq(users.householdId, households.id)),
    db
      .select({
        ownerHouseholdId: packages.ownerHouseholdId,
        ownerUserId: packages.ownerUserId,
        hoursLeft: packages.hoursLeft,
        expiresAt: packages.expiresAt,
      })
      .from(packages)
      .where(and(gt(packages.hoursLeft, 0), gt(packages.expiresAt, now))),
  ]);

  // Bucket usable packages by their pool key (household:<id> | user:<id>).
  const byHousehold = new Map<string, UsablePackageSummary[]>();
  const byUser = new Map<string, UsablePackageSummary[]>();
  for (const p of pkgRows) {
    const summary = { hoursLeft: p.hoursLeft, expiresAt: p.expiresAt };
    if (p.ownerHouseholdId) {
      (byHousehold.get(p.ownerHouseholdId) ?? setGet(byHousehold, p.ownerHouseholdId)).push(summary);
    } else if (p.ownerUserId) {
      (byUser.get(p.ownerUserId) ?? setGet(byUser, p.ownerUserId)).push(summary);
    }
  }

  // Household sizes for the sharing summary — count customers per household_id.
  const householdSize = new Map<string, number>();
  for (const u of userRows) {
    if (u.householdId) householdSize.set(u.householdId, (householdSize.get(u.householdId) ?? 0) + 1);
  }

  const customers = userRows.map((u) => {
    const sharesHousehold = u.tier === "member" && u.householdId !== null;
    const pkgs = sharesHousehold ? byHousehold.get(u.householdId!) ?? [] : byUser.get(u.id) ?? [];
    const credit = summariseCredits(pkgs, now);
    const size = u.householdId ? householdSize.get(u.householdId) ?? 1 : 0;
    return shapeCustomer(
      { id: u.id, name: u.name, phone: u.phone, tier: u.tier, house: u.house ?? null },
      credit,
      size,
    );
  });

  return customers.filter((c) => matchesQuery(c, filter.query)).sort(byNameThenId);
}

/**
 * The full detail for one customer (the drawer): the table fields PLUS the
 * household sharing surface — the housemates in the same house number (members and
 * guests, self included) and which sharing note to render. Returns null when the
 * user id is unknown.
 *
 * The balance shown here is the SAME shared-pool figure as the row (invariant 2):
 * a guest's detail never reads a household pool (invariant 3).
 *
 * No-DB fallback: returns mock detail mirroring admin-data.jsx, or null.
 */
export async function getCustomerDetail(
  userId: string,
  now: Date = new Date(),
): Promise<AdminCustomerDetail | null> {
  if (mockDataMode()) {
    return mockCustomerDetail(userId, now);
  }

  const db = getDb();

  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      tier: users.tier,
      householdId: users.householdId,
      house: households.houseNumber,
    })
    .from(users)
    .leftJoin(households, eq(users.householdId, households.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!u) return null;

  // Usable packages for THIS customer's pool (recomputed server-side, never
  // trusting any client value — CLAUDE.md §8; poolOwnerWhere encodes invariants
  // 2/3) and the housemates in the same house number (members + guests, self
  // included; a guest / member without a household has no sharing group). Both
  // depend only on `u`, so they run in ONE parallel round trip.
  const [pkgs, housemateRows] = await Promise.all([
    db
      .select({ hoursLeft: packages.hoursLeft, expiresAt: packages.expiresAt })
      .from(packages)
      .where(
        and(
          poolOwnerWhere({ id: u.id, tier: u.tier, householdId: u.householdId }),
          gt(packages.hoursLeft, 0),
          gt(packages.expiresAt, now),
        ),
      ),
    u.householdId
      ? db
          .select({ id: users.id, name: users.name, tier: users.tier })
          .from(users)
          .where(eq(users.householdId, u.householdId))
          .orderBy(asc(users.name), asc(users.id))
      : Promise.resolve([]),
  ]);
  const credit = summariseCredits(pkgs, now);
  const housemates: Housemate[] = housemateRows.map((r) => ({
    id: r.id,
    name: r.name,
    tier: r.tier,
  }));

  const base = shapeCustomer(
    { id: u.id, name: u.name, phone: u.phone, tier: u.tier, house: u.house ?? null },
    credit,
    housemates.length,
  );

  return {
    ...base,
    housemates,
    sharingNote: u.tier === "member" ? "member" : "guest",
  };
}

/**
 * The credit-ledger history for one customer's POOL, newest-first, each row carrying
 * a RUNNING balance. Resolves the customer's pool via loadPoolOwner (member→household
 * pool, guest→own packages — invariant 3), finds every package owned by that pool,
 * and reads all creditLedger rows for those packages.
 *
 * The running `balanceAfter` is computed ASCENDING by createdAt (start 0, accumulate
 * each delta), so the newest row's balanceAfter equals the sum of every delta — which
 * reconciles to the pool's current `hours_left` (the ledger is the source of truth,
 * invariant 1/2). The list is then returned newest-first for display.
 *
 * Returns [] (never throws) for an unknown customer or a customer with no pool/
 * packages — the drawer renders an empty history.
 *
 * OWNER-CONTEXT: this is a READ MODEL with no gate of its own; it MUST only be
 * reached from the owner-gated Members page (the same convention as the rest of
 * lib/admin/*). No client value is trusted — the pool is recomputed server-side.
 *
 * No-DB dev fallback: returns a few believable rows with correct running balances.
 */
export async function getCustomerLedger(
  customerId: string,
  now: Date = new Date(),
): Promise<CustomerLedgerEntry[]> {
  if (mockDataMode()) {
    return mockCustomerLedger();
  }

  const owner = await loadPoolOwner(customerId);
  if (!owner) return []; // unknown customer → empty history

  const db = getDb();

  // Packages in this customer's pool (invariant 3 via poolOwnerWhere).
  const pkgRows = await db
    .select({ id: packages.id })
    .from(packages)
    .where(poolOwnerWhere(owner));
  if (pkgRows.length === 0) return [];
  const pkgIds = pkgRows.map((p) => p.id);

  // Every ledger row for those packages, OLDEST-first so we can accumulate the
  // running balance in one pass (the ledger is append-only).
  const rows = await db
    .select({
      id: creditLedger.id,
      createdAt: creditLedger.createdAt,
      delta: creditLedger.delta,
      reason: creditLedger.reason,
      note: creditLedger.note,
    })
    .from(creditLedger)
    .where(inArray(creditLedger.packageId, pkgIds))
    .orderBy(asc(creditLedger.createdAt), asc(creditLedger.id));

  return toLedgerEntries(rows);
}

/**
 * Turn append-only ledger rows (OLDEST-first) into newest-first entries with a
 * running balanceAfter. Pure so both the DB and mock paths share it. `now` is unused
 * here but kept off the signature — balances are pure delta sums.
 */
function toLedgerEntries(
  rows: readonly { id: string; createdAt: Date; delta: number; reason: string; note?: string | null }[],
): CustomerLedgerEntry[] {
  let running = 0;
  // Accumulate ascending, stamping each row's post-balance.
  const ascending = rows.map((r) => {
    running += r.delta;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      delta: r.delta,
      reason: r.reason as LedgerReason,
      note: r.note ?? null,
      balanceAfter: running,
    };
  });
  // Return newest-first for display (reverse the ascending list).
  return ascending.reverse();
}

// ───────────────────────── shaping ─────────────────────────

/** Build the `AdminCustomer` row from the resolved identity + credit summary. */
function shapeCustomer(
  who: { id: string; name: string; phone: string; tier: UserTier; house: string | null },
  credit: CreditSummary,
  householdSize: number,
): AdminCustomer {
  // Sharing summary only for members; guests are non-transferable (invariant 3).
  const sharing: SharingSummary | null =
    who.tier === "member"
      ? { householdSize: Math.max(householdSize, 1), shared: householdSize > 1 }
      : null;
  return {
    id: who.id,
    name: who.name,
    phone: who.phone,
    tier: who.tier,
    house: who.house,
    balance: credit.balance,
    expiry: credit.expiry,
    status: credit.status,
    sharing,
  };
}

/** Map helper: create-and-store an empty bucket, returning it. */
function setGet<T>(m: Map<string, T[]>, key: string): T[] {
  const arr: T[] = [];
  m.set(key, arr);
  return arr;
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Mirrors admin-data.jsx MEMBERS, so the screen renders a believable customer list
// without a database. The mock encodes the SAME pool semantics as the DB path:
// members in a shared house read one summed household pool; guests read their own.
// The DB path is authoritative.

interface MockCustomer {
  id: string;
  name: string;
  phone: string;
  house: string;
  member: boolean;
  /**
   * This customer's OWN package hours. For a member the household pool is the SUM
   * of every house member's own hours (so housemates read the same total — that is
   * the point of invariant 2). For a guest it is just their own.
   */
  ownHours: number;
  /** Days from `now` until this customer's own package expires. */
  expiresInDays: number;
}

/**
 * Stable UUID-shaped mock id so a mock customer passes the SAME `z.string().uuid()`
 * validation a real `users.id` does — notably the POS `customerId` gate
 * (app/actions/admin-pos.ts), which rejects non-uuid ids so a true walk-in can't be
 * sold a package. Mirrors the admin-today mock-id convention. `mid(1)` →
 * "00000000-0000-4000-8000-000000000001".
 */
export function mid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// Mirrors admin-data.jsx MEMBERS. Per-customer own-hours are chosen so the A-114
// member pool (mid(1) + mid(7)) sums to a believable shared total; expiry offsets
// exercise both "active" and "expiring" statuses against EXPIRING_SOON_DAYS.
const MOCK_CUSTOMERS: MockCustomer[] = [
  { id: mid(1), name: "Pim Srisai", phone: "081 234 5678", house: "A-114", member: true, ownHours: 5, expiresInDays: 2 },
  { id: mid(2), name: "Nok Charoen", phone: "089 887 1200", house: "B-203", member: true, ownHours: 2, expiresInDays: 5 },
  { id: mid(3), name: "June Wattana", phone: "062 553 9981", house: "A-114", member: false, ownHours: 5, expiresInDays: 8 },
  { id: mid(4), name: "Best Pongsak", phone: "084 119 2235", house: "C-007", member: true, ownHours: 6, expiresInDays: 23 },
  { id: mid(5), name: "Fah Intira", phone: "090 442 0087", house: "C-007", member: true, ownHours: 6, expiresInDays: 23 },
  { id: mid(6), name: "Mind Arunee", phone: "081 778 5512", house: "D-051", member: false, ownHours: 1, expiresInDays: 1 },
  { id: mid(7), name: "Gus Theerapat", phone: "083 901 7766", house: "A-114", member: true, ownHours: 3, expiresInDays: 2 },
  { id: mid(8), name: "Ann Kanya", phone: "086 220 4419", house: "E-088", member: true, ownHours: 9, expiresInDays: 41 },
];

/** Everyone living at `house`. Callers filter to `.member` for the actual
 *  household (the credit-sharing unit) — guests are standalone (invariant 3). */
function mockHousehold(house: string): MockCustomer[] {
  return MOCK_CUSTOMERS.filter((c) => c.house === house);
}

/**
 * The usable packages backing one mock customer's POOL. A MEMBER sees the union of
 * every MEMBER's own hours in the house (the shared household pool — invariant 2,
 * guests in the house are excluded); a GUEST sees only their own (invariant 3).
 * Each customer's own hours become one package, so the summed balance and soonest
 * expiry match the DB path's shape exactly.
 */
function mockPoolPackages(c: MockCustomer, now: Date): UsablePackageSummary[] {
  const day = 24 * 3_600_000;
  const sources = c.member ? mockHousehold(c.house).filter((x) => x.member) : [c];
  return sources
    .filter((s) => s.ownHours > 0)
    .map((s) => ({ hoursLeft: s.ownHours, expiresAt: new Date(now.getTime() + s.expiresInDays * day) }));
}

function mockShapeCustomer(c: MockCustomer, now: Date): AdminCustomer {
  const credit = summariseCredits(mockPoolPackages(c, now), now);
  // Only MEMBERS belong to a household: the spec's User model derives `house` from
  // household_id, which a guest never has (invariant 3). So a guest carries no house
  // and no household size — matching the DB path's left-join result exactly.
  const house = c.member ? c.house : null;
  const householdSize = c.member ? mockHousehold(c.house).filter((x) => x.member).length : 0;
  return shapeCustomer(
    { id: c.id, name: c.name, phone: c.phone, tier: c.member ? "member" : "guest", house },
    credit,
    householdSize,
  );
}

function mockListCustomers(filter: ListCustomersFilter, now: Date): AdminCustomer[] {
  return MOCK_CUSTOMERS.map((c) => mockShapeCustomer(c, now))
    .filter((c) => matchesQuery(c, filter.query))
    .sort(byNameThenId);
}

/**
 * A believable mock ledger history (newest-first) with correct running balances. The
 * append-only rows OLDEST→newest are: purchase +10, booking −1, cancel_refund +1,
 * adjustment +2 → running 10, 9, 10, 12. Reusing toLedgerEntries guarantees the
 * mock's running math is computed the SAME way as the DB path, and the newest row's
 * balanceAfter (12) equals the sum of every delta.
 */
function mockCustomerLedger(): CustomerLedgerEntry[] {
  const base = new Date("2026-06-01T03:00:00.000Z").getTime();
  const hour = 3_600_000;
  const rows = [
    { id: "ml-1", createdAt: new Date(base + 0 * hour), delta: 10, reason: "purchase" },
    { id: "ml-2", createdAt: new Date(base + 24 * hour), delta: -1, reason: "booking" },
    { id: "ml-3", createdAt: new Date(base + 48 * hour), delta: 1, reason: "cancel_refund" },
    { id: "ml-4", createdAt: new Date(base + 72 * hour), delta: 2, reason: "adjustment" },
  ];
  return toLedgerEntries(rows);
}

function mockCustomerDetail(userId: string, now: Date): AdminCustomerDetail | null {
  const c = MOCK_CUSTOMERS.find((x) => x.id === userId);
  if (!c) return null;
  const base = mockShapeCustomer(c, now);
  // Housemates = the household's MEMBERS only (guests are standalone — invariant 3),
  // matching the DB path (users sharing household_id). A guest has none.
  const housemates: Housemate[] = c.member
    ? mockHousehold(c.house)
        .filter((x) => x.member)
        .map((hm) => ({ id: hm.id, name: hm.name, tier: "member" as const }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    : [];
  return {
    ...base,
    housemates,
    sharingNote: c.member ? "member" : "guest",
  };
}
