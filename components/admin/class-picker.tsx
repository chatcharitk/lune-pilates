"use client";

// Choosing a class to book a customer into (admin → Bookings → Book for customer).
//
// It used to be one flat list of every upcoming class, oldest first — with four
// weeks of a full timetable that is a hundred-odd rows of near-identical names, and
// the owner could not find the one she wanted (2026-09-29). It is now day first:
// pick the day from a strip, narrow by format if needed, then choose from a short
// list for that day with the time as the most prominent thing on each row, which is
// how a front desk actually thinks about a booking ("Saturday, the 10 o'clock").
//
// FULL classes are listed too, disabled: hiding them made a class the owner could
// see on the schedule simply vanish here, which reads as a bug. They say "Full".

import { useEffect, useMemo, useState } from "react";
import { useAdminLang } from "./admin-context";
import { Dot } from "./ui";
import { LEVEL_KEY } from "./level-options";
import type { BookableClass } from "@/lib/schedule/queries";
import type { ClassType } from "@/lib/domain/types";
import { formatStudioDate, formatStudioTime, studioYmd } from "@/lib/time";

type TypeFilter = "all" | ClassType;

export function ClassPicker({
  classes,
  onSelect,
}: {
  classes: BookableClass[];
  onSelect: (c: BookableClass) => void;
}) {
  const { t, tt, lang } = useAdminLang();

  // Every class, soonest first, grouped by its Bangkok day.
  const byDay = useMemo(() => {
    const sorted = [...classes].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const map = new Map<string, BookableClass[]>();
    for (const c of sorted) {
      const day = studioYmd(new Date(c.startsAt));
      const list = map.get(day) ?? [];
      list.push(c);
      map.set(day, list);
    }
    return map;
  }, [classes]);

  const days = useMemo(() => [...byDay.keys()], [byDay]);
  const [day, setDay] = useState<string | null>(days[0] ?? null);
  const [type, setType] = useState<TypeFilter>("all");

  // If the class list changes under us (a refresh after booking), keep a valid day.
  useEffect(() => {
    if (day === null || !byDay.has(day)) setDay(days[0] ?? null);
  }, [byDay, days, day]);

  const onDay = day ? (byDay.get(day) ?? []) : [];
  const typesOnDay = useMemo(
    () => [...new Set(onDay.map((c) => c.type))] as ClassType[],
    [onDay],
  );
  // A format filter that no longer applies on the chosen day falls back to "all",
  // rather than showing an empty list with no obvious reason.
  const effectiveType: TypeFilter = type !== "all" && !typesOnDay.includes(type) ? "all" : type;
  const shown = effectiveType === "all" ? onDay : onDay.filter((c) => c.type === effectiveType);

  if (days.length === 0) {
    return (
      <p className="mb-4 rounded-xl border border-line p-4 text-center font-body text-sm text-muted">
        {t("no_classes")}
      </p>
    );
  }

  return (
    <div className="mb-4">
      {/* ── day strip ── */}
      <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t("select_class")}>
        {days.map((d, i) => {
          const date = new Date(`${d}T12:00:00+07:00`);
          const on = d === day;
          const count = byDay.get(d)?.length ?? 0;
          // Say the month on the first chip and whenever it changes, so a strip that
          // runs into next month is never ambiguous.
          const prev = days[i - 1];
          const showMonth = i === 0 || (prev !== undefined && prev.slice(0, 7) !== d.slice(0, 7));
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setDay(d)}
              className={`flex w-[58px] shrink-0 flex-col items-center rounded-2xl border px-1 py-2 transition-colors ${
                on ? "border-ink bg-ink text-cream" : "border-line bg-surface-2 text-ink hover:bg-cream-2"
              }`}
            >
              <span className={`font-body text-[10.5px] font-semibold ${on ? "text-cream/80" : "text-muted"}`}>
                {formatStudioDate(date, lang, { weekday: "short" })}
              </span>
              <span className="font-head text-[19px] font-semibold leading-tight tabular-nums">
                {formatStudioDate(date, lang, { day: "numeric" })}
              </span>
              <span className={`font-body text-[10px] ${on ? "text-cream/70" : "text-muted"}`}>
                {showMonth ? formatStudioDate(date, lang, { month: "short" }) : " "}
              </span>
              <span
                className={`mt-0.5 rounded-full px-1.5 font-body text-[10px] font-semibold tabular-nums ${
                  on ? "bg-cream/20 text-cream" : "bg-cream-2 text-taupe-deep"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── format filter, only when the day has more than one ── */}
      {typesOnDay.length > 1 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {(["all", ...typesOnDay] as TypeFilter[]).map((f) => {
            const on = effectiveType === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setType(f)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-body text-[12.5px] font-semibold ${
                  on ? "border-taupe bg-taupe text-white" : "border-line-strong bg-surface-2 text-ink-soft"
                }`}
              >
                {f !== "all" && <Dot type={f} size={7} />}
                {f === "all" ? t("filter_all") : t(`type_${f}` as Parameters<typeof t>[0])}
              </button>
            );
          })}
        </div>
      )}

      {/* ── the day's classes ── */}
      <ul className="overflow-hidden rounded-xl border border-line">
        {shown.map((c) => (
          <li key={c.id} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => onSelect(c)}
              disabled={c.full}
              className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <span className="w-[52px] shrink-0 font-head text-[16px] font-semibold text-ink tabular-nums">
                {formatStudioTime(new Date(c.startsAt))}
              </span>
              <Dot type={c.type} size={8} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-body text-[13.5px] font-semibold text-ink">
                  {c.name || tt(c.typeMeta.label)}
                </span>
                <span className="block truncate font-body text-xs text-muted">
                  {[
                    c.name ? tt(c.typeMeta.short) : null,
                    c.instructor ? tt(c.instructor.name) : null,
                    c.level ? t(LEVEL_KEY[c.level]) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span
                className={`shrink-0 font-body text-xs font-semibold tabular-nums ${
                  c.full ? "text-[#a56a52]" : "text-sage-deep"
                }`}
              >
                {c.full ? t("full") : `${c.seatsLeft} ${c.seatsLeft === 1 ? t("spot_left") : t("spots_left")}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
