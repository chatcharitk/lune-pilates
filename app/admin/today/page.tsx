import { getTodayOverview } from "@/lib/admin/today";
import { requireAdmin } from "@/lib/auth/admin";
import { TodayView } from "@/components/admin/today-view";

// Admin "Today at a glance" (spec §4). Reachable by BOTH roles (owner + instructor).
// Server-fetches the live overview (today's classes, rosters, waitlist and stat
// tiles — server-computed, never trusted from the client) and renders it into the
// client TodayView, which owns check-in.
//
// An INSTRUCTOR session is scoped to their OWN classes: we pass `instructorId` so
// the overview + stats reflect only their day. An owner passes nothing (= all
// classes, unchanged behaviour).
export const dynamic = "force-dynamic";

export default async function AdminTodayPage() {
  const session = await requireAdmin();
  const instructorId =
    session?.role === "instructor" && session.instructorId ? session.instructorId : undefined;
  const overview = await getTodayOverview(new Date(), { instructorId });
  return <TodayView overview={overview} />;
}
