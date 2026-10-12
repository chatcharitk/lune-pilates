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
// Only group join/leave events are acted on (staff notification groups); everything
// else is acknowledged and ignored. See lib/line/webhook.ts.
export const dynamic = "force-dynamic";

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

  // LINE's "Verify" button sends an empty events list — answer 200.
  const changes = groupChanges(events);
  if (changes.joined.length || changes.left.length) await applyGroupChanges(changes);
  return NextResponse.json({ ok: true });
}
