// Route-level skeleton for /bookings — the upcoming/past segmented control then
// the booking cards.

import { SkeletonBlock, SkeletonCardList, SkeletonScreen } from "@/components/skeleton";

export default function BookingsLoading() {
  return (
    <SkeletonScreen className="px-[18px] pt-2">
      <SkeletonBlock className="mb-4 h-10 w-full rounded-full" />
      <SkeletonCardList count={3} cardClassName="h-[104px]" className="flex flex-col gap-3" />
    </SkeletonScreen>
  );
}
