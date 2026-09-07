import { requireOwner } from "@/lib/auth/admin";
import { SettingsView } from "@/components/admin/settings-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Settings" — the owner's hub for everything that configures the studio
// rather than operates it day to day: the purchase Terms & Conditions, the studio's
// own details, the booking-visibility windows, and the package catalog.
//
// The last two already had their own top-level routes (/admin/visibility,
// /admin/packages) and KEEP them: those paths are bookmarked, and their actions'
// revalidatePath calls target them by name. Settings links out to them rather than
// re-homing them, and admin-shell.tsx drops them from the primary nav so there is
// one obvious way in (SETTINGS_ROUTES there keeps the Settings tab highlighted while
// the owner is on one of those pages).
//
// Owner-only: every child page re-gates independently, so this hub being reachable
// is never what authorizes anything.
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  return <SettingsView />;
}
