import { getAdminBookingsOverview } from "@/lib/admin/bookings";
import { listBookableClasses } from "@/lib/schedule/queries";
import { listCustomers } from "@/lib/admin/members";
import { currentWeekStart } from "@/components/customer/schedule-helpers";
import { addDays } from "@/lib/time";
import { requireOwner } from "@/lib/auth/admin";
import { BookingsView } from "@/components/admin/bookings-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Bookings & waitlist control" (spec §4, admin-more.jsx BookingsAdminScreen).
// OWNER-ONLY: gated with requireOwner() and renders <AdminForbidden/> for an
// instructor BEFORE the read. Server-fetches the whole screen in one read model
// (all bookings + the waitlist grouped by full class — both server-computed,
// including the cancellation verdict and live confirm-window) PLUS the bookable
// classes (member visibility, so the front desk sees every published class) that
// feed the reschedule picker AND the "book for a customer" flow, and the customer
// list for that flow's customer picker. Renders the client BookingsView.
export const dynamic = "force-dynamic";

export default async function AdminBookingsPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const now = new Date();
  // Bookable candidates across the next 4 weeks (this week + 3) so the front desk
  // can book/reschedule a customer into an upcoming class, not just this week. Admin
  // sees with full ("member") visibility — the tiered gate is a customer browsing
  // restriction, not an admin one. The action re-validates everything server-side;
  // this only populates the pickers.
  const weekStarts = [0, 1, 2, 3].map((i) => addDays(currentWeekStart(now), i * 7));
  const [overview, customers, ...bookableWeeks] = await Promise.all([
    getAdminBookingsOverview(),
    listCustomers({}, now),
    ...weekStarts.map((weekStart) => listBookableClasses({ viewer: { tier: "member" }, weekStart, now })),
  ]);
  // Dedupe by class id — distinct across weeks on the real DB (no-op), but the
  // no-DB mock returns the same synthetic ids per week, so collapse those.
  const bookable = [...new Map(bookableWeeks.flat().map((c) => [c.id, c])).values()];
  return <BookingsView overview={overview} bookable={bookable} customers={customers} />;
}
