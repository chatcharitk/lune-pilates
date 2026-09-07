import { requireOwner } from "@/lib/auth/admin";
import { getStudioInfo } from "@/app/actions/admin-settings";
import { StudioInfoView } from "@/components/admin/studio-info-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Settings → Studio info: the owner's editable studio identity (name, address,
// phone, opening hours, maps link). Presentational data only — nothing here gates a
// booking or a charge.
export const dynamic = "force-dynamic";

export default async function AdminStudioInfoPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const res = await getStudioInfo();
  if (!res.ok) {
    return <AdminForbidden />;
  }
  return <StudioInfoView info={res.info} />;
}
