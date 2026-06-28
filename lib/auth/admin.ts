// Admin auth boundary. v1 ships a MOCK (the front desk is treated as signed in,
// matching the prototype's "Kru Mai · Studio admin"); the real staff/LINE admin
// provider implements the same interface later with ZERO change to the action
// logic (CLAUDE.md §2 — integrations are mocked behind clean interfaces).
//
// Every admin server action calls `requireAdmin()` at the top as its authorization
// gate, and returns its `UNAUTHORIZED` failure when null. The default v1 mock
// always resolves a session (so behaviour is unchanged), but the gate + the
// UNAUTHORIZED path now exist at every call site — so swapping in a real check
// that can REJECT is a one-file change HERE, with no edits to any action.
//
// Set `ADMIN_AUTH=deny` to force the rejection path: this lets tests and a
// locked-down staging environment exercise the UNAUTHORIZED behaviour before a
// real provider is wired in.

/**
 * Two admin roles (decided 2026-06-28):
 *   - `owner` — full admin (everything the v1 mock could do).
 *   - `instructor` — least-privilege staff: ONLY the Today screen scoped to their
 *     OWN classes + roster check-in on those classes. Everything else is owner-only.
 */
export type AdminRole = "owner" | "instructor";

export interface AdminSession {
  /** Stable id of the acting staff member (not a customer identity). */
  id: string;
  name: string;
  /** The privilege role of this session. */
  role: AdminRole;
  /**
   * The linked `instructors.id` slug — non-null ONLY for an instructor session
   * (so Today/check-in can scope to that instructor's classes). null for owners.
   */
  instructorId: string | null;
}

export interface AdminAuth {
  /** The acting admin for this request, or null when not authenticated. */
  currentAdmin(): Promise<AdminSession | null>;
}

/** The fixed v1 front-desk OWNER session. */
const MOCK_OWNER: AdminSession = {
  id: "admin-mock",
  name: "Kru Mai",
  role: "owner",
  instructorId: null,
};

/**
 * Names for the seeded instructor slugs (mirrors lib/schedule/queries.ts
 * INSTRUCTOR_META). Used only to label the v1 instructor mock session.
 */
const INSTRUCTOR_NAMES: Record<string, string> = {
  mai: "Kru Mai",
  ploy: "Kru Ploy",
  nina: "Kru Nina",
};

/**
 * v1 default: the studio front desk is always "signed in". The role is picked
 * from `ADMIN_ROLE`:
 *   - unset / "owner" → the full-admin owner session;
 *   - "instructor"    → an instructor session linked to `ADMIN_INSTRUCTOR_ID`
 *     (default "mai"), so Today + check-in scope to that instructor's classes.
 */
class MockAdminAuth implements AdminAuth {
  async currentAdmin(): Promise<AdminSession | null> {
    if (process.env.ADMIN_ROLE === "instructor") {
      const instructorId = process.env.ADMIN_INSTRUCTOR_ID ?? "mai";
      return {
        id: "instructor-mock",
        name: INSTRUCTOR_NAMES[instructorId] ?? "Kru Mai",
        role: "instructor",
        instructorId,
      };
    }
    return MOCK_OWNER;
  }
}

/** Always unauthenticated — for tests and locked-down staging (ADMIN_AUTH=deny). */
class RejectingAdminAuth implements AdminAuth {
  async currentAdmin(): Promise<AdminSession | null> {
    return null;
  }
}

/**
 * Resolve the admin-auth client by mode. v1 = "mock"; `ADMIN_AUTH=deny` rejects
 * — and the deny check runs FIRST, regardless of `ADMIN_ROLE`, so a locked-down
 * environment hard-rejects every action no matter which role is configured.
 */

const mockAuth = new MockAdminAuth();
const rejectingAuth = new RejectingAdminAuth();

export function getAdminAuth(): AdminAuth {
  // when a real ADMIN_AUTH provider exists, construct/return it here instead.
  // DENY wins over ADMIN_ROLE: checked first so it hard-rejects any role.
  if (process.env.ADMIN_AUTH === "deny") return rejectingAuth;
  return mockAuth;
}

/**
 * Authorization gate for admin server actions. Returns the acting admin session
 * (now role-bearing), or null when the caller is not an authenticated admin —
 * callers MUST return their `UNAUTHORIZED` failure when this is null. Allowed for
 * BOTH roles; owner-only actions use `requireOwner()` instead. (The v1 mock never
 * returns null unless `ADMIN_AUTH=deny`.)
 */
export async function requireAdmin(): Promise<AdminSession | null> {
  return getAdminAuth().currentAdmin();
}

/**
 * Owner-only gate. Returns the session ONLY when it is an authenticated OWNER;
 * an instructor (or an unauthenticated caller) gets null. Least-privilege: an
 * instructor hitting an owner action is treated exactly like unauth, so callers
 * keep returning their existing `UNAUTHORIZED` failure — no new failure code.
 */
export async function requireOwner(): Promise<AdminSession | null> {
  const session = await requireAdmin();
  return session && session.role === "owner" ? session : null;
}

/**
 * Instructor-scope gate. Returns the session + its NON-NULL `instructorId` ONLY
 * when the caller is an authenticated instructor; null for owners and unauth.
 * Lets a scoped action (Today, check-in) narrow to the instructor's own classes.
 */
export async function requireInstructorScope(): Promise<
  { session: AdminSession; instructorId: string } | null
> {
  const session = await requireAdmin();
  if (session && session.role === "instructor" && session.instructorId) {
    return { session, instructorId: session.instructorId };
  }
  return null;
}
