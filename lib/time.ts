// Central time module — the single source of truth for studio (class) time.
//
// The studio is in Bangkok (Asia/Bangkok, UTC+7, NO daylight saving), and ALL
// class/schedule times are Bangkok wall-clock times, INDEPENDENT of the runtime
// timezone the app happens to run in (Vercel runs UTC). Stored instants are
// correct `timestamptz` values (09:00 Bangkok = 02:00 UTC); the bug class this
// module fixes is using the runtime's local clock (getHours/setHours/getDay/
// toLocaleTimeString without a timeZone) for display and day/week anchoring,
// which renders class times 7 hours off on a UTC host.
//
// Because Bangkok has no DST we use a FIXED offset (+07:00 = 420 minutes) for all
// wall-clock <-> instant conversions — no DST table, no runtime-TZ leakage. The
// Intl-based label formatters pass `timeZone: 'Asia/Bangkok'` explicitly so they
// are likewise host-independent (and th-TH yields the Buddhist era).

export const STUDIO_TZ = "Asia/Bangkok";

/** Bangkok's fixed UTC offset in minutes (UTC+7, no DST). */
const OFFSET_MIN = 420;
const OFFSET_MS = OFFSET_MIN * 60_000;

/**
 * The UTC instant for a Bangkok wall-clock time. `monthIndex` is 0-based (0=Jan,
 * 11=Dec) to match JS conventions. e.g. studioInstant(2026, 5, 28, 9, 0) is the
 * instant "2026-06-28T02:00:00Z" (09:00 Bangkok).
 */
export function studioInstant(
  year: number,
  monthIndex: number,
  day: number,
  hh: number,
  mm: number,
): Date {
  return new Date(Date.UTC(year, monthIndex, day, hh, mm) - OFFSET_MS);
}

/** The Bangkok wall-clock parts of an instant. */
export interface StudioParts {
  year: number;
  /** 0-based month (0=Jan … 11=Dec). */
  month0: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO day of week: 1=Mon … 7=Sun. */
  isoDow: number;
}

/**
 * The Bangkok wall-clock parts of an instant. Implemented by shifting the instant
 * forward by the Bangkok offset and reading the UTC getters — so the result never
 * depends on the runtime timezone.
 */
export function studioParts(d: Date): StudioParts {
  const b = new Date(d.getTime() + OFFSET_MS);
  const jsDow = b.getUTCDay(); // 0=Sun … 6=Sat
  return {
    year: b.getUTCFullYear(),
    month0: b.getUTCMonth(),
    day: b.getUTCDate(),
    hour: b.getUTCHours(),
    minute: b.getUTCMinutes(),
    isoDow: jsDow === 0 ? 7 : jsDow,
  };
}

/** Zero-padded "HH:MM" Bangkok wall-clock time of an instant. */
export function formatStudioTime(d: Date): string {
  const { hour, minute } = studioParts(d);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** ISO day of week (1=Mon … 7=Sun) of an instant, in Bangkok time. */
export function studioIsoDow(d: Date): number {
  return studioParts(d).isoDow;
}

/** The UTC instant of Bangkok 00:00 on the Bangkok calendar day containing `d`. */
export function studioStartOfDay(d: Date): Date {
  const { year, month0, day } = studioParts(d);
  return studioInstant(year, month0, day, 0, 0);
}

/** The UTC instant of Bangkok 00:00 the day AFTER `d`'s Bangkok day. */
export function studioEndOfDay(d: Date): Date {
  return addDays(studioStartOfDay(d), 1);
}

/**
 * The UTC instant of Bangkok Monday 00:00 of the week containing `d` (Monday-first
 * week, matching the studio week / classTemplates day_of_week 1=Mon … 7=Sun).
 */
export function studioStartOfWeekMonday(d: Date): Date {
  const start = studioStartOfDay(d);
  const isoDow = studioIsoDow(start); // 1=Mon … 7=Sun
  return addDays(start, -(isoDow - 1));
}

/** `n` whole days after `d` (exact 24h multiples — safe since ICT has no DST). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 3_600_000);
}

/**
 * The UTC instant of Bangkok 00:00 on a "yyyy-mm-dd" calendar day (so a week/day
 * URL param is anchored to the Bangkok day boundary, never the runtime TZ's).
 * Falls back to the Bangkok start-of-today for an absent/malformed string so the
 * caller fails closed to the current Bangkok week rather than a shifted day.
 */
export function studioDayFromYmd(ymd: string | undefined | null): Date {
  if (!ymd) return studioStartOfDay(new Date());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return studioStartOfDay(new Date());
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dom = Number(m[3]);
  if (month < 1 || month > 12 || dom < 1 || dom > 31) {
    return studioStartOfDay(new Date());
  }
  const instant = studioInstant(year, month - 1, dom, 0, 0);
  // Reject overflow (e.g. 2026-02-31, which Date.UTC rolls forward) by requiring
  // the parts to round-trip in Bangkok time.
  const parts = studioParts(instant);
  if (parts.year !== year || parts.month0 !== month - 1 || parts.day !== dom) {
    return studioStartOfDay(new Date());
  }
  return instant;
}

/**
 * A Bangkok-localized date label for an instant. Uses Intl with an explicit
 * `timeZone: 'Asia/Bangkok'` so it is host-TZ-independent; th-TH yields the
 * Buddhist era automatically. `lang` selects en-GB (24h, D/M/Y order) or th-TH.
 */
export function formatStudioDate(
  d: Date,
  lang: "en" | "th",
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    timeZone: STUDIO_TZ,
    ...opts,
  }).format(d);
}
