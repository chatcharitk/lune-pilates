import { getTodayOverview } from "@/lib/admin/today";
import { TodayView } from "@/components/admin/today-view";

// Admin "Today at a glance" (spec §4). Server-fetches the live overview (today's
// classes, rosters, waitlist and stat tiles — server-computed, never trusted from
// the client) and renders it into the client TodayView, which owns check-in.
export const dynamic = "force-dynamic";

export default async function AdminTodayPage() {
  const overview = await getTodayOverview();
  return <TodayView overview={overview} />;
}
