import { getWeekSchedule } from "@/lib/admin/schedule";
import { getScheduleTemplate } from "@/lib/admin/schedule-template";
import { studioDayFromYmd } from "@/lib/time";
import { requireAdmin } from "@/lib/auth/admin";
import { ScheduleView } from "@/components/admin/schedule-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin Schedule (spec §4). OWNER: the full management surface (create/edit,
// template, generate). INSTRUCTOR: a read-only week scoped to THEIR classes (so
// they can see their teaching week ahead, not just Today) — no owner controls;
// the roster drawer still opens (check-in is instructor-allowed & scoped, and the
// owner-only mutations inside it reject server-side regardless). Server-fetches
// one week (defaulting to the current week, or `?week=YYYY-MM-DD`).
export const dynamic = "force-dynamic";

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await requireAdmin();
  if (!session) {
    return <AdminForbidden />;
  }
  const isInstructor = session.role === "instructor";

  const { week } = await searchParams;
  // Anchor to the Bangkok day of `?week=YYYY-MM-DD` (or today), so the week range
  // is Bangkok-aligned regardless of the runtime timezone. studioDayFromYmd fails
  // closed to the current Bangkok day for an absent/malformed param.
  const anchor = studioDayFromYmd(week);
  const [schedule, template] = await Promise.all([
    getWeekSchedule(
      anchor,
      isInstructor && session.instructorId ? { instructorId: session.instructorId } : undefined,
    ),
    // The template editor is owner-only chrome — skip the read for instructors.
    isInstructor ? Promise.resolve([]) : getScheduleTemplate(),
  ]);
  return <ScheduleView schedule={schedule} template={template} readOnly={isInstructor} />;
}
