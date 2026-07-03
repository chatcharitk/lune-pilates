// Route-level skeleton for /buy — balance strip then the package catalog cards
// (mirrors BuyView).

import { SkeletonBlock, SkeletonCardList, SkeletonScreen } from "@/components/skeleton";

export default function BuyLoading() {
  return (
    <SkeletonScreen className="px-[18px] pt-2">
      <SkeletonBlock className="mb-4 h-[64px] w-full rounded-lune-sm" />
      <SkeletonBlock className="mb-3 h-4 w-36 rounded-full" />
      <SkeletonCardList count={4} cardClassName="h-[112px]" className="flex flex-col gap-3" />
    </SkeletonScreen>
  );
}
