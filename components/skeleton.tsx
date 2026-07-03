// Shared loading-skeleton primitives for the route-level `loading.tsx` files.
// Pure presentational server components: no client JS, no i18n keys (the blocks
// are decorative and hidden from assistive tech; the wrapper announces busy).
// Warm-token styling only (cream surfaces, soft radii) so the flash of skeleton
// reads as "the app", not a grey placeholder library.

import type { ReactNode } from "react";

/** One pulsing placeholder block. Size/shape via className. */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-cream-2/80 ${className}`} />;
}

/**
 * Busy wrapper for a whole loading screen: marks the region busy for assistive
 * tech and hides the decorative placeholder blocks from it.
 */
export function SkeletonScreen({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div aria-busy="true" className={className}>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** Page header placeholder: a title line + a shorter subtitle line. */
export function SkeletonHeader({ className = "mb-5" }: { className?: string }) {
  return (
    <div className={className}>
      <SkeletonBlock className="h-7 w-44 rounded-full" />
      <SkeletonBlock className="mt-2 h-4 w-64 max-w-full rounded-full" />
    </div>
  );
}

/** Card placeholder approximating one list row / class card. */
export function SkeletonCard({ className = "h-[84px]" }: { className?: string }) {
  return <SkeletonBlock className={`w-full rounded-lune-sm ${className}`} />;
}

/** A vertical stack of card placeholders. */
export function SkeletonCardList({
  count = 4,
  cardClassName,
  className = "flex flex-col gap-3",
}: {
  count?: number;
  cardClassName?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} className={cardClassName} />
      ))}
    </div>
  );
}

/** Grid of stat-tile placeholders (admin screens' top row). */
export function SkeletonStatTiles({
  count = 4,
  className = "mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock key={i} className="h-[74px] rounded-lune-sm" />
      ))}
    </div>
  );
}

/** A row of pill placeholders (day chips, filter tabs, range pickers). */
export function SkeletonPillRow({
  count = 5,
  className = "mb-4 flex gap-2 overflow-hidden",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock key={i} className="h-9 w-16 shrink-0 rounded-full" />
      ))}
    </div>
  );
}
