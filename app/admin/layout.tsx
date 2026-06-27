import { AdminShell } from "@/components/admin/admin-shell";

// Admin app shell (responsive: dark sidebar on tablet/desktop, bottom nav on
// phones). Lives under the literal `/admin` path so its routes never collide with
// the customer surface (/home, /schedule, …). The chrome + language toggle are in
// AdminShell (client); pages below render server-fetched data into client views.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
