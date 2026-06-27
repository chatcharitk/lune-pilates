// Tiered visibility (CLAUDE.md §5, invariant 4). One ClassInstance, two computed
// timestamps, filtered by the viewer's tier and the current time. No duplicate
// schedules. Pure functions — unit-tested in tests/visibility.test.ts.

import type { ClassType, UserTier } from "@/lib/domain/types";
import { DEFAULT_PUBLIC_LEAD_HOURS } from "@/lib/domain/types";

export interface VisibilityInput {
  status: "draft" | "published";
  startsAt: Date;
  publicVisibleAt: Date | null;
}

/** When non-members can first see a published class: starts_at − N hours. */
export function computePublicVisibleAt(
  startsAt: Date,
  type: ClassType,
  leadHours: number = DEFAULT_PUBLIC_LEAD_HOURS[type],
): Date {
  return new Date(startsAt.getTime() - leadHours * 3_600_000);
}

/**
 * Can `viewer` book this instance right now? Mirrors the SQL booking filter:
 *   status='published' AND starts_at > now
 *   AND (tier='member' OR now >= public_visible_at)
 */
export function isBookableForViewer(
  instance: VisibilityInput,
  viewer: { tier: UserTier },
  now: Date,
): boolean {
  if (instance.status !== "published") return false;
  if (instance.startsAt.getTime() <= now.getTime()) return false;
  if (viewer.tier === "member") return true;
  return instance.publicVisibleAt !== null && now.getTime() >= instance.publicVisibleAt.getTime();
}
