// LINE messaging boundary. v1 ships a mock; the real LINE Messaging API client
// implements the same interface later with zero change to business logic.

export interface FlexBookingCard {
  classType: string;
  startsAt: Date;
  instructor?: string;
  balanceLeft: number;
}

export interface LineClient {
  /** Direct push to one linked user. */
  push(lineUserId: string, text: string): Promise<void>;
  /** Broadcast to all linked users (e.g. weekly schedule published). */
  broadcast(text: string): Promise<void>;
  /** Rich booking-confirmation flex card. */
  pushBookingCard(lineUserId: string, card: FlexBookingCard): Promise<void>;
}
