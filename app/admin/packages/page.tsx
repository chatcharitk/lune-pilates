import { requireOwner } from "@/lib/auth/admin";
import { listCatalogForAdmin } from "@/app/actions/admin-catalog";
import { PackagesView } from "@/components/admin/packages-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Packages" — owner-only CRUD over the purchasable catalog
// (`catalog_items`; contract in app/actions/admin-catalog.ts). Pricing is
// commercially sensitive, so this is gated with requireOwner() and renders
// <AdminForbidden/> for an instructor (or unauth) BEFORE the read — the same shape
// as instructors/page.tsx and sales/page.tsx. The `!res.ok` branch is a second
// belt-and-braces gate: listCatalogForAdmin re-checks the role server-side and its
// only failure code is UNAUTHORIZED.
//
// Every write revalidates /admin/packages from the action (revalidateCatalog), so
// this server component re-reads after each edit; the client view only renders
// state and sends requests (CLAUDE.md §8 — no client-side money math). `perHour` is
// DERIVED server-side on read and is never editable.
export const dynamic = "force-dynamic";

export default async function AdminPackagesPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const res = await listCatalogForAdmin();
  if (!res.ok) {
    return <AdminForbidden />;
  }
  return <PackagesView items={res.items} />;
}
