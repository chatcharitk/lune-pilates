// Real LINE Messaging API client (LINE_MODE=live). Implements the same LineClient
// interface the mock does, so the CRM listeners (lib/events/notifications.ts) push
// real messages with zero change to business logic.
//
// Best-effort by contract: the event bus isolates a throwing handler (lib/events/
// bus.ts), so a LINE outage / bad token can never break the booking or purchase that
// emitted the event. We still throw on a non-2xx so the failure is logged there.

import type { FlexBookingCard, LineClient } from "./types";
import { formatStudioTime } from "@/lib/time";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast";

export class LiveLineClient implements LineClient {
  private readonly token: string;

  constructor(token: string = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "") {
    if (!token) {
      throw new Error(
        "LINE_MODE=live but LINE_CHANNEL_ACCESS_TOKEN is missing. " +
          "Set the Messaging API channel's long-lived access token.",
      );
    }
    this.token = token;
  }

  private async send(url: string, body: unknown): Promise<void> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LINE ${url} failed (${res.status}): ${detail}`);
    }
  }

  async push(lineUserId: string, text: string): Promise<void> {
    await this.send(PUSH_URL, { to: lineUserId, messages: [{ type: "text", text }] });
  }

  async broadcast(text: string): Promise<void> {
    await this.send(BROADCAST_URL, { messages: [{ type: "text", text }] });
  }

  async pushBookingCard(lineUserId: string, card: FlexBookingCard): Promise<void> {
    // v1 sends a clean text confirmation (a Flex card can be layered on later without
    // touching callers). Bangkok wall-clock time via the studio formatter.
    const time = formatStudioTime(card.startsAt);
    const lines = [
      "จองคลาสสำเร็จ ✓",
      `${card.classType} · ${time} น.`,
      card.instructor ? `ครูผู้สอน: ${card.instructor}` : null,
      `เครดิตคงเหลือ: ${card.balanceLeft} ชั่วโมง`,
    ].filter(Boolean);
    await this.push(lineUserId, lines.join("\n"));
  }
}
