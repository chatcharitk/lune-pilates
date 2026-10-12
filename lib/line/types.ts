// LINE messaging boundary. v1 ships a mock; the real LINE Messaging API client
// implements the same interface later with zero change to business logic.

export interface FlexBookingCard {
  classType: string;
  startsAt: Date;
  instructor?: string;
  balanceLeft: number;
}

export interface LineClient {
  /** Direct push to one linked user — or a group chat (a group id works as `to`). */
  push(lineUserId: string, text: string): Promise<void>;
  /** A group chat's display name, or null when it can't be read. */
  groupName(groupId: string): Promise<string | null>;
  /** Broadcast to all linked users (e.g. weekly schedule published). */
  broadcast(text: string): Promise<void>;
  /** Rich booking-confirmation flex card. */
  pushBookingCard(lineUserId: string, card: FlexBookingCard): Promise<void>;
}
