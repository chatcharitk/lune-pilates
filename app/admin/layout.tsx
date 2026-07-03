import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/auth/admin";

// Admin surface installs as its own standalone app: a separate manifest scoped
// to /admin (start_url /admin/today) replaces the customer app/manifest.ts link,
// so "Add to Home Screen" from any /admin page yields the admin app. Metadata
// merges with the root layout; appleWebApp is replaced wholesale, so restate
// capable/statusBarStyle alongside the admin title.
export const metadata: Metadata = {
  title: "LUNE Admin",
  manifest: "/admin.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "LUNE Admin" },
};

// Admin app shell (responsive: dark sidebar on tablet/desktop, bottom nav on
// phones). Lives under the literal `/admin` path so its routes never collide with
// the customer surface (/home, /schedule, …). The chrome + language toggle are in
// AdminShell (client); pages below render server-fetched data into client views.
//
// Resolves the acting admin's role server-side and passes it to AdminShell so the
// nav reflects privilege: an instructor's nav collapses to just Today (the real
// authorization is enforced per page via requireOwner). Defaults to owner when no
// session resolves (e.g. ADMIN_AUTH=deny — pages then refuse on their own).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return <AdminShell role={session?.role ?? "owner"}>{children}</AdminShell>;
}
