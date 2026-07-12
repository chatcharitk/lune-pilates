// Server-side package selection for a booking debit.
//
// Picks WHICH package the booking should debit. This is money-critical and must
// never trust a client-supplied package id, balance, or price — it recomputes
// eligibility from the database every time (CLAUDE.md §8).
//
// Rules (CLAUDE.md §5):
//   - A member draws from the *household pool*: packages owned by household_id,
//     shared across every house member.
//   - A guest draws only from their *own* packages (owner = user_id), which never
//     join a household.
//   - The package must be the right category for the class type, still have
//     `hours_left > 0`, and not be expired (`expires_at > now`).
//   - When several qualify, debit the one expiring soonest first (use-it-or-lose-it),
//     so credits are never silently wasted.

import { and, asc, eq, gt, gte, isNull, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packages, users } from "@/lib/db/schema";
import type { ClassType, PackageCategory } from "@/lib/domain/types";
import type { SessionUser } from "@/lib/auth/session";
import { getMockSession } from "@/lib/mock/session";
import { mockDataMode } from "@/lib/mock-mode";

/**
 * The package-ownership filter for `viewer`'s pool: a member with a household
 * reads household-owned packages (the shared pool, owner XOR enforced); a guest
 * or member without a household reads only their own. The single place this
 * member-vs-guest ownership rule lives, shared by selection and balance reads.
 */
function ownerWhere(viewer: SessionUser): SQL {
  const sharesHousehold = viewer.tier === "member" && viewer.householdId !== null;
  return sharesHousehold
    ? (and(eq(packages.ownerHouseholdId, viewer.householdId!), isNull(packages.ownerUserId)) as SQL)
    : (and(eq(packages.ownerUserId, viewer.id), isNull(packages.ownerHouseholdId)) as SQL);
}

/**
 * Which package category settles a booking of a given class type.
 * Group classes draw on `group` hour-credits; 1:1 / duo / trio draw on the
 * `private` (format) packs; rentals draw on `rental` packs. This is the single
 * place that mapping lives.
 */
export function packageCategoryForClassType(classType: ClassType): PackageCategory {
  switch (classType) {
    case "group":
      return "group";
    case "rental":
      return "rental";
    case "private":
    case "duo":
    case "trio":
      return "private";
  }
}

/** The package a booking would settle against: its id and current balance. */
export interface UsablePackage {
  id: string;
  hoursLeft: number;
}

/**
 * Resolve the package `viewer` would debit when booking a `classType` at `now`
 * (id + current `hours_left`), or `null` when the viewer has no usable package.
 *
 * Members resolve against the household pool (owner = household_id); guests
 * against their own packages (owner = user_id). Among usable packages the one
 * with the soonest `expires_at` is chosen. This is the single selection query
 * both the debit (`selectUsablePackage`) and the balance read
 * (`getUsableBalance`) share, so they can never diverge.
 */
export async function selectUsablePackageRow(
  viewer: SessionUser,
  classType: ClassType,
  now: Date = new Date(),
  minHours = 0,
): Promise<UsablePackage | null> {
  const category = packageCategoryForClassType(classType);
  const db = getDb();

  const rows = await db
    .select({ id: packages.id, hoursLeft: packages.hoursLeft })
    .from(packages)
    .where(
      and(
        ownerWhere(viewer),
        eq(packages.category, category),
        // Cost-aware: pick a package that can actually cover this booking's cost,
        // so the chosen package's debit can't fail NO_CREDITS while the pool holds
        // credits elsewhere. (Cross-package splitting is a deliberate v1 non-goal.)
        minHours > 0 ? gte(packages.hoursLeft, minHours) : gt(packages.hoursLeft, 0),
        gt(packages.expiresAt, now),
      ),
    )
    .orderBy(asc(packages.expiresAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Resolve the package id to debit for `viewer` booking a `classType` at `now`,
 * or `null` when the viewer has no usable package. Thin wrapper over
 * `selectUsablePackageRow` for callers that only need the id.
 */
export async function selectUsablePackage(
  viewer: SessionUser,
  classType: ClassType,
  now: Date = new Date(),
  minHours = 0,
): Promise<string | null> {
  const row = await selectUsablePackageRow(viewer, classType, now, minHours);
  return row?.id ?? null;
}

/**
 * Pick the package the NEW leg of a reschedule should debit (CLAUDE.md §5 inv 7,
 * a net-zero free move). A reschedule refunds the OLD booking's `refundCost` to its
 * own package first, so when the new debit settles on that SAME package its
 * effective balance is `hoursLeft + refundCost`. To make a same-cost move always
 * affordable — even when the package sits at 0 after the original booking — we
 * PREFER the old package whenever it is eligible for the new class type, not
 * expired, and its post-refund balance covers `newCost`. Otherwise we fall back to
 * the normal cost-aware selection (a different package must cover `newCost` on its
 * own, since the refund lands elsewhere).
 *
 * Returns the package id to debit, or null when nothing can cover the move.
 */
export async function selectPackageForReschedule(
  viewer: SessionUser,
  newClassType: ClassType,
  oldPackageId: string,
  refundCost: number,
  newCost: number,
  now: Date = new Date(),
): Promise<string | null> {
  const db = getDb();
  const category = packageCategoryForClassType(newClassType);

  // Is the OLD package eligible for the new class (right pool, right category, not
  // expired) and does its post-refund balance cover the new cost? If so, prefer it
  // so the net-zero same-cost case never spuriously fails on a depleted package.
  const [oldPkg] = await db
    .select({ id: packages.id, hoursLeft: packages.hoursLeft })
    .from(packages)
    .where(
      and(
        eq(packages.id, oldPackageId),
        ownerWhere(viewer),
        eq(packages.category, category),
        gt(packages.expiresAt, now),
      ),
    )
    .limit(1);
  if (oldPkg && oldPkg.hoursLeft + refundCost >= newCost) {
    return oldPkg.id;
  }

  // Otherwise a DIFFERENT package must cover the new cost entirely on its own.
  return selectUsablePackage(viewer, newClassType, now, newCost);
}

/** A target user's pool-ownership context — the only fields package selection needs. */
type PoolOwner = Pick<SessionUser, "id" | "tier" | "householdId">;

/**
 * Resolve the pool-ownership context for an ARBITRARY user id (tier + household),
 * server-side from the DB — used when the front desk books on a customer's behalf
 * (the customer is NOT the session user, so `getCurrentUser` can't be used). Never
 * trusts a client-supplied tier/household: both are read from the `users` row.
 * Returns null when the user does not exist.
 */
export async function loadPoolOwner(userId: string): Promise<PoolOwner | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: users.id, tier: users.tier, householdId: users.householdId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve the package id an ARBITRARY user (`userId`) would debit when booking a
 * `classType` at `now`, recomputing their pool ownership (member→household pool,
 * guest→own packages) from the DB — never trusting any client-supplied identity,
 * tier, household, balance, or package id (CLAUDE.md §8). Returns `null` when the
 * user is unknown or has no usable package.
 *
 * This is the admin/front-desk counterpart to `selectUsablePackage`, which only
 * resolves the *current session* user. The actual selection (soonest-expiring,
 * cost-aware, right category & pool) is the SAME `selectUsablePackageRow` the
 * customer path uses, so the two can never diverge.
 */
export async function selectUsablePackageForUser(
  userId: string,
  classType: ClassType,
  now: Date = new Date(),
  minHours = 0,
): Promise<string | null> {
  const owner = await loadPoolOwner(userId);
  if (!owner) return null;
  // `selectUsablePackageRow` reads only id/tier/householdId via `ownerWhere`; the
  // remaining SessionUser fields are display-only and irrelevant to selection.
  const viewer: SessionUser = { ...owner, name: "", houseNumber: null };
  const row = await selectUsablePackageRow(viewer, classType, now, minHours);
  return row?.id ?? null;
}

/**
 * The admin/front-desk counterpart to `selectPackageForReschedule`: pick the
 * package the NEW leg of a reschedule should debit for an ARBITRARY user
 * (`userId`), recomputing their pool ownership (member→household pool, guest→own
 * packages) from the DB — never trusting any client-supplied identity, tier,
 * household, balance, or package id (CLAUDE.md §8). Used when the front desk
 * reschedules a booking on a customer's behalf (the customer is not the session
 * user). Returns the package id to debit, or null when the user is unknown or
 * nothing can cover the move.
 *
 * The actual selection (prefer the old package on its post-refund balance, else a
 * package that covers the new cost on its own) is the SAME
 * `selectPackageForReschedule` the customer path uses, so the two can't diverge.
 */
export async function selectPackageForRescheduleForUser(
  userId: string,
  newClassType: ClassType,
  oldPackageId: string,
  refundCost: number,
  newCost: number,
  now: Date = new Date(),
): Promise<string | null> {
  const owner = await loadPoolOwner(userId);
  if (!owner) return null;
  // `selectPackageForReschedule` reads only id/tier/householdId via `ownerWhere`;
  // the remaining SessionUser fields are display-only and irrelevant to selection.
  const viewer: SessionUser = { ...owner, name: "", houseNumber: null };
  return selectPackageForReschedule(viewer, newClassType, oldPackageId, refundCost, newCost, now);
}

/**
 * The viewer's total usable balance (hours) for a class type's pool — the SUM of
 * `hours_left` across every active, non-expired package in the right category and
 * pool (household for members, own for guests). This is the figure the UI should
 * display as "the balance": the household pool is one shared number, not a single
 * package (CLAUDE.md §5 invariant 2). Distinct from `selectUsablePackageRow`,
 * which picks the single package a debit settles against.
 *
 * No-DB dev fallback: the mock pool balance so the UI renders without a database.
 */
export async function getPoolBalance(
  viewer: SessionUser,
  classType: ClassType,
  now: Date = new Date(),
): Promise<number> {
  if (mockDataMode()) return getMockSession().credits;
  const db = getDb();
  const rows = await db
    .select({ hoursLeft: packages.hoursLeft })
    .from(packages)
    .where(
      and(
        ownerWhere(viewer),
        eq(packages.category, packageCategoryForClassType(classType)),
        gt(packages.hoursLeft, 0),
        gt(packages.expiresAt, now),
      ),
    );
  // Sum in JS over whole integer credits — exactly representable, never drifts.
  return rows.reduce((total, r) => total + r.hoursLeft, 0);
}

/** Headline credit summary for the Home screen: the shared group hour-credit pool. */
export interface CreditOverview {
  /** Total usable hours in the group pool (the sharable hour-credits). */
  hours: number;
  /** Soonest expiry among the pool's packages, or null when the pool is empty. */
  nearestExpiry: Date | null;
  /** true when this pool is a shared household pool (member) vs a personal one. */
  isHouseholdPool: boolean;
}

/**
 * The group hour-credit pool summary shown on Home: summed usable hours and the
 * nearest expiry across the viewer's pool. No-DB dev fallback returns the mock.
 */
export async function getCreditOverview(
  viewer: SessionUser,
  now: Date = new Date(),
): Promise<CreditOverview> {
  const isHouseholdPool = viewer.tier === "member" && viewer.householdId !== null;
  if (mockDataMode()) {
    const mock = getMockSession();
    return { hours: mock.credits, nearestExpiry: null, isHouseholdPool: mock.isHouseholdPool };
  }
  const db = getDb();
  const rows = await db
    .select({ hoursLeft: packages.hoursLeft, expiresAt: packages.expiresAt })
    .from(packages)
    .where(
      and(
        ownerWhere(viewer),
        eq(packages.category, "group"),
        gt(packages.hoursLeft, 0),
        gt(packages.expiresAt, now),
      ),
    )
    .orderBy(asc(packages.expiresAt));
  const hours = rows.reduce((total, r) => total + r.hoursLeft, 0);
  return { hours, nearestExpiry: rows[0]?.expiresAt ?? null, isHouseholdPool };
}
