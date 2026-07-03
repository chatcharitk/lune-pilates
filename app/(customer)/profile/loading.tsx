// Route-level skeleton for /profile — identity row, the balance hero card, the
// household list, then purchase-history rows (mirrors ProfileView).

import { SkeletonBlock, SkeletonCard, SkeletonCardList, SkeletonScreen } from "@/components/skeleton";

export default function ProfileLoading() {
  return (
    <SkeletonScreen className="px-[18px] pt-2">
      <div className="mb-5 flex items-center gap-3.5">
        <SkeletonBlock className="h-14 w-14 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <SkeletonBlock className="h-5 w-36 rounded-full" />
          <SkeletonBlock className="mt-2 h-4 w-24 rounded-full" />
        </div>
      </div>
      <SkeletonCard className="h-[128px] rounded-lune" />
      <SkeletonBlock className="mb-3 mt-6 h-4 w-32 rounded-full" />
      <SkeletonCardList count={3} cardClassName="h-[60px]" className="flex flex-col gap-2.5" />
    </SkeletonScreen>
  );
}
