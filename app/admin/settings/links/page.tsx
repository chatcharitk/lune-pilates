import { headers } from "next/headers";
import { requireOwner } from "@/lib/auth/admin";
import { listUploads } from "@/app/actions/admin-uploads";
import { LinksView } from "@/components/admin/links-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Settings → Links & images. The addresses to paste into a LINE rich menu, and
// somewhere to put an image and get a link for it (owner, 2026-09-17).
//
// force-dynamic because the origin is read from the REQUEST: the page shows the
// links exactly as they are for whoever is looking, rather than a domain baked in at
// build time that could be wrong in staging or on a phone over the local network.
export const dynamic = "force-dynamic";

/** The absolute origin this admin is browsing, honouring the proxy's headers. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

export default async function AdminLinksPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const [uploads, origin] = await Promise.all([listUploads(), requestOrigin()]);
  if (!uploads.ok) {
    return <AdminForbidden />;
  }
  return <LinksView uploads={uploads.items} origin={origin} />;
}
