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
}
