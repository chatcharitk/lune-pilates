// No-DB unit tests for app/actions/admin-visibility.ts — the owner-configurable
// tiered-visibility (CLAUDE.md §5 invariant 4) settings actions.
//
// Mirrors tests/admin-catalog.test.ts's conventions: DATABASE_URL is unset to force
// the mock branch, ADMIN_ROLE toggles the owner gate. A valid write in mock mode
// reaches MOCK_NO_DB (never a fake ok:true) — see MockNoDbCode. The DB-backed
// behaviour lives in tests/integration/visibility-windows.integration.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listVisibilityWindows,
  updateVisibilityWindow,
  type UpdateVisibilityWindowInput,
} from "@/app/actions/admin-visibility";
import { SEED_VISIBILITY_WINDOWS, leadHoursFor } from "@/lib/schedule/visibilityWindows";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;
const ORIGINAL_ADMIN_ROLE = process.env.ADMIN_ROLE;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB path
  delete process.env.ADMIN_AUTH; // default mock provider
  delete process.env.ADMIN_ROLE; // ... whose default role is owner
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
  if (ORIGINAL_ADMIN_ROLE === undefined) delete process.env.ADMIN_ROLE;
  else process.env.ADMIN_ROLE = ORIGINAL_ADMIN_ROLE;
});

const VALID_UPDATE: UpdateVisibilityWindowInput = {
  type: "group",
  memberAmount: 2,
  memberUnit: "month",
  guestAmount: 2,
  guestUnit: "day",
};

// ───────────────────────── the auth gate ─────────────────────────

describe("owner-only gate (line 1 of every action)", () => {
  beforeEach(() => {
    process.env.ADMIN_ROLE = "instructor"; // signed in, but NOT the owner
  });

  it("rejects an instructor from every visibility-window action", async () => {
    expect(await listVisibilityWindows()).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await updateVisibilityWindow(VALID_UPDATE)).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
  });

  it("gates BEFORE input parsing: a garbage payload from a non-owner reads UNAUTHORIZED", async () => {
    const res = await updateVisibilityWindow({
      ...VALID_UPDATE,
      memberAmount: -1,
      memberUnit: "century" as never,
    });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});

// ───────────────────────── read ─────────────────────────

describe("listVisibilityWindows", () => {
  it("returns all 5 class types with the seed values (no DB)", async () => {
    const res = await listVisibilityWindows();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.windows.map((w) => w.type)).toEqual(["group", "private", "duo", "trio", "rental"]);
    for (const w of res.windows) {
      const seed = SEED_VISIBILITY_WINDOWS[w.type];
      expect(w.memberAmount).toBe(seed.memberAmount);
      expect(w.memberUnit).toBe(seed.memberUnit);
      expect(w.guestAmount).toBe(seed.guestAmount);
      expect(w.guestUnit).toBe(seed.guestUnit);
    }
  });

  it("the seed's guest side matches today's exact hardcoded lead times (24h non-rental, 336h rental)", () => {
    expect(leadHoursFor(SEED_VISIBILITY_WINDOWS.group.guestAmount, SEED_VISIBILITY_WINDOWS.group.guestUnit)).toBe(24);
    expect(leadHoursFor(SEED_VISIBILITY_WINDOWS.private.guestAmount, SEED_VISIBILITY_WINDOWS.private.guestUnit)).toBe(24);
    expect(leadHoursFor(SEED_VISIBILITY_WINDOWS.duo.guestAmount, SEED_VISIBILITY_WINDOWS.duo.guestUnit)).toBe(24);
    expect(leadHoursFor(SEED_VISIBILITY_WINDOWS.trio.guestAmount, SEED_VISIBILITY_WINDOWS.trio.guestUnit)).toBe(24);
    expect(leadHoursFor(SEED_VISIBILITY_WINDOWS.rental.guestAmount, SEED_VISIBILITY_WINDOWS.rental.guestUnit)).toBe(336);
  });

  it("the seed's member side is deliberately generous (3 months) so no class hides on deploy day", () => {
    for (const type of ["group", "private", "duo", "trio", "rental"] as const) {
      const seed = SEED_VISIBILITY_WINDOWS[type];
      expect(leadHoursFor(seed.memberAmount, seed.memberUnit)).toBe(2160); // 3 × 720h
    }
  });
});

// ───────────────────────── update: validation ─────────────────────────

describe("updateVisibilityWindow — validation", () => {
  it("accepts a valid input (reaches the write → MOCK_NO_DB, not INVALID_INPUT)", async () => {
    expect(await updateVisibilityWindow(VALID_UPDATE)).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });

  it("rejects an unknown class type", async () => {
    const res = await updateVisibilityWindow({ ...VALID_UPDATE, type: "bogus" as never });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("rejects an unknown unit", async () => {
    const res = await updateVisibilityWindow({ ...VALID_UPDATE, guestUnit: "year" as never });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("rejects zero or negative amounts", async () => {
    for (const memberAmount of [0, -1, -10]) {
      expect(await updateVisibilityWindow({ ...VALID_UPDATE, memberAmount })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
    for (const guestAmount of [0, -1]) {
      expect(await updateVisibilityWindow({ ...VALID_UPDATE, guestAmount })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
  });

  it("rejects fractional amounts (whole integers only)", async () => {
    expect(await updateVisibilityWindow({ ...VALID_UPDATE, memberAmount: 1.5 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("rejects an absurdly large amount", async () => {
    expect(await updateVisibilityWindow({ ...VALID_UPDATE, guestAmount: 10_000 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("accepts every class type", async () => {
    for (const type of ["group", "private", "duo", "trio", "rental"] as const) {
      expect(await updateVisibilityWindow({ ...VALID_UPDATE, type })).toEqual({
        ok: false,
        code: "MOCK_NO_DB",
      });
    }
  });

  it("accepts every unit (day/week/month) on both sides", async () => {
    for (const memberUnit of ["day", "week", "month"] as const) {
      expect(await updateVisibilityWindow({ ...VALID_UPDATE, memberUnit })).toEqual({
        ok: false,
        code: "MOCK_NO_DB",
      });
    }
    for (const guestUnit of ["day", "week", "month"] as const) {
      expect(await updateVisibilityWindow({ ...VALID_UPDATE, guestUnit })).toEqual({
        ok: false,
        code: "MOCK_NO_DB",
      });
    }
  });
});
