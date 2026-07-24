// DB-backed integration tests for the owner-configurable tiered-visibility windows
// (app/actions/admin-visibility.ts, lib/schedule/visibilityWindows.ts,
// CLAUDE.md §5 invariant 4).
//
// What only a real Postgres can prove:
//   1. updateVisibilityWindow persists an upsert; listVisibilityWindows reads it back.
//   2. Changing a window changes what a subsequently-CREATED class stamps for
//      members_visible_at / public_visible_at (createClass resolves the map fresh
//      on every call).
//   3. An EXISTING/older instance's stamped visibility is UNAFFECTED by a later
//      settings change — the timestamps are frozen at creation time, not
//      recomputed live. This is a DELIBERATE parallel to how charge-terms
//      snapshots freeze a purchase's terms at charge-creation time (never
//      retroactively altered by a later catalog edit). Flagging this choice
//      explicitly: LIVE recomputation (looking up the window at READ time instead
//      of stamping it at CREATE time) would let the owner retroactively hide/reveal
//      already-scheduled classes, which could confuse a customer who already saw
//      (or already booked) the class under its original window — and it would
//      require a query-time join/lookup on every read instead of a plain column
//      compare. Freezing at creation keeps the read path cheap and matches the
//      spec's "per-week edits never retroactively change published classes"
//      spirit (invariant 5). If the owner ever wants "tighten it and hide
//      everything already-scheduled too," that would need a NEW explicit
//      "re-stamp existing instances" action — not implicit at settings-save time.
//
// Gated on DATABASE_URL; skips cleanly without it. Restores the pre-test
// visibility_windows rows for "group" and "rental" in afterAll so this run never
// leaves the shared dev DB in a different state than it found it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// The action DB paths call revalidatePath, which throws outside a Next request scope.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

import { getDb, closeDb } from "@/lib/db/client";
import { classInstances, visibilityWindows } from "@/lib/db/schema";
import { createClass } from "@/app/actions/schedule";
import { listVisibilityWindows, updateVisibilityWindow } from "@/app/actions/admin-visibility";
import { computeVisibleAt } from "@/lib/schedule/visibility";
import { leadHoursFor } from "@/lib/schedule/visibilityWindows";
import { on } from "@/lib/events/bus";
import { studioParts } from "@/lib/time";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("visibility windows (integration · requires DATABASE_URL)", () => {
  const createdInstanceIds: string[] = [];
  let originalGroupRow: typeof visibilityWindows.$inferSelect | undefined;

  beforeAll(async () => {
    delete process.env.ADMIN_AUTH; // mock admin provider, default role = owner
    delete process.env.ADMIN_ROLE;

    const db = getDb();
    [originalGroupRow] = await db
      .select()
      .from(visibilityWindows)
      .where(eq(visibilityWindows.type, "group"));
  });

  afterAll(async () => {
    try {
      const db = getDb();
      if (createdInstanceIds.length) {
        for (const id of createdInstanceIds) {
          await db.delete(classInstances).where(eq(classInstances.id, id));
        }
      }
      // Restore (or remove) the "group" row to whatever it was before this suite ran.
      if (originalGroupRow) {
        await db
          .update(visibilityWindows)
          .set({
            memberAmount: originalGroupRow.memberAmount,
            memberUnit: originalGroupRow.memberUnit,
            guestAmount: originalGroupRow.guestAmount,
            guestUnit: originalGroupRow.guestUnit,
          })
          .where(eq(visibilityWindows.type, "group"));
      } else {
        await db.delete(visibilityWindows).where(eq(visibilityWindows.type, "group"));
      }
    } finally {
      await closeDb();
    }
  });

  it("updateVisibilityWindow persists an upsert; listVisibilityWindows reads it back", async () => {
    const res = await updateVisibilityWindow({
      type: "group",
      memberAmount: 6,
      memberUnit: "month",
      guestAmount: 3,
      guestUnit: "day",
    });
    expect(res).toEqual({
      ok: true,
      window: { type: "group", memberAmount: 6, memberUnit: "month", guestAmount: 3, guestUnit: "day" },
    });

    const listed = await listVisibilityWindows();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const group = listed.windows.find((w) => w.type === "group");
    expect(group).toEqual({
      type: "group",
      memberAmount: 6,
      memberUnit: "month",
      guestAmount: 3,
      guestUnit: "day",
    });

    // A second upsert overwrites cleanly (no duplicate row / conflict error).
    const res2 = await updateVisibilityWindow({
      type: "group",
      memberAmount: 2,
      memberUnit: "week",
      guestAmount: 12,
      guestUnit: "day",
    });
    expect(res2.ok).toBe(true);
    const [row] = await getDb().select().from(visibilityWindows).where(eq(visibilityWindows.type, "group"));
    expect(row?.memberAmount).toBe(2);
    expect(row?.memberUnit).toBe("week");
    expect(row?.guestAmount).toBe(12);
    expect(row?.guestUnit).toBe("day");
  });

  it("a settings change alters what a SUBSEQUENTLY-created class stamps, but never an already-scheduled one", async () => {
    // Far-future, off-baseline time so nothing else collides with it.
    const future = new Date(Date.now() + 60 * 24 * 3_600_000); // ~60 days out
    const p = studioParts(future);
    const ymd = `${p.year}-${String(p.month0 + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

    // 1) Set an initial, distinctive window and create a class under it.
    await updateVisibilityWindow({
      type: "group",
      memberAmount: 5,
      memberUnit: "day",
      guestAmount: 6,
      guestUnit: "day",
    });

    const off1 = on("schedule.published", async () => {});
    let firstStartsAt: Date;
    {
      const res = await createClass({
        date: ymd,
        time: "07:07",
        type: "group",
        durationMin: 60,
        capacity: 3,
        instructorId: null,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("createClass failed");
      createdInstanceIds.push(res.id);
      const [inst] = await getDb()
        .select({
          startsAt: classInstances.startsAt,
          membersVisibleAt: classInstances.membersVisibleAt,
          publicVisibleAt: classInstances.publicVisibleAt,
        })
        .from(classInstances)
        .where(eq(classInstances.id, res.id));
      expect(inst).toBeTruthy();
      firstStartsAt = inst!.startsAt;
      expect(inst!.membersVisibleAt!.getTime()).toBe(
        computeVisibleAt(firstStartsAt, leadHoursFor(5, "day")).getTime(),
      );
      expect(inst!.publicVisibleAt!.getTime()).toBe(
        computeVisibleAt(firstStartsAt, leadHoursFor(6, "day")).getTime(),
      );

      // 2) NOW change the window to something very different.
      await updateVisibilityWindow({
        type: "group",
        memberAmount: 1,
        memberUnit: "month",
        guestAmount: 1,
        guestUnit: "week",
      });

      // The FIRST (already-created) instance's stamped timestamps are UNCHANGED —
      // frozen at creation time, not recomputed live (the deliberate design choice
      // documented at the top of this file).
      const [instAfter] = await getDb()
        .select({
          membersVisibleAt: classInstances.membersVisibleAt,
          publicVisibleAt: classInstances.publicVisibleAt,
        })
        .from(classInstances)
        .where(eq(classInstances.id, res.id));
      expect(instAfter!.membersVisibleAt!.getTime()).toBe(
        computeVisibleAt(firstStartsAt, leadHoursFor(5, "day")).getTime(),
      );
      expect(instAfter!.publicVisibleAt!.getTime()).toBe(
        computeVisibleAt(firstStartsAt, leadHoursFor(6, "day")).getTime(),
      );
    }
    off1();

    // 3) A SECOND class created AFTER the settings change picks up the NEW window.
    const off2 = on("schedule.published", async () => {});
    try {
      const res2 = await createClass({
        date: ymd,
        time: "07:47",
        type: "group",
        durationMin: 60,
        capacity: 3,
        instructorId: null,
      });
      expect(res2.ok).toBe(true);
      if (!res2.ok) throw new Error("createClass failed");
      createdInstanceIds.push(res2.id);

      const [inst2] = await getDb()
        .select({
          startsAt: classInstances.startsAt,
          membersVisibleAt: classInstances.membersVisibleAt,
          publicVisibleAt: classInstances.publicVisibleAt,
        })
        .from(classInstances)
        .where(eq(classInstances.id, res2.id));
      expect(inst2).toBeTruthy();
      expect(inst2!.membersVisibleAt!.getTime()).toBe(
        computeVisibleAt(inst2!.startsAt, leadHoursFor(1, "month")).getTime(),
      );
      expect(inst2!.publicVisibleAt!.getTime()).toBe(
        computeVisibleAt(inst2!.startsAt, leadHoursFor(1, "week")).getTime(),
      );
    } finally {
      off2();
    }
  });
});
