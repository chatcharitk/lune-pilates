// Presentation-only helpers for the customer schedule/detail screens. These do
// NOT compute any business rules (capacity, visibility, pricing) — those come
// from the backend contracts in lib/schedule + app/actions. Here we only derive
// display values (time-of-day bucket, end time, dot colour, week chips) from the
// already-resolved server data, mirroring lune-pilates/project/lune-ui.jsx +
// lune-data.jsx.

import type { ClassType } from "@/lib/domain/types";
import type { Bilingual } from "@/lib/i18n";
import type { StrKey } from "@/lib/i18n/strings";
import {
  addDays,
  formatStudioDate,
  formatStudioTime,
  studioIsoDow,
  studioParts,
  studioStartOfDay,
  studioStartOfWeekMonday,
} from "@/lib/time";

export type PartOfDay = "morning" | "afternoon" | "evening";

/** Bucket an ISO start time into morning/afternoon/evening (Bangkok wall-clock). */
export function partOfDay(startsAtIso: string): PartOfDay {
  const h = studioParts(new Date(startsAtIso)).hour;
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

/**
 * The keyed time-of-day greeting for the current hour (mirrors lune-home.jsx's
 * greeting block): before noon → morning, before 17:00 → afternoon, else
 * evening. Returns the i18n key so the copy stays keyed/bilingual (the catalog
 * supplies greet_morning/greet_afternoon/greet_evening). Anchored to the studio's
 * Bangkok clock (the studio is in Bangkok), so it is stable regardless of the
 * runtime/host timezone — display-only, no business logic.
 */
export function greetingKey(now: Date = new Date()): StrKey {
  const h = studioParts(now).hour;
  if (h < 12) return "greet_morning";
  if (h < 17) return "greet_afternoon";
  return "greet_evening";
}

/**
 * Bilingual long date line for the Home greeting (mirrors lune-home.jsx
 * `dateLong`): EN uses the `en-US` weekday + day + month + year; TH uses the
 * `th-TH` Buddhist-era locale, which yields e.g. "วันจันทร์ที่ 1 มิถุนายน 2569".
 * Pure display derivation, pinned to the studio's Bangkok day (host-TZ-independent).
 */
export function longDateLabel(now: Date = new Date()): Bilingual {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  return {
    // en uses the studio's en-GB grouping via formatStudioDate; en-US weekday/month
    // names are identical, so the day order differs only cosmetically and stays
    // Bangkok-correct.
    en: formatStudioDate(now, "en", opts),
    th: formatStudioDate(now, "th", opts),
  };
}

/** "HH:MM" Bangkok wall-clock time from an ISO start string. */
export function hhmm(iso: string): string {
  return formatStudioTime(new Date(iso));
}

/** End "HH:MM" given a start ISO and duration in minutes (Bangkok wall-clock). */
export function endTime(startIso: string, durationMin: number): string {
  return formatStudioTime(new Date(new Date(startIso).getTime() + durationMin * 60_000));
}

/** The accent dot colour per class type (mirrors lune-data.jsx TYPES[*].dot). */
export const TYPE_DOT: Record<ClassType, string> = {
  group: "#A98F71",
  private: "#8E9A82",
  duo: "#C0A079",
  trio: "#B7A48C",
  rental: "#A99B86",
};

/** i18n key for a class type's short filter label. */
export const TYPE_FILTER_KEY: Record<ClassType, StrKey> = {
  group: "type_group",
  private: "type_private",
  duo: "type_duo",
  trio: "type_trio",
  rental: "type_rental",
};

/** i18n key for a reformer position label. */
export const POSITION_KEY = {
  left: "pos_left",
  middle: "pos_middle",
  right: "pos_right",
} as const satisfies Record<"left" | "middle" | "right", StrKey>;

export const PART_OF_DAY_KEY: Record<PartOfDay, StrKey> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
};

/**
 * Format a booking's free-cancel window (hours, server-provided always 5) into a
 * localized "N hours" / "N hour" phrase via the keyed `window_hours`/
 * `window_hour` strings. Pure display derivation — the window value itself is
 * locked server-side on the booking (CLAUDE.md §5 invariant 7), never computed
 * here. `t` is the caller's translator so copy stays keyed/bilingual.
 */
export function windowHoursLabel(hours: number, t: (k: StrKey) => string): string {
  const key: StrKey = hours === 1 ? "window_hour" : "window_hours";
  return t(key).replace("{n}", String(hours));
}

/** Order class types appear as filter chips (matches the prototype). */
export const FILTER_TYPES: ClassType[] = ["group", "private", "duo", "trio", "rental"]; // rental re-shown 2026-07-23

// ───────── week / month chrome (dynamic — anchored to the real current day) ─────────
// The bookable strip is 7 consecutive days starting today, with real weekday
// labels and dates. Computed on the server and passed to the view as props so
// server and client never disagree on "today" (no hydration drift).

export interface WeekDay {
  d: number; // 1=Mon … 7=Sun (day-of-week of this calendar date)
  dow: Bilingual;
  date: number; // calendar day-of-month
  today?: boolean;
}

const DOW_LABELS: Bilingual[] = [
  { en: "Mon", th: "จ." },
  { en: "Tue", th: "อ." },
  { en: "Wed", th: "พ." },
  { en: "Thu", th: "พฤ." },
  { en: "Fri", th: "ศ." },
  { en: "Sat", th: "ส." },
  { en: "Sun", th: "อา." },
];

const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const TH_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** Day-of-week index 1..7 (Mon=1) for an ISO date, in Bangkok (studio) time. */
export function weekdayOf(iso: string): number {
  return studioParts(new Date(iso)).isoDow; // Mon=1 … Sun=7
}

/** Bangkok 00:00 of today — the anchor for the bookable 7-day strip. */
export function currentWeekStart(now: Date = new Date()): Date {
  return studioStartOfDay(now);
}

/**
 * `count` consecutive days from `start` (default 7), with real weekday labels,
 * dates and today flag. `count` lets the viewed-week strip be shorter than 7 for
 * the current week (today → Sunday only, so no un-bookable past days show).
 */
export function buildWeek(start: Date, now: Date = new Date(), count = 7): WeekDay[] {
  const today = currentWeekStart(now).getTime();
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(studioStartOfDay(start), i);
    const parts = studioParts(d);
    const dow = parts.isoDow; // Mon=1 … Sun=7
    return {
      d: dow,
      dow: DOW_LABELS[dow - 1]!,
      date: parts.day,
      today: studioStartOfDay(d).getTime() === today,
    };
  });
}

/** Bilingual "Month YYYY" (TH uses the Buddhist year), in Bangkok time. */
export function monthLabel(start: Date): Bilingual {
  const { month0, year } = studioParts(start);
  return {
    en: formatStudioDate(start, "en", { month: "long", year: "numeric" }),
    th: `${TH_MONTHS[month0]} ${year + 543}`,
  };
}

// ───────── forward week paging (customer /schedule) ─────────
// The schedule can page FORWARD through weeks so open future rentals (whose
// monthly booking window opens on the 1st of the prior month) and future group
// classes become reachable. Paging is clamped: never into the past (past classes
// aren't bookable), and forward only as far as MAX_WEEK_OFFSET — a horizon that
// comfortably covers the ~1-month rental release window. All anchoring goes
// through the Bangkok-correct time helpers so it never drifts with the host TZ.

/** Furthest week (in whole weeks ahead of the current one) the customer can page
 *  to. 5 weeks comfortably covers a rental anywhere in the next calendar month. */
export const MAX_WEEK_OFFSET = 5;

/** Parse a `?week=` offset param, clamped to [0, MAX_WEEK_OFFSET]; anything absent,
 *  malformed or negative (i.e. the past) fails closed to 0 = the current week. */
export function clampWeekOffset(raw: string | undefined | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_WEEK_OFFSET);
}

/**
 * The `weekStart` instant fed to `listBookableClasses` for a forward `offset`
 * (0 = current week). Offset 0 anchors to Bangkok 00:00 TODAY (a rolling window,
 * so no already-past days are fetched); offset n>0 anchors to Bangkok Monday of
 * the nth week ahead, so each future week is a clean Mon–Sun span.
 */
export function scheduleWeekStart(offset: number, now: Date = new Date()): Date {
  if (offset <= 0) return studioStartOfDay(now);
  return addDays(studioStartOfWeekMonday(now), offset * 7);
}

/**
 * The day chips for the viewed week: the current week runs today → Sunday (so the
 * strip never offers un-bookable past days), every future week is a full Mon–Sun.
 */
export function scheduleWeekDays(offset: number, now: Date = new Date()): WeekDay[] {
  const start = scheduleWeekStart(offset, now);
  // Mon=1 … Sun=7 → 7,6,…,1 remaining days this week; future weeks always show 7.
  const count = offset <= 0 ? 8 - studioIsoDow(start) : 7;
  return buildWeek(start, now, count);
}

/**
 * Bilingual date-range label for the viewed week (e.g. "23–29 Jun" within a month,
 * "28 Jun – 4 Jul" across a boundary; TH uses the short Thai months). Anchored to
 * the same Bangkok days as the strip, so header and chips can never disagree.
 */
export function weekRangeLabel(offset: number, now: Date = new Date()): Bilingual {
  const days = scheduleWeekDays(offset, now);
  const start = scheduleWeekStart(offset, now);
  const end = addDays(start, Math.max(0, days.length - 1));
  const sp = studioParts(start);
  const ep = studioParts(end);
  const enShort = (d: Date) => formatStudioDate(d, "en", { month: "short" });
  if (sp.month0 === ep.month0) {
    return {
      en: `${sp.day}–${ep.day} ${enShort(end)}`,
      th: `${sp.day}–${ep.day} ${TH_MONTHS_SHORT[ep.month0]}`,
    };
  }
  return {
    en: `${sp.day} ${enShort(start)} – ${ep.day} ${enShort(end)}`,
    th: `${sp.day} ${TH_MONTHS_SHORT[sp.month0]} – ${ep.day} ${TH_MONTHS_SHORT[ep.month0]}`,
  };
}

/** Bilingual "Dow D Mon" label for a class start (e.g. Thu 19 Jun / พฤ. 19 มิ.ย.). */
export function classDateLabel(iso: string): Bilingual {
  const d = new Date(iso);
  const parts = studioParts(d);
  const dow = DOW_LABELS[parts.isoDow - 1]!;
  return {
    en: `${dow.en} ${parts.day} ${formatStudioDate(d, "en", { month: "short" })}`,
    th: `${dow.th} ${parts.day} ${TH_MONTHS_SHORT[parts.month0]}`,
  };
}

/**
 * Bilingual day label relative to `now`: "Today"/"Tomorrow" within the next two
 * calendar days, otherwise the dated `classDateLabel`. Pure display derivation
 * from the server-resolved ISO start (no business logic). The catalog supplies
 * the Today/Tomorrow copy so callers pass those strings in (keeps i18n keyed).
 */
export function relativeDateLabel(
  iso: string,
  todayLabel: Bilingual,
  tomorrowLabel: Bilingual,
  now: Date = new Date(),
): Bilingual {
  const startMidnight = studioStartOfDay(new Date(iso));
  const todayMidnight = currentWeekStart(now);
  const diffDays = Math.round(
    (startMidnight.getTime() - todayMidnight.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return todayLabel;
  if (diffDays === 1) return tomorrowLabel;
  return classDateLabel(iso);
}

/**
 * Bilingual "Xh Ym" / "X ชม. Y นาที" from a fractional hours value (e.g. the
 * server-computed `cancellation.hoursUntilStart`). Negative inputs clamp to 0,
 * so a just-started class reads "0h 0m". Display-only — the policy decision
 * itself comes from the backend.
 */
export function hoursUntilLabel(hoursUntil: number): Bilingual {
  const total = Math.max(0, hoursUntil);
  const h = Math.floor(total);
  const m = Math.round((total - h) * 60);
  // Carry a rounded-up 60 minutes into the hour so we never render "Xh 60m".
  const hh = m === 60 ? h + 1 : h;
  const mm = m === 60 ? 0 : m;
  return { en: `${hh}h ${mm}m`, th: `${hh} ชม. ${mm} นาที` };
}
