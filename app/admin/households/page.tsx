import { listHouseholds } from "@/lib/admin/households";
import { requireOwner } from "@/lib/auth/admin";
import { HouseholdsView } from "@/components/admin/households-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Households": each house number, who is in it, and the classes it has
// left. OWNER-ONLY (customer PII + balances), gated before the read.
export const dynamic = "force-dynamic";

export default async function AdminHouseholdsPage() {
  if (!(await requireOwner())) return <AdminForbidden />;
  const households = await listHouseholds();
  return <HouseholdsView households={households} />;
}
