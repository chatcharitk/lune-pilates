// Route-level skeleton for /schedule/[id] — back link, the class-detail card,
// then the seat picker + CTA placeholders (mirrors ClassDetailView).

import { SkeletonBlock, SkeletonCard, SkeletonScreen } from "@/components/skeleton";

export default function ClassDetailLoading() {
  return (
    <SkeletonScreen className="px-[18px] pt-2">
      <SkeletonBlock className="mb-4 h-9 w-9 rounded-full" />
      <SkeletonCard className="h-[164px] rounded-lune" />
      <SkeletonBlock className="mb-3 mt-6 h-4 w-32 rounded-full" />
      <div className="flex gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[76px] flex-1 rounded-lune-sm" />
        ))}
      </div>
      <SkeletonBlock className="mt-6 h-12 w-full rounded-full" />
    </SkeletonScreen>
  );
}
