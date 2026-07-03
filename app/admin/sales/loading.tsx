// Route-level skeleton for /admin/sales — header, the range-picker pill row,
// then the sales-table row placeholders.

import { SkeletonCardList, SkeletonHeader, SkeletonPillRow, SkeletonScreen } from "@/components/skeleton";

export default function AdminSalesLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonPillRow count={4} />
      <SkeletonCardList count={6} cardClassName="h-[56px]" />
    </SkeletonScreen>
  );
}
