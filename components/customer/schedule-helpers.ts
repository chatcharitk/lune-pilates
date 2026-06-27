// Presentation-only helpers for the customer schedule/detail screens. These do
// NOT compute any business rules (capacity, visibility, pricing) — those come
// from the backend contracts in lib/schedule + app/actions. Here we only derive
// display values (time-of-day bucket, end time, dot colour, week chips) from the
// already-resolved server data, mirroring lune-pilates/project/lune-ui.jsx +
// lune-data.jsx.

import type { ClassType } from "@/lib/domain/types";
import type { Bilingual } from "@/lib/i18n";
import type { StrKey } from "@/lib/i18n/strings";

export type PartOfDay = "morning" | "afternoon" | "evening";

/** Bucket an ISO start time into morning/afternoon/evening (mirrors partOfDay). */
export function partOfDay(startsAtIso: string): PartOfDay {
  const h = new Date(startsAtIso).getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

/**
 * The keyed time-of-day greeting for the current hour (mirrors lune-home.jsx's
 * greeting block): before noon → morning, before 17:00 → afternoon, else
 * evening. Returns the i18n key so the copy stays keyed/bilingual (the catalog
 * supplies greet_morning/greet_afternoon/greet_evening). Computed on the client
 * from the viewer's local clock — display-only, no business logic.
 */
export function greetingKey(now: Date = new Date()): StrKey {
  const h = now.getHours();
  if (h < 12) return "greet_morning";
  if (h < 17) return "greet_afternoon";
  return "greet_evening";
}

/**
 * Bilingual long date line for the Home greeting (mirrors lune-home.jsx
 * `dateLong`): EN uses the `en-US` weekday + day + month + year; TH uses the
 * `th-TH` Buddhist-era locale, which yields e.g. "วันจันทร์ที่ 1 มิถุนายน 2569".
 * Pure display derivation from the local clock.
 */
export function longDateLabel(now: Date = new Date()): Bilingual {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  return {
    en: now.toLocaleDateString("en-US", opts),
    th: now.toLocaleDateString("th-TH", opts),
  };
}

/** "HH:MM" local time from an ISO start string. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** End "HH:MM" given a start ISO and duration in minutes (mirrors endTime). */
export function endTime(startIso: string, durationMin: number): string {
  const end = new Date(new Date(startIso).getTime() + durationMin * 60_000);
  const h = String(end.getHours()).padStart(2, "0");
  const m = String(end.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
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
 * Format a booking's free-cancel window (hours, server-provided 5 | 1) into a
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
export const FILTER_TYPES: ClassType[] = ["group", "private", "duo", "trio", "rental"];

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

/** Day-of-week index 1..7 (Mon=1) for an ISO date. */
export function weekdayOf(iso: string): number {
  const day = new Date(iso).getDay(); // 0=Sun … 6=Sat
  return ((day + 6) % 7) + 1; // Mon=1 … Sun=7
}

/** Local midnight of today — the anchor for the bookable 7-day strip. */
export function currentWeekStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 7 consecutive days from `start`, with real weekday labels, dates and today flag. */
export function buildWeek(start: Date, now: Date = new Date()): WeekDay[] {
  const today = currentWeekStart(now).getTime();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dow = ((d.getDay() + 6) % 7) + 1; // Mon=1 … Sun=7
    return { d: dow, dow: DOW_LABELS[dow - 1]!, date: d.getDate(), today: d.getTime() === today };
  });
}

/** Bilingual "Month YYYY" (TH uses the Buddhist year). */
export function monthLabel(start: Date): Bilingual {
  return {
    en: start.toLocaleString("en-US", { month: "long", year: "numeric" }),
    th: `${TH_MONTHS[start.getMonth()]} ${start.getFullYear() + 543}`,
  };
}

/** Bilingual "Dow D Mon" label for a class start (e.g. Thu 19 Jun / พฤ. 19 มิ.ย.). */
export function classDateLabel(iso: string): Bilingual {
  const d = new Date(iso);
  const dow = DOW_LABELS[(d.getDay() + 6) % 7]!;
  return {
    en: `${dow.en} ${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })}`,
    th: `${dow.th} ${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]}`,
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
  const start = new Date(iso);
  const startMidnight = new Date(start);
  startMidnight.setHours(0, 0, 0, 0);
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
