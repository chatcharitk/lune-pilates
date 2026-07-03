// Route-level skeleton for /admin/instructors — header then one tall card per
// instructor (today's classes + availability editor).

import { SkeletonCardList, SkeletonHeader, SkeletonScreen } from "@/components/skeleton";

export default function AdminInstructorsLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <SkeletonCardList count={3} cardClassName="h-[150px] rounded-lune" className="flex flex-col gap-4" />
    </SkeletonScreen>
  );
}
