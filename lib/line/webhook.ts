// LINE Messaging API webhook (2026-10-12) — only used to learn which group chats
// the studio's Official Account has been invited into, so staff notifications
// (lib/events/staff-notify.ts) know where to go.
//
// Every request is authenticated by LINE's `x-line-signature`: base64 HMAC-SHA256 of
// the RAW body with the Messaging API channel secret. Anything unsigned is refused
// before a single event is looked at — otherwise anyone could register their own
// group and receive the studio's customer names and bookings.

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { lineNotifyGroups } from "@/lib/db/schema";
import { getLineClient } from "@/lib/line";

/** The Messaging API channel secret. Separate from LINE Login's when they differ. */
export function messagingChannelSecret(): string | null {
  return process.env.LINE_MESSAGING_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET || null;
}

/** True when `signature` is LINE's HMAC of `rawBody` under `secret`. Pure. */
export function verifyLineSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The slice of a LINE webhook event this app reads. */
export interface LineWebhookEvent {
  type: string;
  source?: { type?: string; groupId?: string };
  message?: { type?: string; text?: string };
}

/** Typed in a staff group, re-posts the latest booking as a test notification. */
export const TEST_COMMAND = "#ทดสอบ";

export interface GroupChanges {
  joined: string[];
  left: string[];
  /**
   * Groups heard from by a message. LINE sends "join" only once, at invite time, so
   * a group the account was ALREADY in when the webhook was switched on never
   * produced one — any message posted there registers it instead.
   */
  seen: string[];
  /** Groups where someone typed TEST_COMMAND. */
  tests: string[];
}

/** Pull out the group joins/leaves/messages — the only events acted on. Pure. */
export function groupChanges(events: readonly LineWebhookEvent[]): GroupChanges {
  const joined: string[] = [];
  const left: string[] = [];
  const seen: string[] = [];
  const tests: string[] = [];
  for (const e of events) {
    const groupId = e.source?.type === "group" ? e.source.groupId : undefined;
    if (!groupId) continue;
    if (e.type === "join") joined.push(groupId);
    else if (e.type === "leave") left.push(groupId);
    else if (e.type === "message") {
      if (!seen.includes(groupId)) seen.push(groupId);
      if (e.message?.text?.trim() === TEST_COMMAND && !tests.includes(groupId)) tests.push(groupId);
    }
  }
  return { joined, left, seen, tests };
}

const GREETING = "สวัสดีค่ะ LUNE จะแจ้งเตือนทุกการจองคลาสใหม่ในกลุ่มนี้นะคะ 🌙";

/**
 * Record joins (re-joining clears left_at), first-time message groups, and leaves;
 * greet a group the first time it is registered. A message from a group already on
 * file does nothing — in particular it never re-subscribes a group whose leave was
 * recorded (a bot that left can't receive messages there anyway).
 */
export async function applyGroupChanges(changes: GroupChanges): Promise<void> {
  const db = getDb();
  const line = getLineClient();
  const greet = (groupId: string) =>
    line.push(groupId, GREETING).catch((err) => console.error("[line webhook] greeting failed", err));

  for (const groupId of changes.joined) {
    const name = await line.groupName(groupId).catch(() => null);
    await db
      .insert(lineNotifyGroups)
      .values({ groupId, name })
      .onConflictDoUpdate({
        target: lineNotifyGroups.groupId,
        set: { name, joinedAt: new Date(), leftAt: null },
      });
    await greet(groupId);
  }
  for (const groupId of changes.seen) {
    if (changes.joined.includes(groupId)) continue;
    // Already on file (the usual case for a chatty group) — nothing to do, no LINE call.
    const [known] = await db
      .select({ groupId: lineNotifyGroups.groupId })
      .from(lineNotifyGroups)
      .where(eq(lineNotifyGroups.groupId, groupId))
      .limit(1);
    if (known) continue;
    const name = await line.groupName(groupId).catch(() => null);
    const inserted = await db
      .insert(lineNotifyGroups)
      .values({ groupId, name })
      .onConflictDoNothing({ target: lineNotifyGroups.groupId })
      .returning({ groupId: lineNotifyGroups.groupId });
    if (inserted.length === 1) await greet(groupId);
  }
  for (const groupId of changes.left) {
    await db.update(lineNotifyGroups).set({ leftAt: new Date() }).where(eq(lineNotifyGroups.groupId, groupId));
  }
}
