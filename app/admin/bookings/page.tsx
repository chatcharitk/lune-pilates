import { getAdminBookingsOverview } from "@/lib/admin/bookings";
import { BookingsView } from "@/components/admin/bookings-view";

// Admin "Bookings & waitlist control" (spec §4, admin-more.jsx BookingsAdminScreen).
// Server-fetches the whole screen in one read model (all bookings + the waitlist
// grouped by full class — both server-computed, including the cancellation verdict
// and live confirm-window) and renders the client BookingsView, which owns the two
// tabs, the cancel drawer and the Notify action.
export const dynamic = "force-dynamic";

export default async function AdminBookingsPage() {
  const overview = await getAdminBookingsOverview();
  return <BookingsView overview={overview} />;
}
