"use client";

// Admin "Today at a glance" (admin-today.jsx): stat tiles and a class timeline
// with capacity bars + attendee avatars. Tapping a class opens the SHARED
// ClassRosterDrawer (the same one the Schedule screen uses), so check-in,
// reformer-position changes, cancellation and waitlist all behave identically
// everywhere — one roster surface, no drift. The drawer refreshes server data
// after each action, which keeps these cards' counts live too.

import { useState } from "react";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, CapBar, Dot, Stat } from "./ui";
import { ClassRosterDrawer } from "./class-roster-drawer";
import type { AdminTodayOverview } from "@/lib/admin/today";
import { formatStudioDate, formatStudioTime } from "@/lib/time";

// ───────────────────────── formatting helpers ─────────────────────────

/** "HH:MM" Bangkok (studio) time from an ISO instant. */
function hhmm(iso: string): string {
  return formatStudioTime(new Date(iso));
}

/** Long, localised date for the header (Buddhist era in Thai), in Bangkok time. */
function longDate(iso: string, lang: "en" | "th"): string {
  return formatStudioDate(new Date(iso), lang, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ───────────────────────── component ─────────────────────────

export function TodayView({ overview }: { overview: AdminTodayOverview }) {
  const { t, tt, lang } = useAdminLang();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <header className="mb-5">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("admin_overview")}
        </h1>
        <p className="mt-1 font-body text-[13.5px] text-muted">{longDate(overview.date, lang)}</p>
      </header>

      {/* stat tiles */}
      <section className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        <Stat label={t("classes_today")} value={overview.stats.classes} />
        <Stat
          label={t("attendees")}
          value={overview.stats.attendees}
          sub={`/ ${overview.stats.capacity}`}
        />
        <Stat
          label={t("checked_in")}
          value={overview.stats.checkedIn}
          accent="var(--color-sage-deep)"
        />
        <Stat
          label={t("on_waitlist")}
          value={overview.stats.waitlisted}
          accent={overview.stats.waitlisted ? "#9a7b45" : undefined}
        />
        <Stat label={t("utilisation")} value={`${overview.stats.utilisation}%`} />
      </section>

      {/* class timeline */}
      {overview.classes.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
          {t("no_classes_today")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {overview.classes.map((c) => {
            const allChecked = c.booked > 0 && c.checkedIn === c.booked;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className="flex w-full items-center gap-4 rounded-2xl border border-line bg-surface-2 px-4 py-3.5 text-left shadow-soft transition-colors hover:border-line-strong"
                >
                  {/* time block */}
                  <div className="w-12 shrink-0">
                    <p className="font-head text-[15px] font-bold leading-none text-ink tabular-nums">
                      {hhmm(c.startsAt)}
                    </p>
                    <p className="mt-1 font-body text-[11.5px] text-muted tabular-nums">
                      {hhmm(c.endsAt)}
                    </p>
                  </div>

                  {/* main */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Dot type={c.type} />
                      <span className="font-head text-[15px] font-semibold text-ink">
                        {tt(c.typeMeta.label)}
                      </span>
                      {c.instructor && (
                        <span className="inline-flex items-center gap-1.5 font-body text-[12.5px] text-ink-soft">
                          <Avatar
                            name={tt(c.instructor.name)}
                            seed={c.instructor.id}
                            initials={c.instructor.id.charAt(0)}
                            size={20}
                          />
                          {tt(c.instructor.name)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="max-w-[160px] flex-1">
                        <CapBar booked={c.booked} cap={c.capacity} />
                      </span>
                      <span
                        className={`font-body text-xs font-semibold tabular-nums ${
                          c.full ? "text-muted" : "text-sage-deep"
                        }`}
                      >
                        {c.booked}/{c.capacity}
                      </span>
                      {c.waitlist.length > 0 && (
                        <Badge tone="amber">
                          +{c.waitlist.length} {t("waitlist")}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* attendee avatars + check status */}
                  <div className="hidden shrink-0 items-center gap-3 sm:flex">
                    <div className="flex">
                      {c.roster.slice(0, 3).map((a, i) => (
                        <span
                          key={a.bookingId}
                          className="rounded-full border-2 border-surface-2"
                          style={{ marginLeft: i ? -8 : 0 }}
                        >
                          <Avatar name={a.name} seed={a.userId} size={30} checked={a.checkedIn} />
                        </span>
                      ))}
                    </div>
                    <Badge tone={allChecked ? "green" : "neutral"}>
                      {c.checkedIn}/{c.booked} {t("checked_in")}
                    </Badge>
                  </div>
                  <svg className="shrink-0 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* shared roster drawer (check-in / position / cancel / waitlist) */}
      <ClassRosterDrawer classId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
