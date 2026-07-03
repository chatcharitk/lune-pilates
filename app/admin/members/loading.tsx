// Route-level skeleton for /admin/members — header, the search field, then the
// customer-row placeholders.

import { SkeletonBlock, SkeletonCardList, SkeletonHeader, SkeletonScreen } from "@/components/skeleton";

export default function AdminMembersLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonBlock className="mb-4 h-11 w-full rounded-full" />
      <SkeletonCardList count={6} cardClassName="h-[64px]" />
    </SkeletonScreen>
  );
}
