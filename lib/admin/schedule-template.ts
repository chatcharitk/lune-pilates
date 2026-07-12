// Read model for the EDITABLE recurring weekly schedule template (CLAUDE.md §5
// invariant 5). The template now lives in the `class_templates` table (one row per
// recurring weekly slot, day_of_week 1=Mon…7=Sun) instead of the hardcoded
// BASELINE_SLOTS constant — the admin "Schedule template" editor reads/writes it
// through here and app/actions/schedule-template.ts.
//
// BASELINE_SLOTS (lib/schedule/baseline.ts) is KEPT as the seed source and as the
// FALLBACK: when the table is empty (before seeding / on a fresh reset), the
// template-grouped read falls back to BASELINE_SLOTS so generating a week and the
// changes-vs-template diff behave exactly as they did before the table was
// populated. Once the table has rows, the DB is authoritative.
//
// Like the other admin read models, this does NOT apply tiered visibility — it is
// the studio's own recurring template.

import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { classTemplates, instructors } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import { effectiveCapacity } from "@/lib/domain/types";
import {
  instructorMetaFor,
  metaFor,
  type ClassTypeMeta,
  type InstructorMeta,
} from "@/lib/schedule/queries";
import { BASELINE_SLOTS, type BaselineSlot } from "@/lib/schedule/baseline";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── contract ─────────────────────────

/** One ACTIVE recurring template slot, enriched for the admin editor. */
export interface TemplateSlot {
  id: string;
  /** ISO day of week: 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  /** Local start time, "HH:MM". */
  time: string;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  durationMin: number;
  capacity: number;
  instructorId: string | null;
  instructor: InstructorMeta | null;
}

/** A template slot carrying its source id, for materialising instances with templateId. */
export interface TemplateBaselineSlot extends BaselineSlot {
  /** The class_templates.id this slot came from, or null when sourced from the fallback. */
  templateId: string | null;
  instructorId: string | null;
}

const byDowThenTime = (a: { dayOfWeek: number; time: string }, b: { dayOfWeek: number; time: string }) =>
  a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time);

// ───────────────────────── public reads ─────────────────────────

/**
 * Every ACTIVE template slot, enriched with type + instructor display metadata,
 * sorted by day-of-week then time. The editor list. Soft-deleted (active=false)
 * slots are excluded.
 *
 * No-DB dev path: mirror BASELINE_SLOTS (group-only, the current schedule) so the
 * editor renders without a database. Synthetic stable ids per slot.
 */
export async function getScheduleTemplate(): Promise<TemplateSlot[]> {
  if (mockDataMode()) {
    return BASELINE_SLOTS.map((s, i) => mockTemplateSlot(s, i)).sort(byDowThenTime);
  }

  const db = getDb();
  const rows = await db
    .select({
      id: classTemplates.id,
      dayOfWeek: classTemplates.dayOfWeek,
      time: classTemplates.time,
      type: classTemplates.type,
      durationMin: classTemplates.durationMin,
      capacity: classTemplates.capacity,
      instructorId: classTemplates.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
    })
    .from(classTemplates)
    .leftJoin(instructors, eq(classTemplates.instructorId, instructors.id))
    .where(eq(classTemplates.active, true))
    .orderBy(asc(classTemplates.dayOfWeek), asc(classTemplates.time));

  return rows.map((r) => ({
    id: r.id,
    dayOfWeek: r.dayOfWeek,
    time: r.time,
    type: r.type,
    typeMeta: metaFor(r.type),
    durationMin: r.durationMin,
    capacity: effectiveCapacity(r.capacity, r.type),
    instructorId: r.instructorId,
    instructor: instructorMetaFor(
      r.instructorId,
      r.instructorName ?? undefined,
      r.instructorNameTh ?? undefined,
      r.instructorTag,
    ),
  }));
}

/**
 * The ACTIVE template grouped by ISO weekday (1=Mon … 7=Sun) → the slots on that
 * day, each carrying its source `templateId` so generated instances can set the FK.
 * This is the source the week-generate action and the changes-vs-template diff read
 * (instead of the hardcoded baselineSlotsForDate).
 *
 * FALLBACK: when the table is EMPTY (no active rows — e.g. before seeding) it falls
 * back to BASELINE_SLOTS (templateId null) so behaviour is preserved on a fresh DB.
 *
 * No-DB dev path: the BASELINE_SLOTS fallback (templateId null).
 */
export async function getTemplateSlotsByDow(): Promise<Map<number, TemplateBaselineSlot[]>> {
  if (mockDataMode()) {
    return groupBaselineFallback();
  }

  const db = getDb();
  const rows = await db
    .select({
      id: classTemplates.id,
      dayOfWeek: classTemplates.dayOfWeek,
      time: classTemplates.time,
      type: classTemplates.type,
      durationMin: classTemplates.durationMin,
      capacity: classTemplates.capacity,
      instructorId: classTemplates.instructorId,
    })
    .from(classTemplates)
    .where(eq(classTemplates.active, true))
    .orderBy(asc(classTemplates.dayOfWeek), asc(classTemplates.time));

  if (rows.length === 0) return groupBaselineFallback();

  const map = new Map<number, TemplateBaselineSlot[]>();
  for (const r of rows) {
    const slot: TemplateBaselineSlot = {
      dayOfWeek: r.dayOfWeek,
      time: r.time,
      type: r.type,
      durationMin: r.durationMin,
      capacity: effectiveCapacity(r.capacity, r.type),
      templateId: r.id,
      instructorId: r.instructorId,
    };
    const list = map.get(r.dayOfWeek) ?? [];
    list.push(slot);
    map.set(r.dayOfWeek, list);
  }
  return map;
}

// ───────────────────────── helpers ─────────────────────────

/** A stable synthetic uuid for a mock template slot (no-DB path). */
function mockTemplateUuid(n: number): string {
  return `00000000-0000-4000-a000-${n.toString(16).padStart(12, "0")}`;
}

function mockTemplateSlot(slot: BaselineSlot, i: number): TemplateSlot {
  return {
    id: mockTemplateUuid(i + 1),
    dayOfWeek: slot.dayOfWeek,
    time: slot.time,
    type: slot.type,
    typeMeta: metaFor(slot.type),
    durationMin: slot.durationMin,
    capacity: slot.capacity,
    instructorId: null,
    instructor: null,
  };
}

/** BASELINE_SLOTS grouped by ISO weekday, templateId null (the fallback shape). */
function groupBaselineFallback(): Map<number, TemplateBaselineSlot[]> {
  const map = new Map<number, TemplateBaselineSlot[]>();
  for (const s of BASELINE_SLOTS) {
    const slot: TemplateBaselineSlot = { ...s, templateId: null, instructorId: null };
    const list = map.get(s.dayOfWeek) ?? [];
    list.push(slot);
    map.set(s.dayOfWeek, list);
  }
  return map;
}
