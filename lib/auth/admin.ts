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

export interface AdminSession {
  /** Stable id of the acting staff member (not a customer identity). */
  id: string;
  name: string;
}

export interface AdminAuth {
  /** The acting admin for this request, or null when not authenticated. */
  currentAdmin(): Promise<AdminSession | null>;
}

/** The fixed v1 front-desk session. */
const MOCK_ADMIN: AdminSession = { id: "admin-mock", name: "Kru Mai" };

/** v1 default: the studio front desk is always "signed in". */
class MockAdminAuth implements AdminAuth {
  async currentAdmin(): Promise<AdminSession | null> {
    return MOCK_ADMIN;
  }
}

/** Always unauthenticated — for tests and locked-down staging (ADMIN_AUTH=deny). */
class RejectingAdminAuth implements AdminAuth {
  async currentAdmin(): Promise<AdminSession | null> {
    return null;
  }
}

const mockAuth = new MockAdminAuth();
const rejectingAuth = new RejectingAdminAuth();

/** Resolve the admin-auth client by mode. v1 = "mock"; ADMIN_AUTH=deny rejects. */
export function getAdminAuth(): AdminAuth {
  // when a real ADMIN_AUTH provider exists, construct/return it here instead.
  if (process.env.ADMIN_AUTH === "deny") return rejectingAuth;
  return mockAuth;
}

/**
 * Authorization gate for admin server actions. Returns the acting admin session,
 * or null when the caller is not an authenticated admin — callers MUST return
 * their `UNAUTHORIZED` failure when this is null. (The v1 mock never returns null,
 * so behaviour is unchanged until a real provider is wired in.)
 */
export async function requireAdmin(): Promise<AdminSession | null> {
  return getAdminAuth().currentAdmin();
}
