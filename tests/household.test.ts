// No-DB unit tests for the household-invite action contract (Feature 2 —
// "เชิญคนในบ้าน"). Runs WITHOUT DATABASE_URL so it exercises the mock path the UI
// renders against and pins the action result shapes the frontend codes against. The
// real transactional guarantees (single-use, cross-household block, lazy expiry) are
// proven against live Neon in tests/integration/household-invite.integration.test.ts.
//
// Identity is server-resolved via getCurrentUser(); we mock that module to flip the
// viewer between member and guest, since the action never trusts a client-supplied tier.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

// Mutable mock identity the action's getCurrentUser() resolves to.
let MOCK_VIEWER: SessionUser;

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => MOCK_VIEWER,
}));

import { acceptInvite, createInvite } from "@/app/actions/household";

const MEMBER: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Pim",
  tier: "member",
  householdId: "00000000-0000-4000-8000-0000000000a1",
  houseNumber: "A-114",
};

const GUEST: SessionUser = {
  id: "00000000-0000-4000-8000-000000000099",
  name: "Guest",
  tier: "guest",
  householdId: null,
  houseNumber: null,
};

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  // Force the no-DB mock path regardless of the dev environment.
  delete process.env.DATABASE_URL;
  MOCK_VIEWER = { ...MEMBER };
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

describe("createInvite (no-DB contract)", () => {
  it("a guest cannot create an invite → NOT_A_MEMBER", async () => {
    MOCK_VIEWER = { ...GUEST };
    const res = await createInvite();
    expect(res).toEqual({ ok: false, code: "NOT_A_MEMBER" });
  });

  it("a member without a household → NO_HOUSEHOLD", async () => {
    MOCK_VIEWER = { ...MEMBER, householdId: null, houseNumber: null };
    const res = await createInvite();
    expect(res).toEqual({ ok: false, code: "NO_HOUSEHOLD" });
  });

  it("a member with a household → ok with token + join link + line share + expiry", async () => {
    const res = await createInvite();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(typeof res.token).toBe("string");
    expect(res.token.length).toBeGreaterThan(20); // 192-bit base64url ⇒ 32 chars
    expect(res.url).toContain(`/join/${res.token}`);
    expect(res.lineShareUrl).toContain("https://line.me/R/msg/text/?");
    // Expiry is ~7 days out (ISO-8601 string).
    const ms = new Date(res.expiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(ms).toBeLessThan(7.1 * 24 * 3600 * 1000);
  });
});

describe("acceptInvite (no-DB contract)", () => {
  it("rejects malformed input → INVALID_INPUT", async () => {
    // @ts-expect-error — exercising the runtime zod guard with a wrong-typed token.
    const res = await acceptInvite({ token: 123 });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("rejects an empty token → INVALID_INPUT", async () => {
    const res = await acceptInvite({ token: "" });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("no-DB path returns ok with the mock household", async () => {
    const res = await acceptInvite({ token: "any-valid-looking-token" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.householdId).toBe(MEMBER.householdId);
    expect(res.houseNumber).toBe("A-114");
  });
});
