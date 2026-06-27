// CRM listeners — the thin layer that turns domain events into LINE messages.
// Registering here keeps notifications event-driven off the real data model.
//
// LINE push targets a `lineUserId`, NOT a users.id / household_id UUID. Domain events
// carry our own DB ids (the source of truth), so handlers that push must RESOLVE the
// recipient's linked LINE id from the DB first and skip when it is null/absent (the
// user has not linked LINE yet). Listeners stay thin + best-effort — they never throw
// into the emitter (the bus isolates a throwing handler), and they no-op without a DB.

import { eq } from "drizzle-orm";
import { getLineClient } from "@/lib/line";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { on } from "./bus";

/**
 * Resolve a user's linked LINE id from their users.id (the id domain events carry).
 * Returns null when there is no DB configured, the user is gone, or LINE is unlinked —
 * the caller then skips the push (best-effort, never throws).
 */
async function lineIdForUser(userId: string): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  const [row] = await getDb()
    .select({ lineUserId: users.lineUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.lineUserId ?? null;
}

/**
 * Resolve the linked LINE ids of every member of a household (for pool-wide notices
 * like credit.low). Skips members who have not linked LINE. Empty when no DB / none linked.
 */
async function lineIdsForHousehold(householdId: string): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  const rows = await getDb()
    .select({ lineUserId: users.lineUserId })
    .from(users)
    .where(eq(users.householdId, householdId));
  return rows.map((r) => r.lineUserId).filter((id): id is string => id !== null);
}

let registered = false;

export function registerNotificationHandlers(): void {
  if (registered) return;
  registered = true;
  const line = getLineClient();

  on("schedule.published", async () => {
    await line.broadcast("Next week's schedule is live — book now.");
  });

  on("waitlist.offered", async (e) => {
    // e.userId is a users.id UUID — resolve the linked LINE id before pushing.
    const lineId = await lineIdForUser(e.userId);
    if (lineId) {
      await line.push(
        lineId,
        `A spot opened — confirm within 30 min to claim it. Hold expires ${e.holdExpiresAt}.`,
      );
    }
  });

  on("credit.low", async (e) => {
    // The event carries a household_id (a UUID), but LINE push needs each member's
    // linked LINE id — resolve the household's members and notify those who linked LINE.
    const lineIds = await lineIdsForHousehold(e.householdId);
    await Promise.all(
      lineIds.map((lineId) =>
        line.push(lineId, `Your household pool is down to ${e.hoursLeft} hr — top up.`),
      ),
    );
  });

  on("household.member_joined", async (e) => {
    // Thin listener — best-effort LINE notice to the inviter that someone joined. The
    // event carries the inviter's users.id; resolve their linked LINE id first (skip if
    // they have not linked LINE — pushing a DB UUID would target nobody).
    const lineId = await lineIdForUser(e.inviterUserId);
    if (lineId) {
      await line.push(lineId, `Someone joined your household — they now share your pool.`);
    }
  });

  on("payment.slip_submitted", async (e) => {
    // Thin listener — best-effort acknowledgement to the customer that their slip is
    // in review. The front desk picks it up from the admin payments queue. e.userId is
    // a users.id UUID — resolve the linked LINE id before pushing.
    const lineId = await lineIdForUser(e.userId);
    if (lineId) {
      await line.push(
        lineId,
        `We received your payment slip for ฿${e.amount.toLocaleString("en-US")} — it's now under review.`,
      );
    }
  });

  on("payment.slip_rejected", async (e) => {
    // Thin listener — best-effort notice to the customer that the slip was rejected,
    // with the admin reason when one was given. Re-upload is allowed. e.userId is a
    // users.id UUID — resolve the linked LINE id before pushing.
    const lineId = await lineIdForUser(e.userId);
    if (lineId) {
      const tail = e.reason ? ` (${e.reason})` : "";
      await line.push(
        lineId,
        `Your payment slip couldn't be verified${tail}. Please re-upload a clearer slip.`,
      );
    }
  });

  // booking.confirmed / booking.cancelled / credit.expiring handlers attach the
  // same way once we have the recipient's linked LINE id available.
}
