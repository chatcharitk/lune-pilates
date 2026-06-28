import { getAdminInstructors } from "@/lib/admin/instructors";
import { requireOwner } from "@/lib/auth/admin";
import { InstructorsView } from "@/components/admin/instructors-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin "Instructors" (spec §4; prototypes admin-more.jsx `InstructorsScreen` +
// admin-mobile-more.jsx `MInstructors` / `MAvailEditor`). OWNER-ONLY: gated with
// requireOwner() and renders <AdminForbidden/> for an instructor BEFORE the read.
// Server-fetches each active instructor with today's classes (+ live roster
// counts), today's availability, and the full weekly availability the editor binds
// to, then renders the client InstructorsView (a responsive grid of cards + the
// weekly availability editor drawer). All read logic lives server-side
// (lib/admin/instructors.ts); the view only renders state and sends the
// setInstructorAvailability action.
export const dynamic = "force-dynamic";

export default async function AdminInstructorsPage() {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const instructors = await getAdminInstructors();
  return <InstructorsView instructors={instructors} />;
}
