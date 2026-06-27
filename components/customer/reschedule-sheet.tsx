"use client";

// The customer reschedule sheet: a focus-trapped, Escape-dismissable dialog
// opened from an upcoming booking (within its free window) on the My Bookings
// screen. It shows the current booking, then a "Choose a new time" list of
// alternative bookable slots OF THE SAME CLASS TYPE (excluding the current class
// instance and any full slot). Picking one calls `rescheduleBooking`, and on
// success shows a "Class rescheduled" confirmation + router.refresh() so the
// list reflects the move.
//
// Mirrors the Sheet chrome in cancel-sheet.tsx / checkout-panel.tsx (slide-up,
// backdrop, focus trap, Escape, focus restore). It owns NO business logic: the
// free-window eligibility is the server-provided `booking.cancellation.free`,
// the slots come from `listBookableClasses`, and the authoritative move (refund
// old + debit new, net-zero) is performed and re-validated server-side inside
// `rescheduleBooking`. Seat/position selection on reschedule is OUT OF SCOPE —
// the move books without a position (the server assigns availability).

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  rescheduleBooking,
  type RescheduleActionFailureCode,
} from "@/app/actions/booking";
import { makeT, type Lang } from "@/lib/i18n";
import type { StrKey } from "@/lib/i18n/strings";
import type { MyBooking } from "@/lib/bookings/queries";
import type { BookableClass } from "@/lib/schedule/queries";
import { classDateLabel, endTime, hhmm, TYPE_DOT } from "./schedule-helpers";
import { ArrowRight, Check, Clock, Info } from "./icons";

// Lets a step component label the dialog via the sheet's generated id.
const SheetTitleContext = createContext<string>("");

type Phase = "idle" | "submitting" | "done" | "error";

/** Map a reschedule action failure code to friendly, keyed copy. */
function rescheduleErrorKey(code: RescheduleActionFailureCode): StrKey {
  switch (code) {
    case "RESCHEDULE_WINDOW_CLOSED":
    case "NOT_LIVE":
      return "err_resched_window";
    case "CLASS_FULL":
    case "POSITION_TAKEN":
      return "err_resched_full";
    case "NO_USABLE_PACKAGE":
    case "PACKAGE_NOT_FOUND":
    case "NO_CREDITS":
    case "EXPIRED":
      return "err_resched_no_package";
    case "ALREADY_BOOKED":
      return "err_resched_already";
    case "CLASS_NOT_FOUND":
    case "NOT_BOOKABLE":
    case "NOT_FOUND":
      return "err_not_found";
    case "NOT_VISIBLE":
      return "err_not_visible";
    case "INVALID_POSITION":
      return "err_invalid_position";
    case "FORBIDDEN":
    case "INVALID_INPUT":
    default:
      return "err_generic";
  }
}

export function RescheduleSheet({
  lang,
  booking,
  bookable,
  open,
  onClose,
}: {
  lang: Lang;
  booking: MyBooking | null;
  /** Bookable slots this week (server-fetched) the move can target. */
  bookable: BookableClass[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failCode, setFailCode] = useState<RescheduleActionFailureCode | null>(null);
  // The slot currently being booked into, so its row can show a pending state.
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);

  // Reset the flow whenever a fresh booking is opened, so a previous move's
  // "done"/error state never leaks into the next sheet.
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setFailCode(null);
      setPendingSlotId(null);
    }
  }, [open, booking?.bookingId]);

  // Alternatives: same class type, not the current class instance, not full.
  // Sorted by start (listBookableClasses already returns start-ordered).
  const slots = useMemo(() => {
    if (!booking) return [];
    return bookable.filter(
      (c) => c.type === booking.type && c.id !== booking.classInstanceId && !c.full,
    );
  }, [booking, bookable]);

  async function pick(slot: BookableClass) {
    if (!booking || phase === "submitting") return;
    setPhase("submitting");
    setFailCode(null);
    setPendingSlotId(slot.id);
    // Seat/position selection on reschedule is out of scope — book without a
    // position; the server assigns from availability.
    const res = await rescheduleBooking({
      bookingId: booking.bookingId,
      newClassInstanceId: slot.id,
    });
    if (res.ok) {
      setPhase("done");
      // Re-fetch the server component so the moved booking shows its new time.
      router.refresh();
    } else {
      setFailCode(res.code);
      setPhase("error");
      setPendingSlotId(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      {booking &&
        (phase === "done" ? (
          <RescheduledDone lang={lang} onDone={onClose} />
        ) : (
          <RescheduleContent
            lang={lang}
            booking={booking}
            slots={slots}
            phase={phase}
            failCode={failCode}
            pendingSlotId={pendingSlotId}
            onPick={pick}
            onKeep={onClose}
          />
        ))}
    </Sheet>
  );
}

// ───────────────────────── reschedule content (summary + slot picker) ─────────────────────────

function RescheduleContent({
  lang,
  booking,
  slots,
  phase,
  failCode,
  pendingSlotId,
  onPick,
  onKeep,
}: {
  lang: Lang;
  booking: MyBooking;
  slots: BookableClass[];
  phase: Phase;
  failCode: RescheduleActionFailureCode | null;
  pendingSlotId: string | null;
  onPick: (slot: BookableClass) => void;
  onKeep: () => void;
}) {
  const { t, tt } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    if (phase === "error") errorRef.current?.focus();
  }, [phase]);

  const currentDate = tt(classDateLabel(booking.startsAt));
  const currentRange = `${hhmm(booking.startsAt)}–${endTime(
    booking.startsAt,
    booking.durationMin,
  )}`;
  const submitting = phase === "submitting";

  return (
    <div>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-4 mt-1.5 font-head text-[26px] font-semibold tracking-[0.01em] text-ink outline-none"
      >
        {t("resched_title")}
      </h2>

      {/* current booking summary (mirrors SummaryCard) */}
      <div className="rounded-lune-sm border border-line bg-surface-2 px-[15px] py-3.5 shadow-soft">
        <div className="mb-1 flex items-center gap-1.5">
          <span
            className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: TYPE_DOT[booking.type] }}
            aria-hidden="true"
          />
          <span className="font-body text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted">
            {t("current_time")}
          </span>
        </div>
        <div className="font-head text-[19px] font-semibold leading-[1.1] text-ink">
          {tt(booking.typeMeta.label)}
        </div>
        <div className="mt-1 font-body text-[12.5px] text-ink-soft">
          {currentDate} · {currentRange}
          {booking.instructor ? ` · ${tt(booking.instructor.name)}` : ""}
        </div>
      </div>

      {/* error alert */}
      {phase === "error" && failCode && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mt-3 flex items-start gap-3 rounded-lune-sm border border-rose/40 bg-rose/10 px-4 py-3.5 outline-none"
        >
          <span className="mt-0.5 shrink-0 text-rose">
            <Info size={18} />
          </span>
          <p className="font-body text-[13.5px] leading-snug text-ink">
            {t(rescheduleErrorKey(failCode))}
          </p>
        </div>
      )}

      {/* slot picker */}
      <div className="mb-2 mt-[18px] font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
        {t("resched_pick")}
      </div>

      {slots.length === 0 ? (
        <div className="rounded-lune-sm border border-line bg-surface-2 px-4 py-8 text-center">
          <Clock size={22} className="mx-auto mb-2.5 text-line-strong" />
          <p className="m-0 font-body text-[13.5px] font-medium text-ink-soft">
            {t("no_other_times")}
          </p>
        </div>
      ) : (
        <ul
          aria-label={t("resched_pick")}
          aria-busy={submitting}
          className="flex flex-col gap-2.5"
        >
          {slots.map((slot) => (
            <li key={slot.id}>
              <SlotButton
                slot={slot}
                lang={lang}
                disabled={submitting}
                pending={pendingSlotId === slot.id}
                onPick={() => onPick(slot)}
              />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onKeep}
        disabled={submitting}
        className="mt-3.5 w-full py-3 font-body text-[14.5px] font-bold text-ink disabled:text-muted"
      >
        {t("keep_time")}
      </button>
    </div>
  );
}

// ───────────────────────── one selectable slot ─────────────────────────

function SlotButton({
  slot,
  lang,
  disabled,
  pending,
  onPick,
}: {
  slot: BookableClass;
  lang: Lang;
  disabled: boolean;
  pending: boolean;
  onPick: () => void;
}) {
  const { t, tt } = makeT(lang);
  const dateStr = tt(classDateLabel(slot.startsAt));
  const timeRange = `${hhmm(slot.startsAt)}–${endTime(slot.startsAt, slot.durationMin)}`;
  const seatsLabel =
    slot.seatsLeft === 1
      ? `${slot.seatsLeft} ${t("spot_left")}`
      : `${slot.seatsLeft} ${t("spots_left")}`;

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-label={`${dateStr} ${timeRange} · ${seatsLabel}`}
      className="flex w-full items-center gap-3 rounded-lune-sm border border-line bg-surface-2 px-4 py-3.5 text-left shadow-soft transition-all hover:border-line-strong active:scale-[0.99] disabled:opacity-60"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-head text-[15.5px] font-semibold text-ink">
          <Clock size={14} className="shrink-0 text-muted" />
          <span>
            {dateStr} · {timeRange}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 font-body text-[12px] text-muted">
          <span className="text-sage-deep">{seatsLabel}</span>
          {slot.instructor && (
            <>
              <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-line-strong" />
              <span>{tt(slot.instructor.name)}</span>
            </>
          )}
        </div>
      </div>
      <span className="shrink-0 text-taupe-deep">
        {pending ? <Check size={18} /> : <ArrowRight size={18} />}
      </span>
    </button>
  );
}

// ───────────────────────── rescheduled confirmation ─────────────────────────

function RescheduledDone({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const { t } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="pt-2 text-center" aria-live="polite">
      <div
        className="mx-auto mb-[18px] mt-1 grid h-[76px] w-[76px] place-items-center rounded-full bg-sage text-white"
        style={{ boxShadow: "0 10px 30px rgba(140,154,126,0.4)" }}
      >
        <Check size={34} strokeWidth={2} />
      </div>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 font-head text-[28px] font-semibold text-ink outline-none"
      >
        {t("resched_done")}
      </h2>
      <p className="mx-auto mb-[22px] max-w-[290px] font-body text-[14px] leading-[1.55] text-ink-soft">
        {t("resched_done_sub")}
      </p>
      <button
        type="button"
        onClick={onDone}
        className="flex h-14 w-full items-center justify-center rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985]"
      >
        {t("done")}
      </button>
    </div>
  );
}

// ───────────────────────── sheet chrome (focus-trapped dialog) ─────────────────────────
// Mirrors the Sheet in cancel-sheet.tsx: slide-up animation, backdrop, Escape to
// close, a focus trap, and focus restore to the trigger on close.

function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement | null;
      setRender(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)));
      return () => cancelAnimationFrame(r);
    }
    setShow(false);
    const tm = setTimeout(() => setRender(false), 300);
    return () => clearTimeout(tm);
  }, [open]);

  useEffect(() => {
    if (!render && prevFocus.current) {
      prevFocus.current.focus?.();
      prevFocus.current = null;
    }
  }, [render]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-[200] mx-auto flex max-w-[440px] flex-col justify-end">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default transition-opacity duration-300"
        style={{
          background: "rgba(40,32,24,0.34)",
          opacity: show ? 1 : 0,
          backdropFilter: "blur(2px)",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[88%] flex-col overflow-hidden bg-surface"
        style={{
          borderRadius: "30px 30px 0 0",
          transform: show ? "translateY(0)" : "translateY(101%)",
          transition: "transform .34s cubic-bezier(.32,.72,0,1)",
          boxShadow: "0 -20px 60px rgba(40,32,24,0.25)",
        }}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-3">
          <span className="h-[5px] w-10 rounded-full bg-line-strong" />
        </div>
        <div className="overflow-y-auto px-[22px] pb-[30px] pt-2">
          <SheetTitleContext.Provider value={titleId}>{children}</SheetTitleContext.Provider>
        </div>
      </div>
    </div>
  );
}
