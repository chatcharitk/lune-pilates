// Unit tests for the pure waitlist shaping helpers — the lazy-expiry rule
// (`effectiveWaitlistStatus`) and the read-model shaper (`toMyWaitlistEntry`).
// These are I/O-free, so they run without DATABASE_URL (CLAUDE.md §5 invariant 6:
// the read model must never surface a stale live offer; occupancy is untouched).

import { describe, expect, it } from "vitest";
import {
  effectiveWaitlistStatus,
  toMyWaitlistEntry,
  type WaitlistRow,
} from "@/lib/waitlist/queries";

const NOW = new Date("2026-06-19T10:00:00+07:00");

function baseRow(overrides: Partial<WaitlistRow> = {}): WaitlistRow {
  return {
    waitlistId: "wx",
    classInstanceId: "cx",
    type: "group",
    startsAt: new Date("2026-06-19T18:00:00+07:00"),
    durationMin: 60,
    instructorId: null,
    instructorName: null,
    instructorNameTh: null,
    instructorTag: null,
    position: 1,
    status: "waiting",
    holdExpiresAt: null,
    ...overrides,
  };
}

describe("effectiveWaitlistStatus (lazy expiry)", () => {
  it("leaves a waiting row as waiting", () => {
    expect(effectiveWaitlistStatus("waiting", null, NOW)).toBe("waiting");
  });

  it("keeps an offer live while the hold is in the future", () => {
    const hold = new Date(NOW.getTime() + 5 * 60_000); // +5 min
    expect(effectiveWaitlistStatus("offered", hold, NOW)).toBe("offered");
  });

  it("treats an offer past its hold as expired (lazy)", () => {
    const hold = new Date(NOW.getTime() - 1_000); // 1s ago
    expect(effectiveWaitlistStatus("offered", hold, NOW)).toBe("expired");
  });

  it("treats an offer exactly AT the hold deadline as expired (boundary)", () => {
    // hold_expires_at <= now ⇒ expired; the deadline instant is no longer live.
    expect(effectiveWaitlistStatus("offered", NOW, NOW)).toBe("expired");
  });

  it("an offered row with no hold is treated as expired (fail closed)", () => {
    // A null hold on an offered row is a malformed/edge state — never show it as a
    // live offer the customer can count down on (matches confirmWaitlistOffer).
    expect(effectiveWaitlistStatus("offered", null, NOW)).toBe("expired");
  });

  it("passes claimed / expired through unchanged", () => {
    expect(effectiveWaitlistStatus("claimed", null, NOW)).toBe("claimed");
    expect(effectiveWaitlistStatus("expired", null, NOW)).toBe("expired");
  });
});

describe("toMyWaitlistEntry (pure shaping)", () => {
  it("shapes a plain waiting entry with bilingual type meta and no hold", () => {
    const e = toMyWaitlistEntry(baseRow({ position: 3 }), NOW);
    expect(e.status).toBe("waiting");
    expect(e.position).toBe(3);
    expect(e.holdExpiresAt).toBeNull();
    expect(e.typeMeta.label.en).toBe("Reformer Group");
    expect(e.startsAt).toBe(new Date("2026-06-19T18:00:00+07:00").toISOString());
  });

  it("surfaces holdExpiresAt (ISO) for a live offer", () => {
    const hold = new Date(NOW.getTime() + 20 * 60_000);
    const e = toMyWaitlistEntry(baseRow({ status: "offered", holdExpiresAt: hold }), NOW);
    expect(e.status).toBe("offered");
    expect(e.holdExpiresAt).toBe(hold.toISOString());
  });

  it("downgrades a stale offer to expired and drops its hold (no dead countdown)", () => {
    const hold = new Date(NOW.getTime() - 60_000);
    const e = toMyWaitlistEntry(baseRow({ status: "offered", holdExpiresAt: hold }), NOW);
    expect(e.status).toBe("expired");
    expect(e.holdExpiresAt).toBeNull();
  });

  it("carries bilingual instructor metadata through from a DB row", () => {
    const e = toMyWaitlistEntry(
      baseRow({
        type: "private",
        instructorId: "mai",
        instructorName: "Kru Mai",
        instructorNameTh: "ครูใหม่",
        instructorTag: "Founder",
      }),
      NOW,
    );
    expect(e.typeMeta.label.en).toBe("Private 1:1");
    expect(e.instructor?.name.en).toBe("Kru Mai");
    expect(e.instructor?.name.th).toBeTruthy();
  });

  it("leaves a null instructor as null", () => {
    const e = toMyWaitlistEntry(baseRow({ instructorId: null }), NOW);
    expect(e.instructor).toBeNull();
  });
});
