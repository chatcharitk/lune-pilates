// Customer week schedule (CLAUDE.md §4–§6). Server component: resolve the viewer
// server-side, fetch the bookable week via listBookableClasses (which enforces
// tiered visibility — invariant 4), then hand the typed list to the interactive
// ScheduleView for day/filter selection. No business logic lives in the UI.
//
// The viewed week is driven by a forward `?week=` offset (0 = current week),
// clamped server-side to [0, MAX_WEEK_OFFSET] so the customer can page forward far
// enough to reach open future rentals (whose booking window opens up to a month
// ahead) but never into the un-bookable past.

import { getCurrentUser } from "@/lib/auth/session";
import { listBookableClasses } from "@/lib/schedule/queries";
import { ScheduleView } from "@/components/customer/schedule-view";
import {
  MAX_WEEK_OFFSET,
  clampWeekOffset,
  scheduleWeekDays,
  scheduleWeekStart,
  weekRangeLabel,
} from "@/components/customer/schedule-helpers";

// Reads the live published week + viewer per request — never static.
export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const viewer = await getCurrentUser();
  const now = new Date();
  const { week } = await searchParams;
  const offset = clampWeekOffset(week);
  // The viewed week's start (Bangkok-anchored) windows the server query; the same
  // offset builds the day chips and the date-range header so they never disagree.
  const weekStart = scheduleWeekStart(offset, now);
  const classes = await listBookableClasses({
    viewer: { tier: viewer.tier },
    weekStart,
    now,
  });

  return (
    <ScheduleView
      // Remount per week so the selected-day state resets to the new week's first day.
      key={offset}
      classes={classes}
      week={scheduleWeekDays(offset, now)}
      rangeLabel={weekRangeLabel(offset, now)}
      weekOffset={offset}
      maxWeekOffset={MAX_WEEK_OFFSET}
    />
  );
}
