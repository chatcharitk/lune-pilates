import { requireOwner } from "@/lib/auth/admin";
import { listTerms } from "@/app/actions/admin-settings";
import { TermsEditorView } from "@/components/admin/terms-editor-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Settings → Booking terms (2026-09-27). The studio's class rules every customer
// accepts when booking — once per version (lib/settings/terms.ts → gateBookingTerms).
//
// Same belt-and-braces gate as the other owner-only pages: requireOwner() renders
// <AdminForbidden/> before the read, then the action's own re-check is honoured too.
//
// force-dynamic so a publish (which router.refresh()es) always re-reads the new
// active version rather than a cached one.
export const dynamic = "force-dynamic";

export default async function AdminBookingTermsPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const res = await listTerms("booking");
  if (!res.ok) {
    return <AdminForbidden />;
  }
  // Dates cross the server→client boundary as ISO strings so the view stays a plain
  // serializable-props client component (matching the app's other admin views).
  return (
    <TermsEditorView
      kind="booking"
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
