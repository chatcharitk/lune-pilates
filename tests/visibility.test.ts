import { describe, expect, it } from "vitest";
import { computePublicVisibleAt, isBookableForViewer } from "@/lib/schedule/visibility";

const NOW = new Date("2026-06-01T12:00:00Z");
const future = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("computePublicVisibleAt", () => {
  it("is starts_at − N hours (group default 24h)", () => {
    const starts = future(48);
    const pv = computePublicVisibleAt(starts, "group");
    expect(pv.getTime()).toBe(starts.getTime() - 24 * 3_600_000);
  });
});

describe("isBookableForViewer", () => {
  const member = { tier: "member" as const };
  const guest = { tier: "guest" as const };

  it("hides draft classes from everyone", () => {
    const inst = { status: "draft" as const, startsAt: future(48), publicVisibleAt: future(24) };
    expect(isBookableForViewer(inst, member, NOW)).toBe(false);
  });

  it("hides classes that already started", () => {
    const inst = { status: "published" as const, startsAt: future(-1), publicVisibleAt: future(-25) };
    expect(isBookableForViewer(inst, member, NOW)).toBe(false);
  });

  it("members see any published, future class immediately", () => {
    const inst = { status: "published" as const, startsAt: future(72), publicVisibleAt: future(48) };
    expect(isBookableForViewer(inst, member, NOW)).toBe(true);
  });

  it("guests cannot see a class before public_visible_at", () => {
    const inst = { status: "published" as const, startsAt: future(48), publicVisibleAt: future(24) };
    expect(isBookableForViewer(inst, guest, NOW)).toBe(false);
  });

  it("guests can see a class at/after public_visible_at", () => {
    const inst = { status: "published" as const, startsAt: future(20), publicVisibleAt: future(-4) };
    expect(isBookableForViewer(inst, guest, NOW)).toBe(true);
  });
});
