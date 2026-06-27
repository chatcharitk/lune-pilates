// DB-backed integration tests for the household-invite ACCEPT transaction (Feature 2 —
// "เชิญคนในบ้าน", app/actions/household.ts).
//
// Why this exists: the no-DB unit suite (tests/household.test.ts) can only pin the
// action contract and the mock success shape — its DB branch is short-circuited by an
// unset DATABASE_URL. The actual guarantees only hold because of a real interactive
// transaction: lock the invite row FOR UPDATE by token, validate (pending / not
// expired), enforce the membership guards against the server-resolved joiner, then
// promote+link the user and flip the invite to accepted — all-or-nothing, single-use.
// That can only be proven against a real Postgres. This suite drives the public actions
// against live Neon and asserts:
//
//   1. JOIN — a member creates an invite; a guest accepts in one tx → becomes a member
//      linked to the household, reads the SAME pool (invariant 2), and their own package
//      stays user-owned (invariant 3 preserved).
//   2. SINGLE-USE — the invite flips to 'accepted'; a second accept → INVITE_ALREADY_USED.
//   3. CROSS-HOUSEHOLD — a user already in another household → ALREADY_IN_ANOTHER_HOUSEHOLD,
//      and nothing is mutated.
//   4. EXPIRED — an invite past its TTL → INVITE_EXPIRED and is lazily flipped to 'expired'.
//   5. SELF — the inviter accepting their own invite → CANNOT_INVITE_SELF.
//
// getCurrentUser() is mocked to return whichever fixture user is "the current viewer"
// for a given call, since the action always server-resolves identity (never trusts the
// client). The mock identity is swapped per assertion via a mutable holder.
//
// Gated: requires DATABASE_URL (loaded from .env by setup-env.ts). When unset the whole
// block skips (describe.skipIf), so the default no-DB `npm test` stays green. Fixtures
// are owned by a per-run tag and torn down in afterAll, so it is safe to point at the
// shared dev DB (mirrors the other integration suites).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";

// The action server-resolves identity via getCurrentUser(); swap the "current viewer"
// per call through this mutable holder.
let CURRENT_VIEWER: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => CURRENT_VIEWER,
}));

import { getDb, closeDb } from "@/lib/db/client";
import { householdInvites, households, packages, users, creditLedger } from "@/lib/db/schema";
import { createInvite, acceptInvite } from "@/app/actions/household";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("household invite accept (integration · requires DATABASE_URL)", () => {
  const tag = `hi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // Fixtures created in beforeAll.
  let houseAId: string; // inviter's household
  let houseBId: string; // a second household (for the cross-household block)
  let inviterId: string; // member in house A (creates invites)
  let guestId: string; // guest with their OWN package — joins house A
  let memberBId: string; // member already in house B — blocked from joining A
  let guestPackageId: string; // guestId's user-owned package (must stay user-owned)
  // Concurrency-race fixtures (HIGH-1): a household-less user + two more households, so
  // two simultaneous accepts to two DIFFERENT households can be raced.
  let raceUserId: string; // household-less user who accepts two invites at once
  let inviterCId: string; // member in house C (creates the C invite)
  let inviterDId: string; // member in house D (creates the D invite)
  let houseCId: string;
  let houseDId: string;

  /** Build a SessionUser fixture for the getCurrentUser mock. */
  function viewer(
    id: string,
    tier: "member" | "guest",
    householdId: string | null,
    houseNumber: string | null,
  ): SessionUser {
    return { id, name: `${tag}-${id}`, tier, householdId, houseNumber };
  }

  /** Insert a pending invite directly (so we can control expiry/inviter precisely). */
  async function insertInvite(opts: {
    token: string;
    householdId: string;
    inviterUserId: string;
    expiresAt: Date;
    status?: string;
  }): Promise<void> {
    await getDb().insert(householdInvites).values({
      token: opts.token,
      householdId: opts.householdId,
      inviterUserId: opts.inviterUserId,
      expiresAt: opts.expiresAt,
      status: opts.status ?? "pending",
    });
  }

  beforeAll(async () => {
    const db = getDb();

    const [hA] = await db
      .insert(households)
      .values({ houseNumber: `${tag}-A` })
      .returning({ id: households.id });
    const [hB] = await db
      .insert(households)
      .values({ houseNumber: `${tag}-B` })
      .returning({ id: households.id });
    houseAId = hA!.id;
    houseBId = hB!.id;

    const [inviter] = await db
      .insert(users)
      .values({ phone: `${tag}-inviter`, name: `${tag}-inviter`, tier: "member", householdId: houseAId })
      .returning({ id: users.id });
    const [guest] = await db
      .insert(users)
      .values({ phone: `${tag}-guest`, name: `${tag}-guest`, tier: "guest" })
      .returning({ id: users.id });
    const [memberB] = await db
      .insert(users)
      .values({ phone: `${tag}-memberB`, name: `${tag}-memberB`, tier: "member", householdId: houseBId })
      .returning({ id: users.id });
    inviterId = inviter!.id;
    guestId = guest!.id;
    memberBId = memberB!.id;

    // The guest owns a personal package (owner = user_id). After promotion to member it
    // must STAY user-owned (invariant 3 — non-transferable, never pooled).
    const [pkg] = await db
      .insert(packages)
      .values({
        type: "pv8",
        category: "private",
        hoursTotal: 8,
        hoursLeft: 8,
        expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
        ownerUserId: guestId,
      })
      .returning({ id: packages.id });
    guestPackageId = pkg!.id;

    // Concurrency-race fixtures: two more households C & D, each with a member who can
    // create an invite, plus one household-less user who races both accepts.
    const [hC] = await db
      .insert(households)
      .values({ houseNumber: `${tag}-C` })
      .returning({ id: households.id });
    const [hD] = await db
      .insert(households)
      .values({ houseNumber: `${tag}-D` })
      .returning({ id: households.id });
    houseCId = hC!.id;
    houseDId = hD!.id;

    const [invC] = await db
      .insert(users)
      .values({ phone: `${tag}-inviterC`, name: `${tag}-inviterC`, tier: "member", householdId: houseCId })
      .returning({ id: users.id });
    const [invD] = await db
      .insert(users)
      .values({ phone: `${tag}-inviterD`, name: `${tag}-inviterD`, tier: "member", householdId: houseDId })
      .returning({ id: users.id });
    const [raceU] = await db
      .insert(users)
      .values({ phone: `${tag}-race`, name: `${tag}-race`, tier: "guest" })
      .returning({ id: users.id });
    inviterCId = invC!.id;
    inviterDId = invD!.id;
    raceUserId = raceU!.id;
  });

  afterAll(async () => {
    try {
      const db = getDb();
      const userIds = [
        inviterId,
        guestId,
        memberBId,
        inviterCId,
        inviterDId,
        raceUserId,
      ].filter(Boolean);
      const houseIds = [houseAId, houseBId, houseCId, houseDId].filter(Boolean);
      // Invites for our households (covers any created by the action).
      await db.delete(householdInvites).where(inArray(householdInvites.householdId, houseIds));
      // Ledger + packages owned by our users.
      if (guestPackageId) {
        await db.delete(creditLedger).where(eq(creditLedger.packageId, guestPackageId));
      }
      await db.delete(packages).where(inArray(packages.ownerUserId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
      await db.delete(households).where(inArray(households.id, houseIds));
    } finally {
      await closeDb();
    }
  });

  // ─────────────────────── 1. create + 2. join + single-use ───────────────────────

  it("a member creates an invite; a guest accepts → becomes a member of the household, single-use", async () => {
    // The inviter (member in house A) creates the invite via the real action.
    CURRENT_VIEWER = viewer(inviterId, "member", houseAId, `${tag}-A`);
    const created = await createInvite();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.url).toContain(`/join/${created.token}`);

    // The invite is persisted as pending for house A.
    const [row] = await getDb()
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.token, created.token));
    expect(row?.status).toBe("pending");
    expect(row?.householdId).toBe(houseAId);
    expect(row?.inviterUserId).toBe(inviterId);

    // The guest accepts.
    CURRENT_VIEWER = viewer(guestId, "guest", null, null);
    const accepted = await acceptInvite({ token: created.token });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.householdId).toBe(houseAId);
    expect(accepted.houseNumber).toBe(`${tag}-A`);

    // The user is now a MEMBER linked to house A (invariant 2 — reads the shared pool).
    const [joined] = await getDb()
      .select({ tier: users.tier, householdId: users.householdId })
      .from(users)
      .where(eq(users.id, guestId));
    expect(joined?.tier).toBe("member");
    expect(joined?.householdId).toBe(houseAId);

    // Invariant 3: their own package STAYS user-owned (not re-owned to the household).
    const [pkg] = await getDb()
      .select({ ownerUserId: packages.ownerUserId, ownerHouseholdId: packages.ownerHouseholdId })
      .from(packages)
      .where(eq(packages.id, guestPackageId));
    expect(pkg?.ownerUserId).toBe(guestId);
    expect(pkg?.ownerHouseholdId).toBeNull();

    // The invite is single-use: flipped to accepted, stamped, and a re-accept is rejected.
    const [after] = await getDb()
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.token, created.token));
    expect(after?.status).toBe("accepted");
    expect(after?.acceptedByUserId).toBe(guestId);
    expect(after?.acceptedAt).not.toBeNull();

    const reaccept = await acceptInvite({ token: created.token });
    expect(reaccept).toEqual({ ok: false, code: "INVITE_ALREADY_USED" });
  });

  // ─────────────────────── 3. cross-household block ───────────────────────

  it("a user already in ANOTHER household → ALREADY_IN_ANOTHER_HOUSEHOLD, nothing mutated", async () => {
    const token = `${tag}-cross`;
    await insertInvite({
      token,
      householdId: houseAId,
      inviterUserId: inviterId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });

    CURRENT_VIEWER = viewer(memberBId, "member", houseBId, `${tag}-B`);
    const res = await acceptInvite({ token });
    expect(res).toEqual({ ok: false, code: "ALREADY_IN_ANOTHER_HOUSEHOLD" });

    // memberB unchanged; invite still pending.
    const [mb] = await getDb()
      .select({ householdId: users.householdId })
      .from(users)
      .where(eq(users.id, memberBId));
    expect(mb?.householdId).toBe(houseBId);
    const [inv] = await getDb()
      .select({ status: householdInvites.status })
      .from(householdInvites)
      .where(eq(householdInvites.token, token));
    expect(inv?.status).toBe("pending");
  });

  // ─────────────────────── 4. expired (lazy) ───────────────────────

  it("an expired invite → INVITE_EXPIRED and is lazily flipped to 'expired'", async () => {
    const token = `${tag}-expired`;
    await insertInvite({
      token,
      householdId: houseAId,
      inviterUserId: inviterId,
      expiresAt: new Date(Date.now() - 60_000), // 1 min in the past
    });

    // Expiry is checked BEFORE the self/membership guards, so any viewer hits it; use a
    // real fixture user. No user UPDATE happens on the expired path (lazy expire only).
    CURRENT_VIEWER = viewer(memberBId, "member", houseBId, `${tag}-B`);
    const res = await acceptInvite({ token });
    expect(res).toEqual({ ok: false, code: "INVITE_EXPIRED" });

    const [inv] = await getDb()
      .select({ status: householdInvites.status })
      .from(householdInvites)
      .where(eq(householdInvites.token, token));
    expect(inv?.status).toBe("expired");
  });

  // ─────────────────────── 5. self ───────────────────────

  it("the inviter accepting their own invite → CANNOT_INVITE_SELF", async () => {
    const token = `${tag}-self`;
    await insertInvite({
      token,
      householdId: houseAId,
      inviterUserId: inviterId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });

    CURRENT_VIEWER = viewer(inviterId, "member", houseAId, `${tag}-A`);
    const res = await acceptInvite({ token });
    expect(res).toEqual({ ok: false, code: "CANNOT_INVITE_SELF" });
  });

  // ─────────────────────── not found ───────────────────────

  it("an unknown token → INVITE_NOT_FOUND", async () => {
    CURRENT_VIEWER = viewer(memberBId, "member", houseBId, `${tag}-B`);
    const res = await acceptInvite({ token: `${tag}-nope-does-not-exist` });
    expect(res).toEqual({ ok: false, code: "INVITE_NOT_FOUND" });
  });

  // ─────────────────────── 6. HIGH-1 cross-household TOCTOU race ───────────────────────

  it("one household-less user, TWO invites to TWO households, accepted concurrently → exactly one wins", async () => {
    // Two pending invites for the SAME household-less user, to DIFFERENT households (C, D).
    const tokenC = `${tag}-raceC`;
    const tokenD = `${tag}-raceD`;
    await insertInvite({
      token: tokenC,
      householdId: houseCId,
      inviterUserId: inviterCId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    await insertInvite({
      token: tokenD,
      householdId: houseDId,
      inviterUserId: inviterDId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });

    // The race user is genuinely household-less right now (pre-tx session state = null);
    // both concurrent accepts would, under the OLD code, read this stale null and BOTH
    // pass the ALREADY_IN_ANOTHER_HOUSEHOLD guard. The fix re-reads household_id under a
    // FOR UPDATE lock on the user's own row, serialising the two accepts.
    CURRENT_VIEWER = viewer(raceUserId, "guest", null, null);

    const [resC, resD] = await Promise.all([
      acceptInvite({ token: tokenC }),
      acceptInvite({ token: tokenD }),
    ]);

    // EXACTLY ONE accept succeeds; the loser is blocked by the (now serialised) guard —
    // either ALREADY_IN_ANOTHER_HOUSEHOLD (saw the just-committed other household) or
    // ALREADY_IN_THIS_HOUSEHOLD (degenerate timing). Never two successes.
    const results = [resC, resD];
    const wins = results.filter((r) => r.ok);
    expect(wins).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser && !loser.ok ? loser.code : "").toMatch(
      /ALREADY_IN_(ANOTHER|THIS)_HOUSEHOLD/,
    );

    // The user ends up in EXACTLY ONE household — the one whose accept won.
    const winningHouseholdId = wins[0]!.ok ? wins[0]!.householdId : "";
    expect([houseCId, houseDId]).toContain(winningHouseholdId);
    const [finalUser] = await getDb()
      .select({ tier: users.tier, householdId: users.householdId })
      .from(users)
      .where(eq(users.id, raceUserId));
    expect(finalUser?.tier).toBe("member");
    expect(finalUser?.householdId).toBe(winningHouseholdId);

    // EXACTLY ONE invite was consumed (flipped to 'accepted'); the loser's invite stays
    // pending (no extra invite burned by the losing accept).
    const [invC] = await getDb()
      .select({ status: householdInvites.status, acceptedByUserId: householdInvites.acceptedByUserId })
      .from(householdInvites)
      .where(eq(householdInvites.token, tokenC));
    const [invD] = await getDb()
      .select({ status: householdInvites.status, acceptedByUserId: householdInvites.acceptedByUserId })
      .from(householdInvites)
      .where(eq(householdInvites.token, tokenD));
    const statuses = [invC?.status, invD?.status];
    expect(statuses.filter((s) => s === "accepted")).toHaveLength(1);
    expect(statuses.filter((s) => s === "pending")).toHaveLength(1);

    // The consumed invite is the winning household's, stamped with the race user.
    const consumed = winningHouseholdId === houseCId ? invC : invD;
    expect(consumed?.status).toBe("accepted");
    expect(consumed?.acceptedByUserId).toBe(raceUserId);
  });
});
