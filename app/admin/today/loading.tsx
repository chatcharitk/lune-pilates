// Route-level skeleton for /admin/today — paints instantly on tab switch while
// the force-dynamic page fetches. Approximates TodayView: header, the 5 stat
// tiles, then the class timeline cards. Presentational only (no i18n, no data).

import { SkeletonCardList, SkeletonHeader, SkeletonScreen, SkeletonStatTiles } from "@/components/skeleton";

export default function AdminTodayLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonStatTiles count={5} className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5" />
      <SkeletonCardList count={4} cardClassName="h-[96px]" />
    </SkeletonScreen>
  );
}
