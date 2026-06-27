// Customer week schedule (CLAUDE.md §4–§6). Server component: resolve the viewer
// server-side, fetch the bookable week via listBookableClasses (which enforces
// tiered visibility — invariant 4), then hand the typed list to the interactive
// ScheduleView for day/filter selection. No business logic lives in the UI.

import { getCurrentUser } from "@/lib/auth/session";
import { listBookableClasses } from "@/lib/schedule/queries";
import { ScheduleView } from "@/components/customer/schedule-view";
import { buildWeek, currentWeekStart, monthLabel } from "@/components/customer/schedule-helpers";

// Reads the live published week + viewer per request — never static.
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const viewer = await getCurrentUser();
  // Anchor the bookable strip to the real current day, computed server-side and
  // passed to the view so server/client agree on "today" (no hydration drift).
  const weekStart = currentWeekStart();
  const classes = await listBookableClasses({
    viewer: { tier: viewer.tier },
    weekStart,
  });

  return (
    <ScheduleView
      classes={classes}
      week={buildWeek(weekStart)}
      month={monthLabel(weekStart)}
    />
  );
}
