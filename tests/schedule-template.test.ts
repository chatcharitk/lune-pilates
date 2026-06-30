// No-DB unit tests for the EDITABLE schedule template:
//   - getScheduleTemplate / getTemplateSlotsByDow mock shapes (mirror BASELINE_SLOTS);
//   - createTemplateSlot / updateTemplateSlot / deleteTemplateSlot input validation
//     (bad time / capacity-over-cap / out-of-range dayOfWeek → INVALID_INPUT);
//   - the requireOwner() gate runs FIRST (under ADMIN_AUTH=deny → UNAUTHORIZED,
//     before validation and before the no-DB success branch).
//
// The DATABASE_URL-dependent guarantees (a created slot appears in getScheduleTemplate,
// generateWeekFromBaseline materialises from the DB template, soft delete drops from
// the active list) live in tests/integration/schedule-template.integration.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASELINE_SLOTS } from "@/lib/schedule/baseline";
import { getScheduleTemplate, getTemplateSlotsByDow } from "@/lib/admin/schedule-template";
import {
  createTemplateSlot,
  deleteTemplateSlot,
  updateTemplateSlot,
} from "@/app/actions/schedule";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

function restoreEnv() {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
}

describe("getScheduleTemplate / getTemplateSlotsByDow (no-DB mock mirrors BASELINE_SLOTS)", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL; // force the no-DB mock path
    delete process.env.ADMIN_AUTH;
  });
  afterEach(restoreEnv);

  it("getScheduleTemplate returns one enriched slot per BASELINE_SLOT, sorted by dow then time", async () => {
    const tpl = await getScheduleTemplate();
    expect(tpl.length).toBe(BASELINE_SLOTS.length); // 28
    expect(tpl.every((s) => s.type === "group")).toBe(true);
    // Enriched shape: typeMeta + instructor present (null instructor on baseline).
    for (const s of tpl) {
      expect(s.id).toBeTruthy();
      expect(s.typeMeta.type).toBe(s.type);
      expect(s.instructor).toBeNull();
      expect(s.capacity).toBe(3); // group hard cap
    }
    // Sorted by dayOfWeek then time.
    const sorted = [...tpl].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time),
    );
    expect(tpl).toEqual(sorted);
  });

  it("getTemplateSlotsByDow groups the baseline fallback by ISO weekday (templateId null)", async () => {
    const map = await getTemplateSlotsByDow();
    // 7 weekdays present, 4 group slots each (matching the baseline).
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    let total = 0;
    for (const [, slots] of map) {
      total += slots.length;
      for (const s of slots) {
        expect(s.templateId).toBeNull(); // fallback carries no template id
        expect(s.type).toBe("group");
      }
    }
    expect(total).toBe(BASELINE_SLOTS.length);
  });
});

describe("template CRUD validation (no-DB, owner allowed by default)", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.ADMIN_AUTH; // mock owner = allow
  });
  afterEach(restoreEnv);

  it("createTemplateSlot accepts a valid slot (no-DB ok)", async () => {
    const res = await createTemplateSlot({
      dayOfWeek: 2,
      time: "10:00",
      type: "duo",
      durationMin: 50,
      capacity: 2,
    });
    expect(res.ok).toBe(true);
  });

  it("createTemplateSlot rejects a bad time → INVALID_INPUT", async () => {
    const res = await createTemplateSlot({
      dayOfWeek: 1,
      time: "25:99",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("createTemplateSlot rejects capacity over the type's hard cap → INVALID_INPUT", async () => {
    // Duo hard cap is 2; 3 is over.
    const res = await createTemplateSlot({
      dayOfWeek: 1,
      time: "10:00",
      type: "duo",
      durationMin: 50,
      capacity: 3,
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("createTemplateSlot rejects an out-of-range dayOfWeek → INVALID_INPUT", async () => {
    const res = await createTemplateSlot({
      dayOfWeek: 8,
      time: "10:00",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("createTemplateSlot rejects a non-positive duration → INVALID_INPUT", async () => {
    const res = await createTemplateSlot({
      dayOfWeek: 1,
      time: "10:00",
      type: "group",
      durationMin: 0,
      capacity: 3,
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("updateTemplateSlot rejects capacity over cap → INVALID_INPUT", async () => {
    const res = await updateTemplateSlot({
      id: "00000000-0000-4000-a000-000000000001",
      time: "10:00",
      type: "private",
      durationMin: 50,
      capacity: 2, // private cap is 1
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("updateTemplateSlot accepts a valid edit (no-DB ok)", async () => {
    const res = await updateTemplateSlot({
      id: "00000000-0000-4000-a000-000000000001",
      time: "11:00",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(res).toEqual({ ok: true });
  });

  it("deleteTemplateSlot rejects a non-uuid id → INVALID_INPUT", async () => {
    const res = await deleteTemplateSlot({ id: "not-a-uuid" });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("deleteTemplateSlot accepts a valid uuid (no-DB ok)", async () => {
    const res = await deleteTemplateSlot({ id: "00000000-0000-4000-a000-000000000001" });
    expect(res).toEqual({ ok: true });
  });
});

describe("template CRUD owner-gate runs first (ADMIN_AUTH=deny → UNAUTHORIZED before validation)", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    process.env.ADMIN_AUTH = "deny";
  });
  afterEach(restoreEnv);

  it("createTemplateSlot → UNAUTHORIZED even with malformed input", async () => {
    const res = await createTemplateSlot({
      dayOfWeek: 0,
      time: "bad",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("updateTemplateSlot → UNAUTHORIZED even with malformed input", async () => {
    const res = await updateTemplateSlot({
      id: "bad",
      time: "bad",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("deleteTemplateSlot → UNAUTHORIZED even with malformed input", async () => {
    const res = await deleteTemplateSlot({ id: "not-a-uuid" });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});
