import { describe, expect, it } from "vitest";
import { BOOKING_CUTOFF_MINUTES, isPastBookingCutoff } from "@/lib/domain/types";

describe("isPastBookingCutoff", () => {
  const start = new Date("2026-10-23T05:00:00Z"); // 12:00 Bangkok
  const minutesBefore = (m: number) => new Date(start.getTime() - m * 60_000);

  it("allows self-booking until 30 minutes before the start", () => {
    expect(BOOKING_CUTOFF_MINUTES).toBe(30);
    expect(isPastBookingCutoff(start, minutesBefore(31))).toBe(false);
    expect(isPastBookingCutoff(start, minutesBefore(30))).toBe(false);
  });

  it("stops it inside the last 30 minutes and after the start", () => {
    expect(isPastBookingCutoff(start, minutesBefore(29))).toBe(true);
    expect(isPastBookingCutoff(start, minutesBefore(1))).toBe(true);
    expect(isPastBookingCutoff(start, minutesBefore(-5))).toBe(true);
  });
});
