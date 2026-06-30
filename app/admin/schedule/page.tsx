import { getWeekSchedule } from "@/lib/admin/schedule";
import { getScheduleTemplate } from "@/lib/admin/schedule-template";
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
  const anchor = week ? new Date(`${week}T00:00:00`) : new Date();
  const [schedule, template] = await Promise.all([
    getWeekSchedule(Number.isNaN(anchor.getTime()) ? new Date() : anchor),
    getScheduleTemplate(),
  ]);
  return <ScheduleView schedule={schedule} template={template} />;
}
