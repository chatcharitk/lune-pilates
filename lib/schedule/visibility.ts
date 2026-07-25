// Tiered visibility (CLAUDE.md §5, invariant 4). One ClassInstance, two computed
// timestamps, filtered by the viewer's tier and the current time. No duplicate
// schedules. Pure functions — unit-tested in tests/visibility.test.ts.
//
// Lead times are now OWNER-CONFIGURABLE per class type AND per customer tier
// (lib/schedule/visibilityWindows.ts `visibility_windows` table), replacing the
// hardcoded DEFAULT_PUBLIC_LEAD_HOURS constant. This module stays pure and
// synchronous: callers resolve `(memberLeadHours, guestLeadHours)` from the
// DB-backed map ONCE (loadVisibilityWindows + leadHoursForType) and pass the
// resulting hours in here.

import type { UserTier } from "@/lib/domain/types";
import { studioStartOfDay } from "@/lib/time";

export interface VisibilityInput {
  status: "draft" | "published" | "cancelled";
  startsAt: Date;
  /** starts_at − memberLeadHours, stamped once at creation/generation time. */
  membersVisibleAt: Date | null;
  /** starts_at − guestLeadHours, stamped once at creation/generation time. */
  publicVisibleAt: Date | null;
}

/**
 * A visible-at instant: `startsAt − leadHours`, THEN floored to Bangkok 00:00 of
 * that day. Visibility opens on DAY boundaries, not at the exact hour-of-day the
 * class happens to start — e.g. a Wednesday 18:00 class with a 1-day guest window
 * opens Tuesday 00:00 Bangkok (not Tuesday 18:00), so "1 day ahead" reads the way
 * an owner/customer actually expects ("visible starting midnight"), regardless of
 * what time the class starts. Flooring only ever moves the instant EARLIER (or
 * leaves it unchanged if it already lands exactly on midnight) — it can never
 * newly hide something that would otherwise be visible, only ever reveal it
 * sooner, which is the safe direction for this invariant.
 *
 * The ONE pure conversion, called twice per instance (once per tier) by the async
 * call sites that resolve `leadHours` from the owner-configurable visibility-window
 * map.
 */
export function computeVisibleAt(startsAt: Date, leadHours: number): Date {
  const raw = new Date(startsAt.getTime() - leadHours * 3_600_000);
  return studioStartOfDay(raw);
}

/**
 * Thin named wrapper kept for callers that only ever computed the GUEST-side
 * timestamp under the old name. Prefer `computeVisibleAt` in new code — the
 * old 3-arg signature with a hardcoded default lead-hours param is gone since
 * the constant is no longer the source of truth (lead hours are now resolved
 * from `visibility_windows` per call site).
 */
export function computePublicVisibleAt(startsAt: Date, leadHours: number): Date {
  return computeVisibleAt(startsAt, leadHours);
}

/**
 * Can `viewer` book this instance right now? Mirrors the SQL booking filter:
 *   status='published' AND starts_at > now
 *   AND now >= (tier='member' ? members_visible_at : public_visible_at)
 *
 * Symmetric across tiers: a member is no longer unconditionally `true` — they
 * are gated by their OWN (typically much larger) window, exactly the same
 * shape as a guest's gate. `membersVisibleAt` is REQUIRED alongside
 * `publicVisibleAt` (VisibilityInput), but see the backward-compatibility note
 * below for why every pre-existing row still passes for members with no
 * backfill needed.
 *
 * BACKWARD COMPATIBILITY (no backfill required): every row created before this
 * change had `members_visible_at` stamped `= now` AT CREATION TIME (a pure
 * audit stamp, never read as a gate) — so by the time any query runs,
 * `now >= membersVisibleAt` is trivially true for every such row regardless of
 * this new logic. Only instances created/generated AFTER this ships get the
 * real `starts_at − memberLeadHours` computation. See
 * tests/visibility.test.ts for a regression pinning this.
 */
export function isBookableForViewer(
  instance: VisibilityInput,
  viewer: { tier: UserTier },
  now: Date,
): boolean {
  if (instance.status !== "published") return false;
  if (instance.startsAt.getTime() <= now.getTime()) return false;

  const visibleAt = viewer.tier === "member" ? instance.membersVisibleAt : instance.publicVisibleAt;
  return visibleAt !== null && now.getTime() >= visibleAt.getTime();
}
