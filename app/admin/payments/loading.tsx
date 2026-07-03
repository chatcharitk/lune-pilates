// Route-level skeleton for /admin/payments — header, the 4 stat tiles, then the
// payment-row placeholders.

import { SkeletonCardList, SkeletonHeader, SkeletonScreen, SkeletonStatTiles } from "@/components/skeleton";

export default function AdminPaymentsLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonStatTiles count={4} />
      <SkeletonCardList count={5} cardClassName="h-[64px]" />
    </SkeletonScreen>
  );
}
