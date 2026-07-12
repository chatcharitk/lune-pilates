// Domain events. Every CRM/notification is a thin listener on one of these —
// never a parallel source of truth (CLAUDE.md §5, spec §6).

export type DomainEvent =
  | { type: "schedule.published"; weekStart: string }
  | { type: "booking.confirmed"; bookingId: string; userId: string; classInstanceId: string }
  | { type: "booking.cancelled"; bookingId: string; userId: string; refunded: boolean }
  | { type: "waitlist.offered"; waitlistId: string; userId: string; holdExpiresAt: string }
  | {
      /**
       * The studio cancelled a whole class (owner action): every live booking was
       * refunded and the waitlist expired without offers. Listeners notify the
       * affected customers; the truth (cancelled status + refund ledger rows) is
       * already in the model.
       */
      type: "class.cancelled";
      classInstanceId: string;
      startsAt: string;
      /** How many live bookings were cancelled (and refunded). */
      cancelledBookings: number;
    }
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
      /**
       * An owner manually adjusted a package's credit balance (Group D #8): a
       * `+delta` grant or a `−delta` deduction, recorded as a `reason='adjustment'`
       * ledger row. The CRM listens to notify the affected pool; the model already
       * holds the truth (the ledger row), so this is never a parallel source.
       */
      type: "credit.adjusted";
      /** The package whose balance was adjusted. */
      packageId: string;
      /** The target customer whose pool was adjusted (the ledger actor / recipient). */
      customerId: string;
      /** Where the adjusted balance lives (household pool member XOR user guest). */
      owner: { ownerHouseholdId: string | null; ownerUserId: string | null };
      /** Signed credits moved (+grant / −deduction). */
      delta: number;
      /** Usable balance on the package AFTER the adjustment. */
      hoursLeft: number;
      /** The required admin note explaining the adjustment (audit). */
      note: string;
      /** The acting admin's session id (rides the EVENT — not the ledger actor). */
      adminId: string;
    };

export type DomainEventType = DomainEvent["type"];
export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;
