import { getDashboardOverview } from "@/lib/admin/analytics";
import { requireOwner } from "@/lib/auth/admin";
import { DashboardView } from "@/components/admin/dashboard-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Business Overview" dashboard (Feature 4; prototypes LUNE Admin
// Analytics.html + admin-mobile-analytics.jsx). Server-fetches the whole
// dashboard in ONE await (getDashboardOverview → three sections in parallel,
// every ฿/count computed server-side) and renders the client DashboardView.
//
// This is the studio's READ-ONLY god-view: it exposes studio-wide revenue +
// customer PII with NO tiered visibility, so it is OWNER-ONLY — it calls
// requireOwner() and renders <AdminForbidden/> for an instructor (or unauth)
// BEFORE the studio-wide read, so an instructor never triggers the PII fetch. The
// v1 mock owner authorises; an instructor session (or ADMIN_AUTH=deny) is refused
// with no UI change. It NEVER mutates anything — capacity alerts only deep-link to
// /admin/schedule (CLAUDE.md §5 inv 5).
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const overview = await getDashboardOverview();
  return <DashboardView overview={overview} />;
}
