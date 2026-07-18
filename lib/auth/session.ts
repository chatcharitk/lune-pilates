// Auth/session boundary. v1 mocks LINE LIFF login behind a clean interface so
// the real LINE identity provider can be swapped in later without touching the
// callers (CLAUDE.md §2 — customer auth is LINE LIFF, mocked in v1).
//
// `getCurrentUser()` resolves the *current customer* the rest of the backend
// keys off (booking actions, schedule queries). It returns a typed SessionUser:
//   - When DATABASE_URL is set, it resolves the seeded member from the DB by the
//     mock LINE identity (phone 0810000001 / house A-114). This is the row the
//     ledger and household pool actually reference, so bookings debit real data.
//   - When DATABASE_URL is unset (UI dev against mock data), it returns a typed
//     mock SessionUser so the app renders without a database.
//
// IMPORTANT: callers must never trust a client-supplied identity, tier, or
// household. The session is resolved server-side here and passed down.

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { UserTier } from "@/lib/domain/types";
import { getDb } from "@/lib/db/client";
import { households, users } from "@/lib/db/schema";
import { mockDataMode } from "@/lib/mock-mode";
import {
  CUSTOMER_COOKIE,
  customerSessionSecret,
  verifyCustomerSession,
} from "@/lib/auth/customer-session";

/** The authenticated customer, resolved server-side. */
export interface SessionUser {
  id: string;
  name: string;
  tier: UserTier;
  /** Household the member belongs to (null for guests / unaffiliated users). */
  householdId: string | null;
  /** House number of the household (null for guests) — for the shared-pool marker. */
  houseNumber: string | null;
}

/**
 * The mock LINE identity for v1. In the real integration this comes from the
 * verified LIFF id token; here it points at the seeded member (scripts/seed.ts).
 */
const MOCK_LINE_IDENTITY = {
  phone: "0810000001",
  house: "A-114",
} as const;

/**
 * Stable typed mock returned when there is no database. The id is a fixed UUID
 * so it is deterministic across renders; it is never written to a real ledger
 * (the no-DB path is UI-only).
 */
const MOCK_SESSION_USER: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Pim",
  tier: "member",
  householdId: "00000000-0000-4000-8000-0000000000a1",
  houseNumber: "A-114",
};

/**
 * Resolve the current customer.
 *
 * v1: mock LINE login → the seeded member (phone 0810000001, house A-114).
 * No-DB dev: a typed mock member so the app runs without a database.
 *
 * Throws only on genuinely unexpected states (DB reachable but the seeded
 * member is missing) — never returns an untyped or guessed identity.
 */
export async function getCurrentUser(): Promise<SessionUser> {
  if (mockDataMode()) {
    return MOCK_SESSION_USER;
  }

  // Live LINE mode: the customer is whoever the signed session cookie names (set by
  // the LIFF login, app/actions/line-auth.ts). Pages only render behind the layout's
  // session gate, so a valid cookie is present here; a missing one is an error state.
  if (process.env.LINE_MODE === "live") {
    const uid = await resolveCustomerSessionUid();
    if (!uid) {
      throw new Error("getCurrentUser: no customer session (LINE login required).");
    }
    return loadSessionUserById(uid);
  }

  // Non-live DB path (staging / demo with a DB but LINE not yet live): the seeded
  // member, resolved by the mock LINE identity — unchanged from before.
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      tier: users.tier,
      householdId: users.householdId,
      houseNumber: households.houseNumber,
    })
    .from(users)
    .leftJoin(households, eq(users.householdId, households.id))
    .where(eq(users.phone, MOCK_LINE_IDENTITY.phone))
    .limit(1);

  if (!row) {
    throw new Error(
      `getCurrentUser: seeded member (phone ${MOCK_LINE_IDENTITY.phone}) not found. Run \`npm run db:seed\`.`,
    );
  }

  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    householdId: row.householdId,
    houseNumber: row.houseNumber ?? null,
  };
}

/**
 * The users.id of the current customer from the signed session cookie, or null when
 * there is no valid session. Used by the customer layout to decide between rendering
 * the app and rendering the LIFF login gate. Never throws.
 */
export async function resolveCustomerSessionUid(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  try {
    return verifyCustomerSession(token, customerSessionSecret())?.uid ?? null;
  } catch {
    return null;
  }
}

/** Load a SessionUser by users.id (+ its household house number). */
async function loadSessionUserById(uid: string): Promise<SessionUser> {
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      tier: users.tier,
      householdId: users.householdId,
      houseNumber: households.houseNumber,
    })
    .from(users)
    .leftJoin(households, eq(users.householdId, households.id))
    .where(eq(users.id, uid))
    .limit(1);
  if (!row) {
    throw new Error("getCurrentUser: customer session references a missing user.");
  }
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    householdId: row.householdId,
    houseNumber: row.houseNumber ?? null,
  };
}
