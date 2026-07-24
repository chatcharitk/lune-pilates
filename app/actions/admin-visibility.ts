"use server";

// Owner-only admin actions for the tiered-visibility settings screen (CLAUDE.md §5
// invariant 4): lets the studio owner set, PER CLASS TYPE and PER CUSTOMER TIER, how
// far before a class starts it becomes visible/bookable — replacing the hardcoded
// DEFAULT_PUBLIC_LEAD_HOURS constant (which was guest-only; members had no gate at
// all). Backed by the `visibility_windows` table (lib/db/schema.ts), one row per
// class type, with lib/schedule/visibilityWindows.ts's SEED_VISIBILITY_WINDOWS as the
// seed + empty-table/no-DB fallback.
//
// Follows the exact conventions of app/actions/admin-catalog.ts (read that file for
// the house style this mirrors):
//   - every action's line 1 is `requireOwner()`, BEFORE input parsing and before the
//     no-DB branch, so an unauthorised caller always reads UNAUTHORIZED — never
//     INVALID_INPUT (which would leak schema validity) or MOCK_NO_DB (which would
//     leak deploy-mode information).
//   - MOCK_NO_DB: in `mockDataMode()` a validated write has nowhere to persist, so it
//     is reported as a FAILURE (never a fake ok:true) — the UI should show "demo
//     mode — not saved", not a success toast.
//   - amounts are positive whole integers, units are the closed day/week/month enum
//     — never trust a client-supplied lead-hours number (CLAUDE.md §8).
//
// A class instance's `members_visible_at` / `public_visible_at` are stamped ONCE at
// creation/generation time (app/actions/schedule.ts), not recomputed live — so an
// edit here changes what gets stamped on NEWLY created/generated classes only, and
// deliberately does NOT retroactively alter already-scheduled classes (mirrors how
// charge-terms snapshots freeze a purchase's terms at charge-creation time).

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { visibilityWindows } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import {
  loadVisibilityWindows,
  type VisibilityUnit,
  type VisibilityWindow,
} from "@/lib/schedule/visibilityWindows";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── shared validation ─────────────────────────

const CLASS_TYPE = z.enum(["group", "private", "duo", "trio", "rental"]);
const UNIT = z.enum(["day", "week", "month"]);
/** Whole positive amount; 365 is a generous ceiling (e.g. "365 days") that still
 * rejects fat-fingered nonsense, mirroring the catalog's validityAmount cap. */
const AMOUNT = z.number().int().positive().max(365);

const updateInput = z.object({
  type: CLASS_TYPE,
  memberAmount: AMOUNT,
  memberUnit: UNIT,
  guestAmount: AMOUNT,
  guestUnit: UNIT,
});
export type UpdateVisibilityWindowInput = z.infer<typeof updateInput>;

// ───────────────────────── result contracts ─────────────────────────

/**
 * MOCK_NO_DB — mirrors admin-catalog.ts's MockNoDbCode: the action ran in
 * `mockDataMode()` (no DATABASE_URL / mock dev mode), so the input VALIDATED but
 * NOTHING was persisted. Reported as a FAILURE deliberately.
 */
export type MockNoDbCode = "MOCK_NO_DB";

export type ListVisibilityWindowsFailureCode = "UNAUTHORIZED";
export type ListVisibilityWindowsResult =
  | { ok: true; windows: VisibilityWindow[] }
  | { ok: false; code: ListVisibilityWindowsFailureCode };

export type UpdateVisibilityWindowFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | MockNoDbCode;
export type UpdateVisibilityWindowResult =
  | { ok: true; window: VisibilityWindow }
  | { ok: false; code: UpdateVisibilityWindowFailureCode };

// Stable display order (matches CLASS_TYPE / CAPACITY ordering elsewhere in the app).
const TYPE_ORDER: readonly ClassType[] = ["group", "private", "duo", "trio", "rental"] as const;

// ───────────────────────── read ─────────────────────────

/**
 * All 5 class types' visibility windows (member + guest lead time), DB-backed with
 * the seed as the empty-table/no-DB fallback (loadVisibilityWindows). Owner-only —
 * the underlying lead times shape a commercially-sensitive booking-horizon policy.
 */
export async function listVisibilityWindows(): Promise<ListVisibilityWindowsResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const map = await loadVisibilityWindows();
  const windows = TYPE_ORDER.map((type) => map.get(type)).filter(
    (w): w is VisibilityWindow => w !== undefined,
  );
  return { ok: true, windows };
}

// ───────────────────────── update (upsert) ─────────────────────────

/**
 * Set one class type's member + guest visibility lead time. Upserts the row keyed
 * on `type` (the table's PK — exactly one row per class type, so there is no
 * separate create/delete: every type always resolves to SOME window, real or seed).
 *
 * Deliberately does NOT touch any existing `class_instances` row — see the file
 * doc comment. Only classes created/generated AFTER this call pick up the new
 * lead times (app/actions/schedule.ts resolves them fresh on every create/generate).
 */
export async function updateVisibilityWindow(
  raw: UpdateVisibilityWindowInput,
): Promise<UpdateVisibilityWindowResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  // Mock-data dev mode: the input is fully validated above, but there is no
  // database to write to. Report MOCK_NO_DB rather than a fake success.
  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  const db = getDb();
  await db
    .insert(visibilityWindows)
    .values({
      type: input.type,
      memberAmount: input.memberAmount,
      memberUnit: input.memberUnit,
      guestAmount: input.guestAmount,
      guestUnit: input.guestUnit,
    })
    .onConflictDoUpdate({
      target: visibilityWindows.type,
      set: {
        memberAmount: input.memberAmount,
        memberUnit: input.memberUnit,
        guestAmount: input.guestAmount,
        guestUnit: input.guestUnit,
        updatedAt: new Date(),
      },
    });

  revalidateVisibilitySettings();

  return {
    ok: true,
    window: {
      type: input.type,
      memberAmount: input.memberAmount,
      memberUnit: input.memberUnit as VisibilityUnit,
      guestAmount: input.guestAmount,
      guestUnit: input.guestUnit as VisibilityUnit,
    },
  };
}

/**
 * Every surface that would render or depend on a class's visibility window.
 */
function revalidateVisibilitySettings(): void {
  revalidatePath("/admin/visibility");
  revalidatePath("/admin/schedule");
}
