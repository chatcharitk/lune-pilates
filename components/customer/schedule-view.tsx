"use client";

// Interactive shell for the week schedule: day chips + type filter chips drive
// client-side filtering of the already-fetched, already-visibility-filtered
// BookableClass list. No business logic here — the list is computed server-side
// by listBookableClasses; we only group/filter for display.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BookableClass } from "@/lib/schedule/queries";
import type { ClassType } from "@/lib/domain/types";
import { studioImage } from "@/lib/studio-images";
import { makeT, type Bilingual, type Lang } from "@/lib/i18n";
import { useCustomerLang } from "./customer-context";
import {
  FILTER_TYPES,
  PART_OF_DAY_KEY,
  TYPE_DOT,
  TYPE_FILTER_KEY,
  endTime,
  hhmm,
  partOfDay,
  weekdayOf,
  type PartOfDay,
  type WeekDay,
} from "./schedule-helpers";
import { ChevronLeft, ChevronRight, Sparkle } from "./icons";

const PODS: PartOfDay[] = ["morning", "afternoon", "evening"];

export function ScheduleView({
  classes,
  week,
  rangeLabel,
  weekOffset,
  maxWeekOffset,
}: {
  classes: BookableClass[];
  week: WeekDay[];
  rangeLabel: Bilingual;
  /** Forward offset of the viewed week (0 = current week). */
  weekOffset: number;
  /** Furthest forward offset reachable (disables "next" at the horizon). */
  maxWeekOffset: number;
}) {
  const { t, tt, lang } = useCustomerLang();
  const router = useRouter();
  const [day, setDay] = useState(week[0]?.d ?? 1); // default to the week's first day
  const [filter, setFilter] = useState<"all" | ClassType>("all");

  const canPrev = weekOffset > 0;
  const canNext = weekOffset < maxWeekOffset;
  // Navigate to another week via the URL so the server refetches that week's
  // bookable list; the page keys ScheduleView by offset, so day/filter reset.
  const goToWeek = (next: number) => {
    router.push(next <= 0 ? "/schedule" : `/schedule?week=${next}`);
  };

  // Group the selected day's (optionally filtered) classes by time-of-day.
  const groups = useMemo(() => {
    const forDay = classes.filter((c) => weekdayOf(c.startsAt) === day);
    const filtered = filter === "all" ? forDay : forDay.filter((c) => c.type === filter);
    return PODS.map((pod) => ({
      pod,
      items: filtered.filter((c) => partOfDay(c.startsAt) === pod),
    })).filter((g) => g.items.length > 0);
  }, [classes, day, filter]);

  return (
    <div>
      {/* sticky sub-header: title + month + week chips + filters */}
      <div className="sticky top-0 z-10 bg-cream pt-1">
        <div className="px-[18px] pb-0.5 pt-1">
          <h1 className="font-head text-[26px] font-medium tracking-[0.01em] text-ink">
            {t("nav_schedule")}
          </h1>
        </div>

        {/* week pager: ‹ prev · date range · next › (clamped to [current, +max]) */}
        <div className="flex items-center justify-between px-[18px] pb-1.5 pt-2">
          <PagerButton
            direction="prev"
            disabled={!canPrev}
            label={t("prev_week")}
            onClick={() => goToWeek(weekOffset - 1)}
          />
          <span className="font-body text-[13.5px] font-semibold tabular-nums text-ink-soft">
            {tt(rangeLabel)}
          </span>
          <PagerButton
            direction="next"
            disabled={!canNext}
            label={t("next_week")}
            onClick={() => goToWeek(weekOffset + 1)}
          />
        </div>

        {/* day chips */}
        <div
          className="flex gap-2 overflow-x-auto px-[18px] pb-3 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label={t("nav_schedule")}
        >
          {week.map((w) => {
            const on = day === w.d;
            return (
              <button
                key={w.d}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setDay(w.d)}
                className={`flex w-[50px] shrink-0 flex-col items-center gap-[3px] rounded-2xl border px-0 pb-2.5 pt-[9px] transition-colors ${
                  on
                    ? "border-transparent bg-ink text-cream"
                    : "border-line bg-surface-2 text-ink-soft"
                }`}
              >
                <span
                  className={`font-body text-[11px] font-semibold uppercase tracking-[0.04em] ${
                    on ? "opacity-75" : "opacity-65"
                  }`}
                >
                  {tt(w.dow)}
                </span>
                <span className="font-head text-[21px] font-semibold leading-none">{w.date}</span>
                {w.today && (
                  <span
                    className={`h-1 w-1 rounded-full ${on ? "bg-cream" : "bg-taupe"}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* filter chips */}
        <div className="flex gap-2 overflow-x-auto border-b border-line px-[18px] pb-3.5 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            {t("filter_all")}
          </FilterChip>
          {FILTER_TYPES.map((ty) => (
            <FilterChip
              key={ty}
              active={filter === ty}
              dotColor={TYPE_DOT[ty]}
              onClick={() => setFilter(ty)}
            >
              {t(TYPE_FILTER_KEY[ty])}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* sessions */}
      <div className="px-[18px] pb-7 pt-2">
        {groups.length === 0 && (
          <div className="px-5 py-[60px] text-center text-muted">
            <Sparkle size={26} className="mx-auto mb-3.5 text-line-strong" />
            <div className="font-head text-lg font-medium text-ink-soft">{t("no_classes")}</div>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.pod} className="mb-[18px]">
            <h2 className="mx-0.5 mb-3 mt-2.5 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t(PART_OF_DAY_KEY[g.pod])}
            </h2>
            <div className="flex flex-col gap-2.5">
              {g.items.map((c) => (
                <SessionRow key={c.id} c={c} lang={lang} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PagerButton({
  direction,
  disabled,
  label,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-soft transition-opacity disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon size={18} />
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  dotColor,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dotColor?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-[7px] whitespace-nowrap rounded-full border px-[15px] py-[9px] font-body text-[13.5px] font-medium tracking-[0.01em] transition-colors ${
        active ? "border-transparent bg-ink text-cream" : "border-line-strong bg-transparent text-ink-soft"
      }`}
    >
      {dotColor && (
        <span
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: dotColor }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

function SessionRow({ c, lang }: { c: BookableClass; lang: Lang }) {
  const { t, tt } = makeT(lang);
  const start = hhmm(c.startsAt);
  // A rental whose monthly booking window hasn't opened yet reads as locked (not a
  // seat-count) — the server sends rentalOpensAt only while it is still locked.
  const rentalLocked = c.rentalOpensAt !== null;
  return (
    <Link
      href={`/schedule/${c.id}`}
      className={`flex items-stretch gap-3.5 rounded-lune-sm border border-line bg-surface-2 px-4 py-3 shadow-soft transition-opacity ${
        c.full ? "opacity-90" : ""
      }`}
    >
      {/* studio-photo thumbnail over a taupe gradient (gradient shows if missing) */}
      <span
        aria-hidden="true"
        className="relative w-[52px] shrink-0 self-center overflow-hidden rounded-xl"
        style={{ aspectRatio: "1 / 1", background: "linear-gradient(150deg, var(--color-cream-2), var(--color-taupe))" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static studio asset in /public */}
        <img
          src={studioImage(c.type)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </span>

      {/* time */}
      <div className="flex w-[52px] shrink-0 flex-col justify-center border-r border-line pr-3">
        <span className="font-head text-base font-semibold leading-none text-ink">{start}</span>
        <span className="mt-1 font-body text-[10.5px] text-muted">
          {c.durationMin}
          {t("min")}
        </span>
      </div>

      {/* body */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-[7px]">
          <span
            className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: TYPE_DOT[c.type] }}
            aria-hidden="true"
          />
          <span className="font-body text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
            {tt(c.typeMeta.short)}
          </span>
        </div>
        <div className="font-head text-[17px] font-semibold leading-[1.1] text-ink">
          {c.name || tt(c.typeMeta.label)}
        </div>
        {c.instructor && (
          <div className="mt-[3px] font-body text-[12.5px] text-ink-soft">
            {t("with_kru")} {tt(c.instructor.name)}
          </div>
        )}
      </div>

      {/* status */}
      <div className="flex shrink-0 flex-col items-end justify-center gap-[5px]">
        {rentalLocked ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-cream-2 px-2.5 py-[5px] font-body text-[11.5px] font-semibold text-taupe-deep">
            {t("rental_locked")}
          </span>
        ) : c.full ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-cream-2 px-2.5 py-[5px] font-body text-[11.5px] font-semibold text-rose">
            {t("full")}
          </span>
        ) : (
          <span
            className={`font-body text-[12.5px] font-semibold ${
              c.seatsLeft <= 1 ? "text-rose" : "text-sage-deep"
            }`}
          >
            {c.seatsLeft} {c.seatsLeft === 1 ? t("spot_left") : t("spots_left")}
          </span>
        )}
        <ChevronRight size={16} className="text-muted" />
      </div>
    </Link>
  );
}
