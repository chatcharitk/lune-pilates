import { getAdminInstructors } from "@/lib/admin/instructors";
import { InstructorsView } from "@/components/admin/instructors-view";

// Admin "Instructors" (spec §4; prototypes admin-more.jsx `InstructorsScreen` +
// admin-mobile-more.jsx `MInstructors` / `MAvailEditor`). Server-fetches each active
// instructor with today's classes (+ live roster counts), today's availability, and
// the full weekly availability the editor binds to, then renders the client
// InstructorsView (a responsive grid of cards + the weekly availability editor
// drawer). All read logic lives server-side (lib/admin/instructors.ts); the view
// only renders state and sends the setInstructorAvailability action.
export const dynamic = "force-dynamic";

export default async function AdminInstructorsPage() {
  const instructors = await getAdminInstructors();
  return <InstructorsView instructors={instructors} />;
}
