import { listCustomers } from "@/lib/admin/members";
import { MembersView } from "@/components/admin/members-view";

// Admin "Members / Customers & households" (spec §4). Server-fetches the customer
// list (each row's balance is the server-computed shared household pool for members
// / personal balance for guests — CLAUDE.md §5 invariants 2 & 3) and renders the
// client MembersView, which owns search, the household-sharing detail drawer, and
// the "add a new customer on the spot" form.
export const dynamic = "force-dynamic";

export default async function AdminMembersPage() {
  const customers = await listCustomers();
  return <MembersView customers={customers} />;
}
