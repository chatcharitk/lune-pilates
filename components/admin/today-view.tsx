"use client";

// Admin "Today at a glance" (admin-today.jsx): stat tiles, a class timeline with
// capacity bars + attendee avatars, and a roster drawer with per-attendee
// check-in and the class waitlist. All copy is keyed via the admin language
// context; check-in persists through the setCheckIn server action with optimistic
// UI (reverted on failure).

import { useMemo, useState, useTransition } from "react";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, CapBar, Dot, Drawer, Stat } from "./ui";
import { setCheckIn } from "@/app/actions/admin";
import type { AdminTodayClass, AdminTodayOverview } from "@/lib/admin/today";

// ───────────────────────── formatting helpers ─────────────────────────

/** "HH:MM" in the client's local time from an ISO instant. */
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Long, localised date for the header (Buddhist era in Thai via th-TH). */
function longDate(iso: string, lang: "en" | "th"): string {
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

// ───────────────────────── component ─────────────────────────

export function TodayView({ overview }: { overview: AdminTodayOverview }) {
  const { t, tt, lang } = useAdminLang();

  // Optimistic check-in state, keyed by bookingId, seeded from the server roster.
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of overview.classes) {
      for (const a of c.roster) init[a.bookingId] = a.checkedIn;
    }
    return init;
  });
  // Manual waitlist "Notify" nudge — local for now; an entry already `offered`
  // counts as notified. Wiring the button to the LINE adapter / re-offer is a
  // follow-up; the automated offer flow runs via the cron sweep.
  const [notified, setNotified] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const open = overview.classes.find((c) => c.id === openId) ?? null;

  const totalChecked = useMemo(
    () => Object.values(checks).filter(Boolean).length,
    [checks],
  );

  function toggleCheck(bookingId: string) {
    const next = !checks[bookingId];
    setChecks((prev) => ({ ...prev, [bookingId]: next })); // optimistic
    startTransition(async () => {
      const res = await setCheckIn({ bookingId, checkedIn: next });
      if (!res.ok) {
        setChecks((prev) => ({ ...prev, [bookingId]: !next })); // revert
      }
    });
  }

  const checkedInClass = (c: AdminTodayClass) =>
    c.roster.filter((a) => checks[a.bookingId]).length;

  return (
    <div>
      <header className="mb-5">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("admin_overview")}
        </h1>
        <p className="mt-1 font-body text-[13.5px] text-muted">{longDate(overview.date, lang)}</p>
      </header>

      {/* stat tiles */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t("classes_today")} value={overview.stats.classes} />
        <Stat
          label={t("attendees")}
          value={overview.stats.attendees}
          sub={`/ ${overview.stats.capacity}`}
        />
        <Stat
          label={t("checked_in")}
          value={totalChecked}
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
            const checked = checkedInClass(c);
            const allChecked = c.booked > 0 && checked === c.booked;
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
                          <Avatar name={a.name} seed={a.userId} size={30} checked={checks[a.bookingId]} />
                        </span>
                      ))}
                    </div>
                    <Badge tone={allChecked ? "green" : "neutral"}>
                      {checked}/{c.booked} {t("checked_in")}
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

      {/* roster drawer */}
      <Drawer
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? `${tt(open.typeMeta.label)} · ${hhmm(open.startsAt)}` : ""}
      >
        {open && (
          <div>
            {/* instructor header */}
            {open.instructor && (
              <div className="mb-5 flex items-center gap-3 rounded-2xl bg-cream-2 px-3.5 py-3">
                <Avatar
                  name={tt(open.instructor.name)}
                  seed={open.instructor.id}
                  initials={open.instructor.id.charAt(0)}
                  size={36}
                />
                <div>
                  <p className="font-body text-[13.5px] font-semibold text-ink">
                    {tt(open.instructor.name)}
                  </p>
                  <p className="font-body text-xs text-muted tabular-nums">
                    {hhmm(open.startsAt)}–{hhmm(open.endsAt)} · {open.durationMin} {t("min")}
                  </p>
                </div>
              </div>
            )}

            {/* roster */}
            <p className="mb-2.5 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {t("roster")} · {open.booked}/{open.capacity}
            </p>
            <ul className="flex flex-col gap-2">
              {open.roster.map((a) => {
                const isChecked = checks[a.bookingId];
                return (
                  <li
                    key={a.bookingId}
                    className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${
                      isChecked ? "border-sage/30 bg-sage/8" : "border-line bg-surface-2"
                    }`}
                  >
                    <Avatar name={a.name} seed={a.userId} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-body text-sm font-semibold text-ink">
                          {a.name}
                        </span>
                        <Badge tone="neutral">{a.isMember ? t("member") : t("guest")}</Badge>
                      </div>
                      <p className="font-body text-xs text-muted">
                        {a.phone}
                        {a.house ? ` · ${t("house_label")} ${a.house}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleCheck(a.bookingId)}
                      aria-pressed={isChecked}
                      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 font-body text-[13px] font-semibold transition-colors ${
                        isChecked
                          ? "bg-sage text-white"
                          : "border border-line-strong text-ink"
                      }`}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {isChecked ? t("checked") : t("check_in")}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* waitlist */}
            {open.waitlist.length > 0 && (
              <div className="mt-5">
                <p className="mb-2.5 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#9a7b45]">
                  {t("waitlist")} · {open.waitlist.length}
                </p>
                <ul className="flex flex-col gap-2">
                  {open.waitlist.map((w) => {
                    const isNotified = w.offered || notified[w.waitlistId];
                    return (
                      <li
                        key={w.waitlistId}
                        className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-3 py-2.5"
                      >
                        <span className="w-4 shrink-0 text-center font-head text-sm font-bold text-muted tabular-nums">
                          {w.position}
                        </span>
                        <Avatar name={w.name} seed={w.userId} size={34} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-body text-[13.5px] font-semibold text-ink">
                            {w.name}
                          </p>
                          <p className="font-body text-xs text-muted">{w.phone}</p>
                        </div>
                        <button
                          type="button"
                          disabled={isNotified}
                          onClick={() =>
                            setNotified((prev) => ({ ...prev, [w.waitlistId]: true }))
                          }
                          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 font-body text-[13px] font-semibold ${
                            isNotified
                              ? "text-sage-deep"
                              : "border border-line-strong text-ink"
                          }`}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
                          </svg>
                          {isNotified ? t("notified") : t("notify")}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
