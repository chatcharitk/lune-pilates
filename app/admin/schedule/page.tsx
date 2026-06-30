import { getWeekSchedule } from "@/lib/admin/schedule";
import { getScheduleTemplate } from "@/lib/admin/schedule-template";
import { studioDayFromYmd } from "@/lib/time";
import { requireOwner } from "@/lib/auth/admin";
import { ScheduleView } from "@/components/admin/schedule-view";
import { AdminForbidden } from "@/components/admin/admin-forbidden";

// Admin Schedule management (spec §4). OWNER-ONLY: gated with requireOwner() and
// renders <AdminForbidden/> for an instructor BEFORE the week read. Server-fetches
// one week (defaulting to the current week, or `?week=YYYY-MM-DD`) and renders it
// into the client view, which drives create/edit/delete and publish through server
// actions.
export const dynamic = "force-dynamic";

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  if (!(await requireOwner())) {
    return <AdminForbidden />;
  }
  const { week } = await searchParams;
  // Anchor to the Bangkok day of `?week=YYYY-MM-DD` (or today), so the week range
  // is Bangkok-aligned regardless of the runtime timezone. studioDayFromYmd fails
  // closed to the current Bangkok day for an absent/malformed param.
  const anchor = studioDayFromYmd(week);
  const [schedule, template] = await Promise.all([
    getWeekSchedule(anchor),
    getScheduleTemplate(),
  ]);
  return <ScheduleView schedule={schedule} template={template} />;
}
