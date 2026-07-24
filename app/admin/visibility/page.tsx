import { requireOwner } from "@/lib/auth/admin";
import { listVisibilityWindows } from "@/app/actions/admin-visibility";
import { VisibilityView } from "@/components/admin/visibility-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Booking windows" — owner-only editor for the tiered-visibility lead time
// per class type (CLAUDE.md §5 invariant 4). Contract in
// app/actions/admin-visibility.ts. Routed at /admin/visibility (flat, matching
// every other admin section — /admin/packages, /admin/payments, /admin/sales — none
// of which live under a "/admin/settings" parent, so this doesn't introduce one
// either) — admin-visibility.ts's revalidatePath calls target this exact path.
//
// Same belt-and-braces gate shape as app/admin/packages/page.tsx: requireOwner()
// renders <AdminForbidden/> before the read, then a second `!res.ok` branch catches
// the action's own re-check (its only failure code is UNAUTHORIZED).
//
// force-dynamic so every load (including the router.refresh() after a save) re-reads
// the DB — belt-and-braces alongside the revalidatePath calls, never relied on alone.
export const dynamic = "force-dynamic";

export default async function AdminVisibilityPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const res = await listVisibilityWindows();
  if (!res.ok) {
    return <AdminForbidden />;
  }
  return <VisibilityView windows={res.windows} />;
}
