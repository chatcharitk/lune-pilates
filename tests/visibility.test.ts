import { describe, expect, it } from "vitest";
import { computeVisibleAt, isBookableForViewer } from "@/lib/schedule/visibility";
import { leadHoursFor } from "@/lib/schedule/visibilityWindows";

const NOW = new Date("2026-06-01T12:00:00Z");
const future = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("computeVisibleAt — day-scale (floored to Bangkok 00:00), not hour-scale", () => {
  it("starts_at − leadHours, floored to the START of that Bangkok day (not the exact hour)", () => {
    // starts = 2026-06-03T12:00:00Z. raw = starts − 24h = 2026-06-02T12:00:00Z, which
    // is 2026-06-02T19:00 Bangkok — floors to 2026-06-02T00:00 Bangkok, i.e.
    // 2026-06-01T17:00:00Z. NOT the raw hour-precise instant.
    const starts = future(48);
    const pv = computeVisibleAt(starts, 24);
    const rawHourPrecise = new Date(starts.getTime() - 24 * 3_600_000);
    expect(pv.getTime()).not.toBe(rawHourPrecise.getTime()); // day-floored, not hour-precise
    expect(pv.toISOString()).toBe("2026-06-01T17:00:00.000Z"); // Bangkok midnight (UTC+7)
    expect(pv.getTime()).toBeLessThanOrEqual(rawHourPrecise.getTime()); // floor only moves EARLIER
  });

  it("opens a rental ~14 days before start (2 weeks via leadHoursFor), floored to Bangkok midnight", () => {
    const starts = future(400);
    const pv = computeVisibleAt(starts, leadHoursFor(2, "week"));
    const rawHourPrecise = new Date(starts.getTime() - 336 * 3_600_000);
    // Floored to midnight — at most 24h earlier than the raw hour-precise instant,
    // and never later than it (the safe direction: reveal sooner, never hide later).
    expect(pv.getTime()).toBeLessThanOrEqual(rawHourPrecise.getTime());
    expect(rawHourPrecise.getTime() - pv.getTime()).toBeLessThan(24 * 3_600_000);
    // The result itself IS a Bangkok-midnight instant (00:00 Bangkok = 17:00 UTC).
    expect(pv.toISOString().endsWith("T17:00:00.000Z")).toBe(true);
  });

  it("a class whose raw cutoff already lands exactly on Bangkok midnight is unchanged by flooring", () => {
    // 2026-06-04T17:00:00Z = 2026-06-05T00:00 Bangkok exactly (verified: UTC+7).
    const starts = new Date("2026-06-04T17:00:00Z");
    const pv = computeVisibleAt(starts, 0);
    expect(pv.toISOString()).toBe("2026-06-04T17:00:00.000Z"); // no shift — already midnight
  });
});

describe("leadHoursFor (flat, fixed-ratio conversion — day=24, week=168, month=720)", () => {
  it("converts days", () => {
    expect(leadHoursFor(1, "day")).toBe(24);
    expect(leadHoursFor(45, "day")).toBe(45 * 24);
  });

  it("converts weeks", () => {
    expect(leadHoursFor(1, "week")).toBe(168);
    expect(leadHoursFor(2, "week")).toBe(336);
  });

  it("converts months as a flat 30-day month (720h), not calendar-exact", () => {
    expect(leadHoursFor(1, "month")).toBe(720);
    expect(leadHoursFor(3, "month")).toBe(2160);
  });
});

describe("isBookableForViewer", () => {
  const member = { tier: "member" as const };
  const guest = { tier: "guest" as const };

  it("hides draft classes from everyone", () => {
    const inst = {
      status: "draft" as const,
      startsAt: future(48),
      membersVisibleAt: future(0),
      publicVisibleAt: future(24),
    };
    expect(isBookableForViewer(inst, member, NOW)).toBe(false);
  });

  it("hides classes that already started", () => {
    const inst = {
      status: "published" as const,
      startsAt: future(-1),
      membersVisibleAt: future(-48),
      publicVisibleAt: future(-25),
    };
    expect(isBookableForViewer(inst, member, NOW)).toBe(false);
  });

  it("members are gated by their OWN window — not unconditionally true anymore", () => {
    const inst = {
      status: "published" as const,
      startsAt: future(72),
      membersVisibleAt: future(48), // still in the future ⇒ not yet visible to members
      publicVisibleAt: future(48),
    };
    expect(isBookableForViewer(inst, member, NOW)).toBe(false);
  });

  it("members see a published, future class once now >= members_visible_at", () => {
    const inst = {
      status: "published" as const,
      startsAt: future(72),
      membersVisibleAt: future(-1), // already passed
      publicVisibleAt: future(48),
    };
    expect(isBookableForViewer(inst, member, NOW)).toBe(true);
  });

  it("guests cannot see a class before public_visible_at (unaffected by the member gate)", () => {
    const inst = {
      status: "published" as const,
      startsAt: future(48),
      membersVisibleAt: future(-1),
      publicVisibleAt: future(24),
    };
    expect(isBookableForViewer(inst, guest, NOW)).toBe(false);
  });

  it("guests can see a class at/after public_visible_at", () => {
    const inst = {
      status: "published" as const,
      startsAt: future(20),
      membersVisibleAt: future(-1),
      publicVisibleAt: future(-4),
    };
    expect(isBookableForViewer(inst, guest, NOW)).toBe(true);
  });

  it("a guest can book a rental ~300h out (inside a 336h guest window) but not a group then; a member with a wide-open window sees both", () => {
    const starts = future(300);
    // Rental opens 336h before start ⇒ public_visible_at is in the past at 300h out.
    const rental = {
      status: "published" as const,
      startsAt: starts,
      membersVisibleAt: computeVisibleAt(starts, leadHoursFor(3, "month")),
      publicVisibleAt: computeVisibleAt(starts, leadHoursFor(2, "week")),
    };
    expect(isBookableForViewer(rental, guest, NOW)).toBe(true);
    // A group at the same start only opens 24h before for guests ⇒ still hidden at 300h out.
    const group = {
      status: "published" as const,
      startsAt: starts,
      membersVisibleAt: computeVisibleAt(starts, leadHoursFor(3, "month")),
      publicVisibleAt: computeVisibleAt(starts, leadHoursFor(1, "day")),
    };
    expect(isBookableForViewer(group, guest, NOW)).toBe(false);
    // ...but a member with a wide-open (e.g. 3-month) window sees both immediately.
    expect(isBookableForViewer(group, member, NOW)).toBe(true);
    expect(isBookableForViewer(rental, member, NOW)).toBe(true);
  });

  it("BACKWARD COMPATIBILITY: an old-style row (members_visible_at stamped = creation time, unrelated to starts_at) still passes for a member", () => {
    // Pre-this-change rows always stamped members_visible_at = now AT CREATION TIME
    // (a pure audit stamp), never starts_at − leadHours. By the time any query runs,
    // that creation instant is always in the past, so `now >= membersVisibleAt` holds
    // for every such row regardless of the new per-tier gate — no backfill needed.
    const creationInstant = new Date(NOW.getTime() - 90 * 24 * 3_600_000); // 90 days ago
    const inst = {
      status: "published" as const,
      startsAt: future(48), // far in the future — unrelated to membersVisibleAt
      membersVisibleAt: creationInstant,
      publicVisibleAt: future(24),
    };
    expect(isBookableForViewer(inst, member, NOW)).toBe(true);
  });

  it("a null membersVisibleAt (should never happen post-migration) fails closed for members", () => {
    const inst = {
      status: "published" as const,
      startsAt: future(48),
      membersVisibleAt: null,
      publicVisibleAt: future(-1),
    };
    expect(isBookableForViewer(inst, member, NOW)).toBe(false);
  });
});
