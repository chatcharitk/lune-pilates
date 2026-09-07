import { requireOwner } from "@/lib/auth/admin";
import { listTerms } from "@/app/actions/admin-settings";
import { TermsEditorView } from "@/components/admin/terms-editor-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Settings → Terms & Conditions. The owner writes the terms every customer must
// tick to accept before a charge is opened (app/actions/purchase.ts).
//
// Same belt-and-braces gate as the other owner-only pages: requireOwner() renders
// <AdminForbidden/> before the read, then the action's own re-check is honoured too.
//
// force-dynamic so a publish (which router.refresh()es) always re-reads the new
// active version rather than a cached one.
export const dynamic = "force-dynamic";

export default async function AdminTermsPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const res = await listTerms();
  if (!res.ok) {
    return <AdminForbidden />;
  }
  // Dates cross the server→client boundary as ISO strings so the view stays a plain
  // serializable-props client component (matching the app's other admin views).
  return (
    <TermsEditorView
      active={{
        version: res.active.version,
        bodyEn: res.active.bodyEn,
        bodyTh: res.active.bodyTh,
        publishedAtIso: res.active.publishedAt.toISOString(),
      }}
      history={res.history.map((v) => ({
        id: v.id,
        version: v.version,
        publishedAtIso: v.publishedAt.toISOString(),
      }))}
    />
  );
}
