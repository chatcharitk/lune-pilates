// Route-level skeleton for /admin/schedule — header, the week-day chip strip,
// then a column of day sections with class-card placeholders.

import {
  SkeletonBlock,
  SkeletonCardList,
  SkeletonHeader,
  SkeletonPillRow,
  SkeletonScreen,
} from "@/components/skeleton";

export default function AdminScheduleLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonPillRow count={7} />
      <div className="flex flex-col gap-5">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i}>
            <SkeletonBlock className="mb-2.5 h-4 w-28 rounded-full" />
            <SkeletonCardList count={2} cardClassName="h-[72px]" />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
