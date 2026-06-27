"use server";

// Server actions for Feature 2 — "เชิญคนในบ้าน" (household member invite). The typed
// contracts the frontend imports and calls directly.
//
// Security (CLAUDE.md §5/§8): identity is ALWAYS server-resolved via getCurrentUser();
// the client never supplies a userId, tier, or household. The join link carries ONLY an
// opaque token — no household id, no identity — so the token is the single secret.
//
// Invariants enforced here:
//   - inv 2 (shared household pool): accepting LINKS the joiner to the inviter's
//     household_id, so they immediately read/affect the same derived pool.
//   - inv 3 (guests non-transferable): a guest who accepts is PROMOTED to tier='member'
//     and linked to the household, but their existing user-owned packages stay
//     user-owned (we never re-own packages). The household pool is derived from
//     household_id; the promoted user simply starts reading the shared pool going forward.
//   - A user already in ANOTHER household is BLOCKED (ALREADY_IN_ANOTHER_HOUSEHOLD) —
//     we never move pools across households.
//
// Tokens are unguessable (192-bit crypto-random base64url), SINGLE-USE, 7-day expiry.
// Multiple concurrent pending invites per household are allowed.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { householdInvites, households, users } from "@/lib/db/schema";
import { getLineClient } from "@/lib/line";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";

// ───────────────────────── token + expiry ─────────────────────────

/** 7 days in milliseconds — the invite lifetime. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Generate an unguessable single-use token (24 random bytes ⇒ 192-bit, base64url). */
function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

// ───────────────────────── createInvite ─────────────────────────

export type CreateInviteFailureCode = "NOT_A_MEMBER" | "NO_HOUSEHOLD";

export type CreateInviteResult =
  | {
      ok: true;
      /** The opaque single-use token (the only secret in the link). */
      token: string;
      /** The in-app join link the invitee opens (`/join/<token>`). */
      url: string;
      /** A LINE share-intent URL pre-filled with the bilingual invite + link. */
      lineShareUrl: string;
      /** ISO-8601 expiry instant (now + 7 days). */
      expiresAt: string;
    }
  | { ok: false; code: CreateInviteFailureCode };

/**
 * Create a household invite for the current member.
 *
 * Any MEMBER of the household may create an invite (no owner-only restriction). The
 * viewer must be tier='member' (else NOT_A_MEMBER) and belong to a household (else
 * NO_HOUSEHOLD). The token is minted server-side, the invite row is inserted with a
 * 7-day expiry, and the LINE adapter builds the share surfaces.
 *
 * No-DB dev path: returns a synthesized token + share surfaces so the UI renders
 * without a database (nothing is persisted).
 */
export async function createInvite(): Promise<CreateInviteResult> {
  const viewer = await getCurrentUser();

  if (viewer.tier !== "member") return { ok: false, code: "NOT_A_MEMBER" };
  if (viewer.householdId === null) return { ok: false, code: "NO_HOUSEHOLD" };

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  // Persist branch: with a DB configured, write the invite row (7-day expiry) so the
  // token resolves to a real pending invite. No-DB dev fallthrough: skip the insert and
  // just synthesize the share surfaces below, so the UI renders without a database
  // (mirrors getCurrentUser's mock — nothing is persisted).
  if (process.env.DATABASE_URL) {
    const db = getDb();
    await db.insert(householdInvites).values({
      token,
      householdId: viewer.householdId,
      inviterUserId: viewer.id,
      expiresAt,
    });
  }

  const { url, lineShareUrl } = await getLineClient().createInviteShareLink(token);

  return { ok: true, token, url, lineShareUrl, expiresAt: expiresAt.toISOString() };
}

// ───────────────────────── acceptInvite ─────────────────────────

const acceptInviteInput = z.object({
  token: z.string().min(1).max(200),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteInput>;

export type AcceptInviteFailureCode =
  | "INVALID_INPUT"
  | "INVITE_NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INVITE_ALREADY_USED"
  | "INVITE_REVOKED"
  | "ALREADY_IN_THIS_HOUSEHOLD"
  | "ALREADY_IN_ANOTHER_HOUSEHOLD"
  | "CANNOT_INVITE_SELF";

export type AcceptInviteResult =
  | { ok: true; houseNumber: string; householdId: string }
  | { ok: false; code: AcceptInviteFailureCode };

/**
 * Accept a household invite as the current user, joining the inviter's household pool.
 *
 * Runs ONE interactive transaction on the WebSocket Pool (CLAUDE.md §2): the invite is
 * locked FOR UPDATE by token, validated (exists / pending / not expired — expired is
 * lazily flipped to 'expired' and returns INVITE_EXPIRED). getCurrentUser() identifies
 * only WHO the joiner is (their id); their household STATE is then re-read under a row
 * lock (`SELECT … FROM users WHERE id = joiner FOR UPDATE`) so the membership guards run
 * against the LOCKED current household_id, never the stale pre-tx session value. This
 * serialises concurrent accepts BY THE SAME USER on their own user row — two invites to
 * two different households accepted at once can no longer both read household_id=null and
 * both win (defeating invariant 3's boundary); the loser sees the just-committed
 * household and returns ALREADY_IN_THIS_HOUSEHOLD / ALREADY_IN_ANOTHER_HOUSEHOLD.
 *   - inviter === joiner → CANNOT_INVITE_SELF
 *   - joiner already in THIS household → ALREADY_IN_THIS_HOUSEHOLD
 *   - joiner already in ANOTHER household → ALREADY_IN_ANOTHER_HOUSEHOLD
 * On success: the joiner is promoted to tier='member' and linked to the household, and
 * the invite is marked accepted (single use, asserting exactly one row flipped pending→
 * accepted, else INVITE_ALREADY_USED) — all-or-nothing. Then a domain event is emitted
 * for the thin CRM listener (best-effort, never a parallel source of truth).
 *
 * No-DB dev path: returns ok with the mock household so the join screen renders.
 */
export async function acceptInvite(raw: AcceptInviteInput): Promise<AcceptInviteResult> {
  const parsed = acceptInviteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { token } = parsed.data;

  const viewer = await getCurrentUser();

  // No-DB dev: synthesize a successful join into the mock household.
  if (!process.env.DATABASE_URL) {
    return {
      ok: true,
      houseNumber: viewer.houseNumber ?? "A-114",
      householdId: viewer.householdId ?? "00000000-0000-4000-8000-0000000000a1",
    };
  }

  const db = getDb();
  const now = new Date();

  // Internal transaction result carries the inviter for the post-commit event, so we
  // don't widen the public AcceptInviteResult or re-query after commit.
  type TxOutcome =
    | { ok: true; houseNumber: string; householdId: string; inviterUserId: string }
    | { ok: false; code: AcceptInviteFailureCode };

  const outcome = await db.transaction(async (tx): Promise<TxOutcome> => {
    // Lock the invite row by token so concurrent accepts of the same token serialise:
    // exactly one can flip it to 'accepted'; the loser re-reads it as already used.
    const [invite] = await tx
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.token, token))
      .for("update");

    if (!invite) return { ok: false, code: "INVITE_NOT_FOUND" };

    if (invite.status === "accepted") return { ok: false, code: "INVITE_ALREADY_USED" };
    if (invite.status === "revoked") return { ok: false, code: "INVITE_REVOKED" };
    if (invite.status === "expired") return { ok: false, code: "INVITE_EXPIRED" };

    // status === 'pending' from here. Lazily expire if past TTL.
    if (invite.expiresAt.getTime() <= now.getTime()) {
      await tx
        .update(householdInvites)
        .set({ status: "expired" })
        .where(eq(householdInvites.id, invite.id));
      return { ok: false, code: "INVITE_EXPIRED" };
    }

    // getCurrentUser() told us WHO the joiner is; re-read their household STATE under a
    // row lock so the membership guards run against the LOCKED current household_id, not
    // the stale pre-tx session value. This serialises concurrent accepts by the same
    // user on their own user row (HIGH-1 TOCTOU fix): two invites to two different
    // households can no longer both observe household_id=null and both UPDATE it.
    const [joiner] = await tx
      .select({ id: users.id, householdId: users.householdId })
      .from(users)
      .where(eq(users.id, viewer.id))
      .for("update");

    // The joiner must exist (server-resolved identity; absence means a deleted user).
    if (!joiner) return { ok: false, code: "INVITE_NOT_FOUND" };

    // Membership guards against the LOCKED current household state.
    if (invite.inviterUserId === joiner.id) return { ok: false, code: "CANNOT_INVITE_SELF" };
    if (joiner.householdId === invite.householdId) {
      return { ok: false, code: "ALREADY_IN_THIS_HOUSEHOLD" };
    }
    if (joiner.householdId !== null && joiner.householdId !== invite.householdId) {
      return { ok: false, code: "ALREADY_IN_ANOTHER_HOUSEHOLD" };
    }

    // Resolve the house number for the success screen.
    const [house] = await tx
      .select({ houseNumber: households.houseNumber })
      .from(households)
      .where(eq(households.id, invite.householdId))
      .limit(1);

    // Promote the joiner to member + link to the household (inv 2 — now reads the pool;
    // inv 3 preserved — their own packages are untouched, still user-owned).
    await tx
      .update(users)
      .set({ householdId: invite.householdId, tier: "member" })
      .where(eq(users.id, joiner.id));

    // Single-use: flip the invite to accepted, stamping who/when. The `status='pending'`
    // guard makes the flip a CAS — assert it actually changed exactly one row (capture
    // the affected ids via RETURNING). If zero, the invite was concurrently consumed
    // between our lock read and now → roll back this accept as INVITE_ALREADY_USED.
    const flipped = await tx
      .update(householdInvites)
      .set({ status: "accepted", acceptedByUserId: joiner.id, acceptedAt: now })
      .where(and(eq(householdInvites.id, invite.id), eq(householdInvites.status, "pending")))
      .returning({ id: householdInvites.id });
    if (flipped.length !== 1) return { ok: false, code: "INVITE_ALREADY_USED" };

    return {
      ok: true,
      houseNumber: house?.houseNumber ?? "",
      householdId: invite.householdId,
      inviterUserId: invite.inviterUserId,
    };
  });

  if (!outcome.ok) return outcome;

  // CRM is a thin listener — emit only on a real join. Best-effort; a failing handler
  // never breaks the accept (events bus isolates listeners).
  registerNotificationHandlers();
  await emit({
    type: "household.member_joined",
    householdId: outcome.householdId,
    userId: viewer.id,
    inviterUserId: outcome.inviterUserId,
  });

  return { ok: true, houseNumber: outcome.houseNumber, householdId: outcome.householdId };
}
