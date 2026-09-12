import { requireOwner } from "@/lib/auth/admin";
import { listPromosForAdmin } from "@/app/actions/admin-promos";
import { listCatalogForAdmin } from "@/app/actions/admin-catalog";
import { PromosView } from "@/components/admin/promos-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Settings → Promo codes. Event discounts (pre-opening, soft opening, grand
// opening): the owner creates a code, shares it, and the buy screen applies it.
//
// Same belt-and-braces gate as the other owner-only pages: requireOwner() renders
// <AdminForbidden/> before the read, and the action re-checks independently.
//
// force-dynamic so redemption counts are current on every load — "how many are
// left" is the whole reason to open this screen.
export const dynamic = "force-dynamic";

export default async function AdminPromosPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const [promos, catalog] = await Promise.all([listPromosForAdmin(), listCatalogForAdmin()]);
  if (!promos.ok) {
    return <AdminForbidden />;
  }
  return (
    <PromosView
      codes={promos.codes}
      // Restricting a code to one package needs the list to choose from; archived
      // items are filtered out since a code pointing at one could never be used.
      items={
        catalog.ok
          ? catalog.items
              .filter((i) => i.active)
              .map((i) => ({ id: i.id, label: i.label, category: i.category }))
          : []
      }
    />
  );
}
