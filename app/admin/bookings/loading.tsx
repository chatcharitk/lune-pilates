// Route-level skeleton for /admin/bookings — header, the filter pill row, then
// the bookings-table row placeholders.

import { SkeletonCardList, SkeletonHeader, SkeletonPillRow, SkeletonScreen } from "@/components/skeleton";

export default function AdminBookingsLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonPillRow count={4} />
      <SkeletonCardList count={5} cardClassName="h-[68px]" />
    </SkeletonScreen>
  );
}
