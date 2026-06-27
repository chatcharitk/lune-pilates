// Domain events. Every CRM/notification is a thin listener on one of these —
// never a parallel source of truth (CLAUDE.md §5, spec §6).

export type DomainEvent =
  | { type: "schedule.published"; weekStart: string }
  | { type: "booking.confirmed"; bookingId: string; userId: string; classInstanceId: string }
  | { type: "booking.cancelled"; bookingId: string; userId: string; refunded: boolean }
  | { type: "waitlist.offered"; waitlistId: string; userId: string; holdExpiresAt: string }
  | { type: "credit.low"; householdId: string; hoursLeft: number }
  | { type: "credit.expiring"; packageId: string; expiresAt: string; daysLeft: number }
  | {
      type: "credit.purchased";
      packageId: string;
      userId: string;
      /** Where the credited balance landed: a household pool (member) or a user (guest). */
      ownerHouseholdId: string | null;
      ownerUserId: string | null;
      hours: number;
      /** Usable balance after crediting (the new package's hours_left). */
      hoursLeft: number;
    }
  | {
      /** A customer uploaded a PromptPay slip; the charge is now awaiting admin review (Feature 3). */
      type: "payment.slip_submitted";
      chargeId: string;
      /** The charge owner who uploaded the slip. */
      userId: string;
      /** THB amount the charge was opened for (from the catalog at checkout). */
      amount: number;
    }
  | {
      /** An admin rejected an uploaded slip; no credit was granted (Feature 3). */
      type: "payment.slip_rejected";
      chargeId: string;
      /** The charge owner, notified their slip was rejected. */
      userId: string;
      /** Optional admin-supplied reason shown to the customer. */
      reason: string | null;
    }
  | {
      /** A user accepted a household invite and joined the pool (Feature 2). */
      type: "household.member_joined";
      householdId: string;
      /** The user who joined (now tier='member', linked to householdId). */
      userId: string;
      /** The member who created the invite — notified that someone joined. */
      inviterUserId: string;
    };

export type DomainEventType = DomainEvent["type"];
export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;
