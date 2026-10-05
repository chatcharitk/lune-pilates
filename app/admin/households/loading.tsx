// Route-level skeleton for /admin/households — header, search, then house cards.

import { SkeletonBlock, SkeletonCardList, SkeletonHeader, SkeletonScreen } from "@/components/skeleton";

export default function AdminHouseholdsLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonBlock className="mb-4 h-11 w-full rounded-full" />
      <SkeletonCardList count={4} cardClassName="h-[150px]" />
    </SkeletonScreen>
  );
}
