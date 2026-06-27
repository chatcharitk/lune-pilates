// No-DB fallback + pure helpers for the schedule read models. These run without
// DATABASE_URL so they exercise the mock path the UI renders against.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getClassDetail,
  listBookableClasses,
  positionsForCapacity,
} from "@/lib/schedule/queries";
import { packageCategoryForClassType } from "@/lib/credits/selectPackage";
import { CAPACITY } from "@/lib/domain/types";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  // Force the no-DB mock path regardless of the dev environment.
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

describe("positionsForCapacity", () => {
  it("maps capacity to physical reformer positions", () => {
    expect(positionsForCapacity(1)).toEqual(["middle"]);
    expect(positionsForCapacity(2)).toEqual(["left", "right"]);
    expect(positionsForCapacity(3)).toEqual(["left", "middle", "right"]);
  });
});

describe("packageCategoryForClassType", () => {
  it("routes class types to the settling package category", () => {
    expect(packageCategoryForClassType("group")).toBe("group");
    expect(packageCategoryForClassType("rental")).toBe("rental");
    expect(packageCategoryForClassType("private")).toBe("private");
    expect(packageCategoryForClassType("duo")).toBe("private");
    expect(packageCategoryForClassType("trio")).toBe("private");
  });
});

describe("listBookableClasses (no-DB mock)", () => {
  const weekStart = new Date("2026-06-01T00:00:00+07:00"); // Monday

  it("returns the mock week sorted by start time, enriched and capped", async () => {
    const list = await listBookableClasses({ viewer: { tier: "member" }, weekStart });
    expect(list.length).toBeGreaterThan(0);

    // sorted ascending by ISO start
    const sorted = [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(list).toEqual(sorted);

    // every row carries bilingual display metadata + a consistent capacity
    for (const c of list) {
      expect(c.typeMeta.label.en).toBeTruthy();
      expect(c.typeMeta.label.th).toBeTruthy();
      expect(c.capacity).toBe(CAPACITY[c.type]);
      expect(c.seatsLeft).toBe(Math.max(0, c.capacity - c.booked));
      expect(c.full).toBe(c.seatsLeft <= 0);
    }
  });

  it("flags full classes correctly (s4 is a full group of 3)", async () => {
    const list = await listBookableClasses({ viewer: { tier: "guest" }, weekStart });
    const s4 = list.find((c) => c.id === "s4");
    expect(s4).toBeDefined();
    expect(s4?.full).toBe(true);
    expect(s4?.seatsLeft).toBe(0);
  });
});

describe("getClassDetail (no-DB mock)", () => {
  it("returns per-position availability with the first N taken", async () => {
    // s5 is a group (cap 3) with 2 booked → left+middle taken, right open.
    const detail = await getClassDetail("s5", { tier: "member" });
    expect(detail).not.toBeNull();
    expect(detail?.capacity).toBe(3);
    expect(detail?.positions).toEqual([
      { position: "left", taken: true },
      { position: "middle", taken: true },
      { position: "right", taken: false },
    ]);
    expect(detail?.seatsLeft).toBe(1);
  });

  it("models a private (cap 1) as a single middle position", async () => {
    const detail = await getClassDetail("s3", { tier: "member" });
    expect(detail?.capacity).toBe(1);
    expect(detail?.positions).toEqual([{ position: "middle", taken: false }]);
  });
});
