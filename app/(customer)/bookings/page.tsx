// Customer "My Bookings" screen (CLAUDE.md §4–§6; mirrors
// lune-pilates/project/lune-extra.jsx). Server component: resolve the viewer
// server-side, fetch their own bookings (upcoming / past) via listMyBookings —
// which computes the 5-hour cancellation eligibility server-side — then hand the
// typed split to the interactive BookingsView for the tab + cancel sheet.
//
// No business logic lives in the UI: the policy hint on each card and the refund
// a cancel returns come from the backend, never a client clock or balance.

import { getCurrentUser } from "@/lib/auth/session";
import { listMyBookings } from "@/lib/bookings/queries";
import { listBookableClasses } from "@/lib/schedule/queries";
import { listMyWaitlist } from "@/lib/waitlist/queries";
import { BookingsView } from "@/components/customer/bookings-view";
import { currentWeekStart } from "@/components/customer/schedule-helpers";

// Reads live per-user bookings each request — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const viewer = await getCurrentUser();
  // Fetch the viewer's own bookings, this week's bookable slots (the latter feeds
  // the reschedule slot picker), AND their live waitlist entries (waiting/offered,
  // lazily-expired offers downgraded server-side). Tiered visibility is enforced
  // inside listBookableClasses — the UI only renders what these queries return.
  const [bookings, bookable, waitlist] = await Promise.all([
    listMyBookings(viewer),
    listBookableClasses({ viewer: { tier: viewer.tier }, weekStart: currentWeekStart() }),
    listMyWaitlist(viewer),
  ]);

  return (
    <BookingsView bookings={bookings} bookable={bookable} waitlist={waitlist} />
  );
}
