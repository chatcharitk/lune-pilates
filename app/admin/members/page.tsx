import { listCustomers } from "@/lib/admin/members";
import { requireOwner } from "@/lib/auth/admin";
import { MembersView } from "@/components/admin/members-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Members / Customers & households" (spec §4). OWNER-ONLY: gated with
// requireOwner() and renders <AdminForbidden/> for an instructor BEFORE the read
// (customer PII). Server-fetches the customer list (each row's balance is the
// server-computed shared household pool for members / personal balance for guests
// — CLAUDE.md §5 invariants 2 & 3) and renders the client MembersView, which owns
// search, the household-sharing detail drawer, and the "add a new customer" form.
export const dynamic = "force-dynamic";

export default async function AdminMembersPage() {
  // The page is owner-gated, so reaching here implies an owner — but pass the
  // boolean explicitly so the "Adjust credits" control is owner-scoped and
  // future-proof if this page is ever opened to another role.
  const owner = await requireOwner();
  if (!owner) {
    return <AdminForbidden />;
  }
  const customers = await listCustomers();
  return <MembersView customers={customers} isOwner={owner !== null} />;
}
