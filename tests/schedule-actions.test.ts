// No-DB unit tests for the born-published schedule actions (the draft→publish
// ceremony was removed — owner request "remove เผยแพร่สัปดาห์"):
//
//   - createClass goes LIVE immediately and emits exactly ONE `schedule.published`
//     event per created class, carrying the Bangkok Monday of the class's week
//     (same payload shape as publishWeek's).
//   - generateWeekFromBaseline emits NO event when nothing was created (the no-DB
//     path returns created: 0 — the ≥1-created emission is pinned against a real
//     Postgres in tests/integration/schedule-template.integration.test.ts).
//   - publishWeek stays exported and working as the cleanup path for pre-existing
//     drafts (auth-gate ordering pinned in tests/admin-auth.test.ts); its no-DB
//     path publishes 0 and emits nothing.
//
// The DB-side guarantee — created/generated instances are `published` with all
// three stamps (published_at = members_visible_at = now, public_visible_at =
// computePublicVisibleAt) — lives in the integration suite.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClass, generateWeekFromBaseline, publishWeek } from "@/app/actions/schedule";
import { on } from "@/lib/events/bus";
import type { DomainEvent } from "@/lib/events/types";
import { startOfWeekMonday } from "@/lib/schedule/baseline";
import { studioDayFromYmd } from "@/lib/time";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;
const ORIGINAL_ADMIN_ROLE = process.env.ADMIN_ROLE;

function restoreEnv() {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
  if (ORIGINAL_ADMIN_ROLE === undefined) delete process.env.ADMIN_ROLE;
  else process.env.ADMIN_ROLE = ORIGINAL_ADMIN_ROLE;
}

describe("born-published schedule actions (no-DB) — schedule.published emission", () => {
  let seen: Extract<DomainEvent, { type: "schedule.published" }>[] = [];
  let off: () => void;

  beforeEach(() => {
    delete process.env.DATABASE_URL; // force the no-DB mock path
    delete process.env.ADMIN_AUTH; // mock owner = allow
    delete process.env.ADMIN_ROLE;
    seen = [];
    off = on("schedule.published", async (e) => {
      seen.push(e);
    });
  });
  afterEach(() => {
    off();
    restoreEnv();
  });

  it("createClass succeeds and emits exactly ONE schedule.published for the class's week", async () => {
    const res = await createClass({
      date: "2026-06-17", // a Wednesday → week of Mon 15 Jun (Bangkok)
      time: "10:00",
      type: "group",
      durationMin: 60,
      capacity: 3,
      instructorId: null,
    });
    expect(res.ok).toBe(true);
    expect(seen.length).toBe(1);
    const expectedWeekStart = startOfWeekMonday(studioDayFromYmd("2026-06-17")).toISOString();
    expect(seen[0]).toEqual({ type: "schedule.published", weekStart: expectedWeekStart });
  });

  it("createClass with invalid input emits NOTHING", async () => {
    const res = await createClass({
      date: "bad",
      time: "bad",
      type: "group",
      durationMin: 60,
      capacity: 3,
      instructorId: null,
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(seen.length).toBe(0);
  });

  it("generateWeekFromBaseline with 0 created emits NO event", async () => {
    const res = await generateWeekFromBaseline({ weekStart: "2026-06-15" });
    expect(res).toEqual({ ok: true, created: 0 }); // no-DB path creates nothing
    expect(seen.length).toBe(0);
  });

  it("publishWeek (kept as the pre-existing-drafts cleanup path) publishes 0 and emits NO event", async () => {
    const res = await publishWeek({ weekStart: "2026-06-15" });
    expect(res).toEqual({ ok: true, published: 0 });
    expect(seen.length).toBe(0);
  });
});
