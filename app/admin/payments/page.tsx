import { getPaymentsOverview } from "@/lib/admin/payments";
import { listCustomers } from "@/lib/admin/members";
import { requireOwner } from "@/lib/auth/admin";
import { PaymentsView } from "@/components/admin/payments-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Payments & POS" (spec §4, prototypes admin-more.jsx PaymentsScreen +
// admin-mobile-pos.jsx MPos/MPayFlow). OWNER-ONLY: gated with requireOwner() and
// renders <AdminForbidden/> for an instructor BEFORE the reads (revenue + customer
// PII). Server-fetches the payments overview (four period stat tiles + every
// charge, newest first — all money shaped server-side) AND the customer list (for
// the POS "assign a customer" picker — a package sale REQUIRES an owner to credit),
// then renders the client PaymentsView, which owns the table and the stepped "New
// sale" POS flow (package → customer → method → receipt).
export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const [overview, customers] = await Promise.all([getPaymentsOverview(), listCustomers()]);
  return <PaymentsView overview={overview} customers={customers} />;
}
