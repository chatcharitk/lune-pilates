import { NextResponse } from "next/server";
import {
  applyGroupChanges,
  groupChanges,
  messagingChannelSecret,
  verifyLineSignature,
  type LineWebhookEvent,
} from "@/lib/line/webhook";

// LINE Messaging API webhook. Set in LINE Developers → Messaging API → Webhook URL:
//   https://<site>/api/line/webhook
// Only group join/leave/message events are acted on (staff notification groups); everything
// else is acknowledged and ignored. See lib/line/webhook.ts.
export const dynamic = "force-dynamic";

// Opened in a browser: say what this address is, rather than a blank 405 that
// browsers save as an empty "webhook" file.
export function GET() {
  return new Response(
    "LUNE LINE webhook ✓\nใส่ลิงก์นี้ใน LINE Developers → Messaging API → Webhook URL แล้วกด Verify\n(เปิดในเบราว์เซอร์จะไม่มีอะไรเกิดขึ้น — ลิงก์นี้สำหรับ LINE เท่านั้น)\n",
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

export async function POST(req: Request) {
  const secret = messagingChannelSecret();
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get("x-line-signature"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let events: LineWebhookEvent[] = [];
  try {
    const body = JSON.parse(raw) as { events?: LineWebhookEvent[] };
    events = Array.isArray(body.events) ? body.events : [];
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  // What arrived, without message text or user ids — enough to see why a group did
  // or didn't register (e.g. a "room" or a 1:1 chat instead of a group).
  console.info(
    "[line webhook]",
    events.length === 0 ? "verify (no events)" : events.map((e) => `${e.type}/${e.source?.type ?? "?"}`).join(", "),
  );

  // LINE's "Verify" button sends an empty events list — answer 200.
  const changes = groupChanges(events);
  if (changes.joined.length || changes.left.length || changes.seen.length) await applyGroupChanges(changes);
  return NextResponse.json({ ok: true });
}
