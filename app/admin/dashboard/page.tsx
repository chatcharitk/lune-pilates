import { getDashboardOverview } from "@/lib/admin/analytics";
import { requireAdmin } from "@/lib/auth/admin";
import { DashboardView } from "@/components/admin/dashboard-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Business Overview" dashboard (Feature 4; prototypes LUNE Admin
// Analytics.html + admin-mobile-analytics.jsx). Server-fetches the whole
// dashboard in ONE await (getDashboardOverview → three sections in parallel,
// every ฿/count computed server-side) and renders the client DashboardView.
//
// This is the studio's READ-ONLY god-view: it exposes studio-wide revenue +
// customer PII with NO tiered visibility, so unlike the other admin pages (whose
// reads are not individually gated in v1) it explicitly calls requireAdmin() and
// refuses to render for a non-admin. The v1 mock always authorises; a real
// provider (or ADMIN_AUTH=deny) flips this to the UNAUTHORIZED path with no UI
// change. It NEVER mutates anything — capacity alerts only deep-link to
// /admin/schedule (CLAUDE.md §5 inv 5).
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  if (!admin) {
    return <AdminForbidden />;
  }
  const overview = await getDashboardOverview();
  return <DashboardView overview={overview} />;
}
