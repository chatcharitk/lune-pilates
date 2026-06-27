import type { FlexBookingCard, LineClient } from "./types";

/** v1 mock — logs instead of calling LINE. Swap for the real client later. */
export class MockLineClient implements LineClient {
  async push(lineUserId: string, text: string): Promise<void> {
    console.info(`[LINE mock] push → ${lineUserId}: ${text}`);
  }
  async broadcast(text: string): Promise<void> {
    console.info(`[LINE mock] broadcast: ${text}`);
  }
  async pushBookingCard(lineUserId: string, card: FlexBookingCard): Promise<void> {
    console.info(
      `[LINE mock] booking card → ${lineUserId}: ${card.classType} @ ${card.startsAt.toISOString()} · balance ${card.balanceLeft}`,
    );
  }
  async createInviteShareLink(token: string): Promise<{ url: string; lineShareUrl: string }> {
    const base = process.env.APP_URL ?? "http://localhost:3000";
    const url = `${base}/join/${token}`;
    // Bilingual invite text + the join link, packed into a LINE share-intent URL.
    const message = `ร่วมใช้แพ็กเกจของบ้านเราที่ LUNE Pilates / Join our LUNE Pilates household pool: ${url}`;
    const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
    console.info(`[LINE mock] invite share link → ${url}`);
    return { url, lineShareUrl };
  }
}
