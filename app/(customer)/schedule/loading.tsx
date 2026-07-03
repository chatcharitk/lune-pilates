// Route-level skeleton for /schedule — the day-chip strip then the class cards.
// Also covers first paint of the nested /schedule/[id] segment.

import { SkeletonCardList, SkeletonPillRow, SkeletonScreen } from "@/components/skeleton";

export default function ScheduleLoading() {
  return (
    <SkeletonScreen className="px-[18px] pt-2">
      <SkeletonPillRow count={7} className="mb-4 flex gap-2 overflow-hidden" />
      <SkeletonCardList count={5} cardClassName="h-[76px]" className="flex flex-col gap-2.5" />
    </SkeletonScreen>
  );
}
