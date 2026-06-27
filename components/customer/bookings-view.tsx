"use client";

// Interactive shell for the customer "My Bookings" screen (mirrors
// lune-pilates/project/lune-extra.jsx — BookingsScreen + BookingCard). It takes
// the already-fetched, server-shaped MyBookings split (upcoming / past) and only
// handles display: the Upcoming/Past segmented tab and opening the cancel sheet
// for an upcoming booking. No business logic — the policy hint on each card and
// the refund decision come from the backend (booking.cancellation /
// cancelBookingAction).

import { useId, useState } from "react";
import type { MyBooking, MyBookings } from "@/lib/bookings/queries";
import type { BookableClass } from "@/lib/schedule/queries";
import type { MyWaitlistEntry } from "@/lib/waitlist/queries";
import { makeT, type Lang } from "@/lib/i18n";
import { useCustomerLang } from "./customer-context";
import {
  classDateLabel,
  endTime,
  hhmm,
  POSITION_KEY,
  TYPE_DOT,
  windowHoursLabel,
} from "./schedule-helpers";
import { Check, Clock, Info, Users } from "./icons";
import { CancelSheet } from "./cancel-sheet";
import { RescheduleSheet } from "./reschedule-sheet";
import { WaitlistCard } from "./waitlist-card";

type Tab = "upcoming" | "past";

export function BookingsView({
  bookings,
  bookable,
  waitlist,
}: {
  bookings: MyBookings;
  /** Bookable slots this week, for the reschedule slot picker (server-fetched). */
  bookable: BookableClass[];
  /**
   * The viewer's live waitlist entries (waiting/offered; stale offers already
   * downgraded to expired server-side). Shown in their own section on the
   * Upcoming tab — these are NOT bookings (CLAUDE.md §5 invariant 6).
   */
  waitlist: MyWaitlistEntry[];
}) {
  const { t, lang } = useCustomerLang();
  const [tab, setTab] = useState<Tab>("upcoming");
  // The upcoming booking whose cancel sheet is open (null = closed).
  const [cancelling, setCancelling] = useState<MyBooking | null>(null);
  // The upcoming booking whose reschedule sheet is open (null = closed).
  const [rescheduling, setRescheduling] = useState<MyBooking | null>(null);

  // Stable, unique tab/panel ids so each tab's aria-controls points at its panel
  // and each panel's aria-labelledby points back at its tab (matches the admin
  // Segmented pattern; finding A2).
  const baseId = useId();
  const TABS: Tab[] = ["upcoming", "past"];
  const tabId = (k: Tab) => `${baseId}-tab-${k}`;
  const panelId = (k: Tab) => `${baseId}-panel-${k}`;

  const list = tab === "upcoming" ? bookings.upcoming : bookings.past;

  // Roving arrow-key navigation across the two tabs (WAI-ARIA tablist), mirroring
  // the admin Segmented control.
  function onTabKeyDown(e: React.KeyboardEvent) {
    const idx = TABS.indexOf(tab);
    if (idx < 0) return;
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next]!);
  }

  return (
    <div className="px-[22px] pb-7 pt-1.5">
      <h1 className="mb-3.5 mt-1 font-head text-3xl font-medium tracking-[0.01em] text-ink">
        {t("my_bookings")}
      </h1>

      {/* segmented control */}
      <div
        role="tablist"
        aria-label={t("my_bookings")}
        onKeyDown={onTabKeyDown}
        className="mb-5 flex gap-1 rounded-full bg-cream-2 p-1"
      >
        {TABS.map((k) => {
          const on = tab === k;
          return (
            <button
              key={k}
              id={tabId(k)}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={panelId(k)}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(k)}
              className={`flex-1 rounded-full px-2.5 py-2.5 font-body text-[13.5px] font-semibold transition-all ${
                on ? "bg-surface-2 text-ink shadow-soft" : "bg-transparent text-muted"
              }`}
            >
              {t(k)}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {tab === "upcoming" && (
          <div className="mb-4 flex items-start gap-3 rounded-lune-sm bg-cream-2 px-[15px] py-3.5">
            <span className="mt-px shrink-0 text-taupe-deep">
              <Info size={18} />
            </span>
            <p className="m-0 font-body text-[12.5px] leading-[1.5] text-ink-soft">
              {t("policy_body")}
            </p>
          </div>
        )}

        {list.length === 0 ? (
          <EmptyState
            message={tab === "upcoming" ? t("no_upcoming_bookings") : t("no_past_bookings")}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((b) => (
              <BookingCard
                key={b.bookingId}
                lang={lang}
                booking={b}
                past={tab === "past"}
                onCancel={() => setCancelling(b)}
                onReschedule={() => setRescheduling(b)}
              />
            ))}
          </div>
        )}

        {/* waitlist section — only on the Upcoming tab; a waitlist entry is a
            forward-looking queue spot, never a booking (CLAUDE.md §5 invariant 6).
            Hidden entirely when the viewer has no live entries. */}
        {tab === "upcoming" && waitlist.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-3 font-body text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              {t("waitlist_section")}
            </h2>
            <div className="flex flex-col gap-3">
              {waitlist.map((w) => (
                <WaitlistCard key={w.waitlistId} lang={lang} entry={w} />
              ))}
            </div>
          </section>
        )}
      </div>

      <CancelSheet
        lang={lang}
        booking={cancelling}
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
      />
      <RescheduleSheet
        lang={lang}
        booking={rescheduling}
        bookable={bookable}
        open={rescheduling !== null}
        onClose={() => setRescheduling(null)}
      />
    </div>
  );
}

// ───────────────────────── booking card ─────────────────────────

function BookingCard({
  lang,
  booking,
  past,
  onCancel,
  onReschedule,
}: {
  lang: Lang;
  booking: MyBooking;
  past: boolean;
  onCancel: () => void;
  onReschedule: () => void;
}) {
  const { t, tt } = makeT(lang);
  const cancelled = booking.status === "cancelled";
  const dateStr = tt(classDateLabel(booking.startsAt));
  const timeRange = `${hhmm(booking.startsAt)}–${endTime(booking.startsAt, booking.durationMin)}`;
  const free = booking.cancellation.free;

  return (
    <div
      className={`rounded-lune border border-line bg-surface-2 px-[18px] py-4 shadow-soft ${
        past ? "opacity-[0.82]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-[7px]">
            <span
              className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ background: TYPE_DOT[booking.type] }}
              aria-hidden="true"
            />
            <span className="font-body text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
              {tt(booking.typeMeta.short)}
            </span>
          </div>
          <div className="font-head text-[21px] font-semibold leading-[1.1] text-ink">
            {tt(booking.typeMeta.label)}
          </div>
          <div className="mt-[7px] flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
            <Clock size={14} />
            <span>
              {dateStr} · {timeRange}
            </span>
          </div>
          {booking.instructor && (
            <div className="mt-1 font-body text-[12.5px] text-muted">
              {t("with_kru")} {tt(booking.instructor.name)}
            </div>
          )}
          {booking.position && (
            <div className="mt-1 flex items-center gap-1.5 font-body text-[12.5px] text-muted">
              <Users size={13} />
              <span>{t(POSITION_KEY[booking.position])}</span>
            </div>
          )}
        </div>

        {/* status badge */}
        <StatusBadge
          lang={lang}
          cancelled={cancelled}
          past={past}
          free={free}
          freeCancelHours={booking.cancellation.freeCancelHours}
        />
      </div>

      {/* upcoming actions — reschedule is a FREE move, allowed only within the
          booking's free window (server-provided cancellation.free). Past the
          window only a cancel-with-deduction remains. */}
      {!past && !cancelled && (
        <div className="mt-3.5 border-t border-line pt-3.5">
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onReschedule}
              disabled={!free}
              aria-disabled={!free}
              className={`flex-1 rounded-lune-sm border px-3 py-2.5 font-body text-[13.5px] font-semibold transition-colors ${
                free
                  ? "border-line bg-transparent text-ink hover:bg-cream-2"
                  : "cursor-not-allowed border-line bg-transparent text-muted"
              }`}
            >
              {t("reschedule")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lune-sm border border-rose/40 bg-transparent px-3 py-2.5 font-body text-[13.5px] font-semibold text-rose transition-colors hover:bg-rose/10"
            >
              {t("cancel")}
            </button>
          </div>
          {!free && (
            <p className="mt-2 font-body text-[11.5px] leading-snug text-muted">
              {t("resched_locked_hint")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  lang,
  cancelled,
  past,
  free,
  freeCancelHours,
}: {
  lang: Lang;
  cancelled: boolean;
  past: boolean;
  free: boolean;
  /** The booking's own free window (5 | 1), for the "Within N hours" hint. */
  freeCancelHours: number;
}) {
  const { t } = makeT(lang);

  if (cancelled) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cream-2 px-2.5 py-[5px] font-body text-[11px] font-semibold text-rose">
        {t("cancelled_label")}
      </span>
    );
  }
  if (past) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sage/15 px-2.5 py-[5px] font-body text-[11px] font-semibold text-sage-deep">
        <Check size={13} />
        {t("completed_label")}
      </span>
    );
  }
  // Upcoming: policy hint (free cancel vs within N hours), from server data —
  // the window N comes from the booking's own freeCancelHours (5 | 1).
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-[5px] font-body text-[11px] font-semibold ${
        free ? "bg-sage/15 text-sage-deep" : "bg-rose/12 text-rose"
      }`}
    >
      {free
        ? t("free_cancel")
        : t("late_cancel").replace("{hours}", windowHoursLabel(freeCancelHours, t))}
    </span>
  );
}

// ───────────────────────── empty state ─────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-5 py-[60px] text-center text-muted">
      <Clock size={26} className="mx-auto mb-3.5 text-line-strong" />
      <p className="m-0 font-head text-base font-medium text-ink-soft">{message}</p>
    </div>
  );
}
