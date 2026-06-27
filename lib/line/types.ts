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
  /**
   * Build the share surfaces for a household invite (Feature 2 "เชิญคนในบ้าน").
   * - `url` is the in-app join link the invitee opens (`/join/<token>`).
   * - `lineShareUrl` is a LINE share-intent URL that pre-fills a bilingual invite
   *   message + the join link, so the inviter can forward it inside LINE.
   * The token is the ONLY secret the link carries (no household id, no identity).
   */
  createInviteShareLink(token: string): Promise<{ url: string; lineShareUrl: string }>;
}
