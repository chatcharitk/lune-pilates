import { requireOwner } from "@/lib/auth/admin";
import { rangeBounds } from "@/lib/admin/period";
import { listSales } from "@/lib/admin/sales";
import { SalesView } from "@/components/admin/sales-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Sales history" (Group D #1, prototype Payments table conventions). A
// read-only, date-range-scoped view of EVERY charge (all statuses) plus a CSV
// export. OWNER-ONLY: gated with requireOwner() and renders <AdminForbidden/> for
// an instructor (or unauth) BEFORE the read, so customer PII / revenue never leaves
// on an unauthorized call — mirroring dashboard/page.tsx + the export route's gate.
//
// The date range comes from the URL searchParams (from/to, yyyy-mm-dd), parsed via
// rangeBounds (fails closed to the current-month default on a malformed value). The
// client SalesView pushes new dates to the URL so THIS server component re-fetches
// the range — money/identities are always read server-side (CLAUDE.md §8).
export const dynamic = "force-dynamic";

export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const { from, to } = await searchParams;
  const range = rangeBounds(from, to);
  const rows = await listSales(range);
  return <SalesView rows={rows} from={from ?? null} to={to ?? null} />;
}
