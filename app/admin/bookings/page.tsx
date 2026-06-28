import { getAdminBookingsOverview } from "@/lib/admin/bookings";
import { listBookableClasses } from "@/lib/schedule/queries";
import { currentWeekStart } from "@/components/customer/schedule-helpers";
import { requireOwner } from "@/lib/auth/admin";
import { BookingsView } from "@/components/admin/bookings-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Bookings & waitlist control" (spec §4, admin-more.jsx BookingsAdminScreen).
// OWNER-ONLY: gated with requireOwner() and renders <AdminForbidden/> for an
// instructor BEFORE the read. Server-fetches the whole screen in one read model
// (all bookings + the waitlist grouped by full class — both server-computed,
// including the cancellation verdict and live confirm-window) PLUS the bookable
// classes for this week (member visibility, so the front desk sees every published
// class) that feed the drawer's admin-reschedule picker. Renders the client
// BookingsView, which owns the two tabs, the cancel/reschedule drawer and Notify.
export const dynamic = "force-dynamic";

export default async function AdminBookingsPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const now = new Date();
  const [overview, bookable] = await Promise.all([
    getAdminBookingsOverview(),
    // The reschedule target candidates. Admin sees with full ("member") visibility
    // — the tiered gate is a customer browsing restriction, not an admin one. The
    // action re-validates everything server-side; this only populates the picker.
    listBookableClasses({ viewer: { tier: "member" }, weekStart: currentWeekStart(now), now }),
  ]);
  return <BookingsView overview={overview} bookable={bookable} />;
}
