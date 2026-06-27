import { getWeekSchedule } from "@/lib/admin/schedule";
import { ScheduleView } from "@/components/admin/schedule-view";

// Admin Schedule management (spec §4). Server-fetches one week (defaulting to the
// current week, or `?week=YYYY-MM-DD`) and renders it into the client view, which
// drives create/edit/delete and publish through server actions.
export const dynamic = "force-dynamic";

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const anchor = week ? new Date(`${week}T00:00:00`) : new Date();
  const schedule = await getWeekSchedule(Number.isNaN(anchor.getTime()) ? new Date() : anchor);
  return <ScheduleView schedule={schedule} />;
}
