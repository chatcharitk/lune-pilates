// Route-level skeleton for /admin/dashboard — header, a stat-tile row, then the
// three tall section cards (sales / capacity / retention).

import { SkeletonCard, SkeletonHeader, SkeletonScreen, SkeletonStatTiles } from "@/components/skeleton";

export default function AdminDashboardLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonStatTiles count={4} />
      <div className="flex flex-col gap-4">
        <SkeletonCard className="h-[220px] rounded-lune" />
        <SkeletonCard className="h-[180px] rounded-lune" />
        <SkeletonCard className="h-[180px] rounded-lune" />
      </div>
    </SkeletonScreen>
  );
}
