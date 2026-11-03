import { describe, expect, it } from "vitest";
import { BOOKING_CUTOFF_MINUTES, isPastBookingCutoff, isTooLateToSelfBook, isWithinAdminBackdate } from "@/lib/domain/types";

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

  it("only blocks the FIRST booking — a class someone is in stays bookable", () => {
    expect(isTooLateToSelfBook(start, 0, minutesBefore(10))).toBe(true);
    expect(isTooLateToSelfBook(start, 1, minutesBefore(10))).toBe(false);
    expect(isTooLateToSelfBook(start, 0, minutesBefore(45))).toBe(false);
  });
});

describe("isWithinAdminBackdate (front-desk backdating, 2026-11-03)", () => {
  const now = new Date("2026-11-03T12:30:00Z");
  it("allows a class that started earlier today or within the last 7 days", () => {
    expect(isWithinAdminBackdate(new Date("2026-11-03T11:00:00Z"), now)).toBe(true);
    expect(isWithinAdminBackdate(new Date("2026-10-27T13:00:00Z"), now)).toBe(true);
  });
  it("refuses anything older than 7 days", () => {
    expect(isWithinAdminBackdate(new Date("2026-10-27T12:00:00Z"), now)).toBe(false);
  });
});
