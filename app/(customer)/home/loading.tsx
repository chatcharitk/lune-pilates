// Route-level skeleton for /home — greeting row, the balance hero card, the
// next-class card, then the "this week" horizontal card strip (mirrors HomeView).

import { SkeletonBlock, SkeletonCard, SkeletonScreen } from "@/components/skeleton";

export default function HomeLoading() {
  return (
    <SkeletonScreen className="px-[18px] pt-1.5">
      <div className="mb-[18px] mt-1 flex items-center justify-between gap-3.5">
        <div className="min-w-0 flex-1">
          <SkeletonBlock className="h-6 w-40 rounded-full" />
          <SkeletonBlock className="mt-2 h-4 w-52 max-w-full rounded-full" />
        </div>
        <SkeletonBlock className="h-11 w-11 shrink-0 rounded-full" />
      </div>
      <SkeletonCard className="h-[128px] rounded-lune" />
      <SkeletonCard className="mt-4 h-[96px]" />
      <SkeletonBlock className="mb-3 mt-6 h-4 w-28 rounded-full" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[104px] w-[144px] shrink-0 rounded-lune-sm" />
        ))}
      </div>
    </SkeletonScreen>
  );
}
