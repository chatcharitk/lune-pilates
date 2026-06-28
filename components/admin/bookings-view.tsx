"use client";

// Admin "Bookings & waitlist control" (admin-more.jsx BookingsAdminScreen + spec
// §4). Two tabs via a Segmented tablist:
//   - All bookings: a responsive table (Member · Schedule · Status · detail). A row
//     opens a Drawer with the booking detail and a Cancel action; for an upcoming
//     booking the drawer surfaces the server's cancellation verdict (free vs keeps
//     the cost) and an admin refund-override.
//   - Waitlist: full classes grouped into cards, each listing its FIFO queue with a
//     live "{mins}m confirm window" badge (when offered) or a Notify button.
// All copy is keyed via the admin language context; all money/seat/policy decisions
// are the server's — this view only renders state and fires the typed actions, then
// router.refresh()es. It imports ONLY action functions + erased types, never the DB
// read model, so no server-only code leaks into the client bundle.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Dot, Drawer, Segmented } from "./ui";
import {
  adminCancelBooking,
  adminOfferWaitlistSeat,
  adminReschedule,
} from "@/app/actions/admin-bookings";
import type {
  AdminBooking,
  AdminBookingsOverview,
  AdminWaitlistClass,
} from "@/lib/admin/bookings";
import type { BookableClass } from "@/lib/schedule/queries";
import type { StrKey } from "@/lib/i18n";

type Tab = "bookings" | "waitlist";

// ───────────────────────── helpers ─────────────────────────

/** Localised "day · time" for a booking row (Today / Tomorrow / weekday + date). */
function dayTime(iso: string, time: string, lang: "en" | "th"): string {
  const start = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const deltaDays = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);
  let day: string;
  if (deltaDays === 0) day = lang === "th" ? "วันนี้" : "Today";
  else if (deltaDays === 1) day = lang === "th" ? "พรุ่งนี้" : "Tomorrow";
  else {
    day = new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(start);
  }
  return `${day} · ${time}`;
}

/** Whole-credit display: integer credits rendered as-is (e.g. 2 → "2"). */
function fmtCredits(n: number): string {
  return String(n);
}

// ───────────────────────── component ─────────────────────────

export function BookingsView({
  overview,
  bookable,
}: {
  overview: AdminBookingsOverview;
  /** This week's published classes — the candidate pool for the admin reschedule
   *  picker. The action re-validates server-side; this only populates the list. */
  bookable: BookableClass[];
}) {
  const { t } = useAdminLang();
  const [tab, setTab] = useState<Tab>("bookings");
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: StrKey; cost?: string } | null>(null);

  const open = useMemo(
    () => overview.bookings.find((b) => b.bookingId === openId) ?? null,
    [overview.bookings, openId],
  );

  function flash(key: StrKey, cost?: string) {
    setToast({ key, cost });
    window.setTimeout(() => setToast(null), 3200);
  }

  const tabs: { value: Tab; label: string; tabId: string; panelId: string }[] = [
    { value: "bookings", label: t("all_bookings"), tabId: "tab-bookings", panelId: "panel-bookings" },
    { value: "waitlist", label: t("waitlist"), tabId: "tab-waitlist", panelId: "panel-waitlist" },
  ];

  return (
    <div>
      <header className="mb-5">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("admin_bookings")}
        </h1>
      </header>

      <Segmented value={tab} onChange={setTab} options={tabs} ariaLabel={t("admin_bookings")} />

      {/* toast */}
      {toast && (
        <div
          role="status"
          className="mt-4 rounded-xl bg-sage/15 px-4 py-2.5 font-body text-[13px] font-semibold text-sage-deep"
        >
          {toast.cost ? t(toast.key).replace("{cost}", toast.cost) : t(toast.key)}
        </div>
      )}

      {tab === "bookings" ? (
        <BookingsTable
          id="panel-bookings"
          labelledBy="tab-bookings"
          bookings={overview.bookings}
          onOpen={setOpenId}
        />
      ) : (
        <WaitlistPanel
          id="panel-waitlist"
          labelledBy="tab-waitlist"
          classes={overview.waitlist}
          onNotified={flash}
        />
      )}

      {/* booking detail + cancel/reschedule drawer */}
      <BookingDrawer
        booking={open}
        bookable={bookable}
        onClose={() => setOpenId(null)}
        onResult={(key, cost) => {
          setOpenId(null);
          flash(key, cost);
        }}
      />
    </div>
  );
}

// ───────────────────────── all-bookings table ─────────────────────────

const STATUS_LABEL: Record<string, StrKey> = {
  booked: "booked",
  cancelled: "cancelled_label",
};

function BookingsTable({
  id,
  labelledBy,
  bookings,
  onOpen,
}: {
  id: string;
  labelledBy: string;
  bookings: AdminBooking[];
  onOpen: (bookingId: string) => void;
}) {
  const { t, tt, lang } = useAdminLang();

  if (bookings.length === 0) {
    return (
      <div id={id} role="tabpanel" aria-labelledby={labelledBy} className="mt-[18px]">
        <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
          {t("no_bookings")}
        </p>
      </div>
    );
  }

  // Grid: Member · Schedule · Status · chevron. The phone (secondary) and the
  // detail-chevron column collapse on small screens (prototype's admin-hide-sm /
  // dropped 4th column) — the whole row stays tappable, so the chevron is decorative.
  const grid =
    "grid grid-cols-[1.6fr_1fr_auto] sm:grid-cols-[2fr_1.4fr_1fr_40px] items-center gap-3";

  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className="mt-[18px] overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-soft"
    >
      {/* header */}
      <div
        className={`${grid} border-b border-line bg-surface px-[18px] py-3 font-body text-[11px] font-semibold uppercase tracking-[0.06em] text-muted`}
      >
        <span>{t("member")}</span>
        <span>{t("schedule_col")}</span>
        <span className="hidden sm:block">{t("status")}</span>
        <span className="sr-only sm:hidden">{t("status")}</span>
        <span aria-hidden className="hidden sm:block" />
      </div>

      {/* rows */}
      <ul>
        {bookings.map((b) => {
          // Prototype: checked/confirmed → green, else neutral. A checked-in, live
          // booking reads as "confirmed" (green); otherwise the raw status label.
          const confirmed = b.checkedIn && b.status === "booked";
          const tone = confirmed ? "green" : "neutral";
          const statusKey: StrKey = confirmed
            ? "confirmed"
            : STATUS_LABEL[b.status] ?? "booked";
          return (
            <li key={b.bookingId}>
              <button
                type="button"
                onClick={() => onOpen(b.bookingId)}
                className={`${grid} w-full border-b border-line px-[18px] py-3 text-left transition-colors last:border-b-0 hover:bg-surface`}
              >
                {/* member */}
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={b.customer.name} seed={b.customer.userId} size={34} />
                  <span className="min-w-0">
                    <span className="block truncate font-body text-sm font-semibold text-ink">
                      {b.customer.name}
                    </span>
                    <span className="hidden font-body text-xs text-muted sm:block">
                      {b.customer.phone}
                    </span>
                  </span>
                </span>

                {/* schedule */}
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <Dot type={b.class.type} size={7} />
                    <span className="truncate font-body text-[13.5px] font-semibold text-ink">
                      {tt(b.class.typeMeta.short)}
                    </span>
                  </span>
                  <span className="block truncate font-body text-xs text-muted">
                    {dayTime(b.class.startsAt, b.class.time, lang)}
                  </span>
                </span>

                {/* status */}
                <span className="justify-self-start sm:justify-self-auto">
                  <Badge tone={tone}>{t(statusKey)}</Badge>
                </span>

                {/* detail chevron (desktop column only; row is tappable everywhere) */}
                <span aria-hidden className="hidden justify-self-end text-muted sm:block">
                  <ChevR />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ───────────────────────── waitlist panel ─────────────────────────

function WaitlistPanel({
  id,
  labelledBy,
  classes,
  onNotified,
}: {
  id: string;
  labelledBy: string;
  classes: AdminWaitlistClass[];
  onNotified: (key: StrKey) => void;
}) {
  const { t } = useAdminLang();

  if (classes.length === 0) {
    return (
      <div id={id} role="tabpanel" aria-labelledby={labelledBy} className="mt-[18px]">
        <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
          {t("no_waitlist")}
        </p>
      </div>
    );
  }

  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className="mt-[18px] flex flex-col gap-3"
    >
      {classes.map((c) => (
        <WaitlistCard key={c.classInstanceId} cls={c} onNotified={onNotified} />
      ))}
    </div>
  );
}

function WaitlistCard({
  cls,
  onNotified,
}: {
  cls: AdminWaitlistClass;
  onNotified: (key: StrKey) => void;
}) {
  const { t, tt, lang } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Whether any entry already holds a live offer — Notify targets the FIFO head, so
  // hide the button while a hold is live (the backend would no-op with NO_QUEUE_HEAD).
  const hasLiveOffer = cls.entries.some((e) => e.status === "offered");

  function notify() {
    startTransition(async () => {
      const res = await adminOfferWaitlistSeat({ classInstanceId: cls.classInstanceId });
      if (res.ok) {
        onNotified("toast_notified");
        router.refresh();
      } else {
        onNotified(res.code === "NO_QUEUE_HEAD" ? "toast_notify_no_head" : "toast_notify_failed");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-line bg-surface-2 p-[18px] shadow-soft">
      {/* class header */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Dot type={cls.type} size={8} />
        <h2 className="font-head text-base font-semibold text-ink">{tt(cls.typeMeta.label)}</h2>
        <span className="font-body text-[13px] text-muted">
          {dayTime(cls.startsAt, cls.time, lang)}
        </span>
        <Badge tone="rose">{t("full")}</Badge>
      </div>

      {/* FIFO queue */}
      <ul className="flex flex-col gap-2">
        {cls.entries.map((w) => {
          const offered = w.status === "offered";
          // Entries are returned in FIFO order, so the head is simply the first row.
          const isHead = cls.entries[0]?.waitlistId === w.waitlistId;
          return (
            <li
              key={w.waitlistId}
              className={`flex items-center gap-3 rounded-[13px] border px-3 py-2.5 ${
                offered
                  ? "border-[rgba(193,160,121,0.32)] bg-[rgba(193,160,121,0.1)]"
                  : "border-line bg-surface"
              }`}
            >
              <span className="w-4 shrink-0 text-center font-head text-sm font-bold text-muted tabular-nums">
                {w.position}
              </span>
              <Avatar name={w.name} seed={w.userId} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-sm font-semibold text-ink">{w.name}</p>
                <p className="truncate font-body text-xs text-muted">
                  {(w.isMember ? t("member") : t("guest"))} · {w.phone}
                </p>
              </div>

              {offered && w.minutesLeft !== null ? (
                <Badge tone="amber">
                  <Clock />
                  {w.minutesLeft}m {t("confirm_window")}
                </Badge>
              ) : (
                // Notify offers the seat to the FIFO head only; show it on the head
                // when no live offer exists. Other waiting rows simply queue.
                isHead && !hasLiveOffer && (
                  <button
                    type="button"
                    onClick={notify}
                    disabled={pending}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-surface-2 px-3.5 font-body text-[13px] font-semibold text-ink disabled:opacity-50"
                  >
                    <Bell />
                    {t("notify")}
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ───────────────────────── booking detail + cancel drawer ─────────────────────────

type DrawerMode = "detail" | "reschedule";

function BookingDrawer({
  booking,
  bookable,
  onClose,
  onResult,
}: {
  booking: AdminBooking | null;
  bookable: BookableClass[];
  onClose: () => void;
  onResult: (key: StrKey, cost?: string) => void;
}) {
  const { t, tt, lang } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [override, setOverride] = useState(false);
  const [mode, setMode] = useState<DrawerMode>("detail");

  // Reset the goodwill-refund toggle AND the drawer step whenever a DIFFERENT
  // booking opens — the Drawer stays mounted as the open booking switches, so
  // without this the box would carry a stale "refund anyway" across bookings (a
  // money-correctness hazard) and the picker step could leak into the next view.
  useEffect(() => {
    setOverride(false);
    setMode("detail");
  }, [booking?.bookingId]);

  const cancellation = booking?.cancellation ?? null;
  // Cancel + reschedule both show only for an upcoming, still-live booking. The
  // admin reschedule is NOT gated by the 5h window (CLAUDE.md §5 inv 7) — the
  // server skips the window check; here it is offered for any upcoming booking.
  const cancellable = booking?.upcoming === true && booking.status === "booked";

  // Reschedule candidates: same class type, not full, and not the current class —
  // mirrors the (removed) customer reschedule-sheet filtering. The action
  // re-validates capacity/seat under lock; this just curates the picker.
  const candidates = booking
    ? bookable.filter(
        (c) =>
          c.type === booking.class.type &&
          !c.full &&
          c.id !== booking.class.classInstanceId,
      )
    : [];

  function windowPhrase(hours: number): string {
    const key: StrKey = hours === 1 ? "window_hour" : "window_hours";
    return t(key).replace("{n}", String(hours));
  }

  function cancel() {
    if (!booking) return;
    startTransition(async () => {
      const res = await adminCancelBooking({
        bookingId: booking.bookingId,
        // Only pass an explicit override when the front desk ticked the box on a
        // booking the policy would otherwise NOT refund. Otherwise follow the policy.
        ...(override && cancellation && !cancellation.free ? { refund: true } : {}),
      });
      if (res.ok) {
        if (res.outcome.refunded) {
          onResult("toast_cancel_refunded", fmtCredits(booking.creditCost));
        } else {
          onResult("toast_cancel_kept");
        }
        router.refresh();
      } else {
        onResult("toast_cancel_failed");
      }
    });
  }

  function reschedule(newClassInstanceId: string) {
    if (!booking) return;
    startTransition(async () => {
      const res = await adminReschedule({
        bookingId: booking.bookingId,
        newClassInstanceId,
      });
      if (res.ok) {
        onResult("toast_reschedule_done");
        router.refresh();
      } else {
        onResult("toast_reschedule_failed");
      }
    });
  }

  // Remount the drawer body per booking so transient field state can't bleed
  // across bookings (the override toggle + mode are also reset via the effect).
  const openKey = booking?.bookingId ?? null;

  return (
    <Drawer
      open={booking !== null}
      onClose={onClose}
      title={mode === "reschedule" ? t("resched_admin_title") : t("booking_detail")}
      footer={
        mode === "reschedule" ? (
          <button
            type="button"
            onClick={() => setMode("detail")}
            disabled={pending}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface-2 px-5 font-body text-sm font-semibold text-ink disabled:opacity-50"
          >
            {t("back")}
          </button>
        ) : cancellable ? (
          <>
            <button
              type="button"
              onClick={() => setMode("reschedule")}
              disabled={pending}
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface-2 px-5 font-body text-sm font-semibold text-ink disabled:opacity-50"
            >
              {t("reschedule_booking")}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
            >
              {t("cancel_booking")}
            </button>
          </>
        ) : undefined
      }
    >
      {booking && mode === "reschedule" ? (
        <RescheduleStep
          key={openKey ?? "none"}
          candidates={candidates}
          pending={pending}
          onPick={reschedule}
        />
      ) : booking ? (
        <div key={openKey ?? "none"} className="flex flex-col gap-5">
          {/* customer */}
          <section>
            <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {t("customer")}
            </p>
            <div className="flex items-center gap-3 rounded-2xl bg-cream-2 px-3.5 py-3">
              <Avatar name={booking.customer.name} seed={booking.customer.userId} size={40} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-body text-sm font-semibold text-ink">
                    {booking.customer.name}
                  </span>
                  <Badge tone="neutral">
                    {booking.customer.isMember ? t("member") : t("guest")}
                  </Badge>
                </div>
                <p className="font-body text-xs text-muted">
                  {booking.customer.phone}
                  {booking.customer.house ? ` · ${t("house_label")} ${booking.customer.house}` : ""}
                </p>
              </div>
            </div>
          </section>

          {/* class */}
          <section>
            <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {t("class_label")}
            </p>
            <div className="rounded-2xl border border-line bg-surface-2 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Dot type={booking.class.type} />
                <span className="font-head text-[15px] font-semibold text-ink">
                  {tt(booking.class.typeMeta.label)}
                </span>
                {booking.class.instructor && (
                  <span className="inline-flex items-center gap-1.5 font-body text-[12.5px] text-ink-soft">
                    <Avatar
                      name={tt(booking.class.instructor.name)}
                      seed={booking.class.instructor.id}
                      initials={booking.class.instructor.id.charAt(0)}
                      size={20}
                    />
                    {tt(booking.class.instructor.name)}
                  </span>
                )}
              </div>
              <p className="mt-1.5 font-body text-[13px] text-muted">
                {dayTime(booking.class.startsAt, booking.class.time, lang)}
              </p>
            </div>
          </section>

          {/* meta: cost + check-in */}
          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line bg-surface-2 px-3.5 py-3">
              <p className="font-body text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">
                {t("credit_cost")}
              </p>
              <p className="mt-1 font-head text-lg font-bold text-ink tabular-nums">
                {fmtCredits(booking.creditCost)}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-surface-2 px-3.5 py-3">
              <p className="font-body text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">
                {t("status")}
              </p>
              <p className="mt-1.5">
                <Badge tone={booking.checkedIn ? "green" : "neutral"}>
                  {booking.checkedIn ? t("checked_in_label") : t("not_checked_in")}
                </Badge>
              </p>
            </div>
          </section>

          {/* cancellation eligibility (upcoming only) */}
          {cancellable && cancellation && (
            <section>
              <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                {t("policy_title")}
              </p>
              {cancellation.free ? (
                <div className="rounded-2xl bg-sage/12 px-3.5 py-3 font-body text-[13px] text-sage-deep">
                  {t("cancel_free_note").replace(
                    "{cost}",
                    fmtCredits(cancellation.refundCredits),
                  )}
                </div>
              ) : (
                <>
                  <div className="rounded-2xl bg-rose/12 px-3.5 py-3 font-body text-[13px] text-[#a56a52]">
                    {t("cancel_keep_note")
                      .replace("{hours}", windowPhrase(cancellation.freeCancelHours))
                      .replace("{cost}", fmtCredits(booking.creditCost))}
                  </div>
                  {/* admin goodwill override — refund despite the policy */}
                  <label className="mt-2.5 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-line bg-surface-2 px-3.5 py-3">
                    <input
                      type="checkbox"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-sage-deep)]"
                    />
                    <span>
                      <span className="block font-body text-[13.5px] font-semibold text-ink">
                        {t("refund_override")}
                      </span>
                      <span className="block font-body text-xs text-muted">
                        {t("refund_override_hint")}
                      </span>
                    </span>
                  </label>
                </>
              )}
            </section>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}

// ───────────────────────── reschedule step (admin slot picker) ─────────────────────────
// Renders the same-type, not-full candidate classes for an admin to move a
// customer's booking to (CLAUDE.md §5 inv 7 admin path). NOT bound by the 5h
// window — the action skips that check. Picking a slot fires adminReschedule.

function RescheduleStep({
  candidates,
  pending,
  onPick,
}: {
  candidates: BookableClass[];
  pending: boolean;
  onPick: (newClassInstanceId: string) => void;
}) {
  const { t, tt, lang } = useAdminLang();

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-[13px] text-ink-soft">{t("resched_admin_pick")}</p>

      {candidates.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface-2 p-6 text-center font-body text-sm text-muted">
          {t("no_other_times")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c.id)}
                disabled={pending}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3.5 py-3 text-left transition-colors hover:bg-surface disabled:opacity-50"
              >
                <Dot type={c.type} size={8} />
                <span className="min-w-0 flex-1">
                  <span className="block font-head text-[14.5px] font-semibold text-ink">
                    {tt(c.typeMeta.short)}
                  </span>
                  <span className="block truncate font-body text-xs text-muted">
                    {dayTime(c.startsAt, hhmmOf(c.startsAt), lang)}
                    {c.instructor ? ` · ${tt(c.instructor.name)}` : ""}
                  </span>
                </span>
                <span className="shrink-0">
                  <Badge tone="neutral">
                    {c.seatsLeft} {c.seatsLeft === 1 ? t("spot_left") : t("spots_left")}
                  </Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Local "HH:MM" from a class ISO start (for the candidate row's day · time). */
function hhmmOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ───────────────────────── icons ─────────────────────────

function ChevR() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function Clock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function Bell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

// TODO(stretch): "Book for customer" via adminBookForCustomer — the prototype does
// not surface a manual-booking entry on this screen, so it is intentionally omitted
// (the action contract exists for when a UI for it is designed).
