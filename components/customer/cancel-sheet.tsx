"use client";

// The customer cancel-booking sheet: a focus-trapped, Escape-dismissable dialog
// opened from an upcoming booking on the My Bookings screen. It renders the
// SERVER-computed cancellation policy (`booking.cancellation`) — free (outside
// the 5-hour window, credit refunded) vs within-5h (credit kept) — then, on
// confirm, calls `cancelBookingAction` and surfaces the cancelled confirmation,
// refreshing the list via router.refresh() so the booking drops out.
//
// Mirrors lune-pilates/project/lune-extra.jsx (CancelContent + ActionDone) and
// lune-sheets.jsx (SummaryCard + Sheet chrome). It never recomputes the policy
// or the refund itself: the eligibility shown here comes from the backend, and
// the authoritative decision is re-evaluated inside cancelBookingAction.

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  cancelBookingAction,
  type CancelActionFailureCode,
} from "@/app/actions/booking";
import { makeT, type Lang } from "@/lib/i18n";
import type { StrKey } from "@/lib/i18n/strings";
import type { MyBooking } from "@/lib/bookings/queries";
import {
  classDateLabel,
  endTime,
  hhmm,
  hoursUntilLabel,
  TYPE_DOT,
  windowHoursLabel,
} from "./schedule-helpers";
import { Check, Clock, Info } from "./icons";

// Lets a step component label the dialog via the sheet's generated id.
const SheetTitleContext = createContext<string>("");

type Phase = "idle" | "submitting" | "done" | "error";

/** Map a cancel action failure code to friendly, keyed copy. */
function cancelErrorKey(code: CancelActionFailureCode): StrKey {
  switch (code) {
    case "NOT_FOUND":
      return "err_cancel_not_found";
    case "NOT_LIVE":
      return "err_cancel_not_live";
    case "FORBIDDEN":
    case "INVALID_INPUT":
    default:
      return "err_generic";
  }
}

export function CancelSheet({
  lang,
  booking,
  open,
  onClose,
}: {
  lang: Lang;
  booking: MyBooking | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failCode, setFailCode] = useState<CancelActionFailureCode | null>(null);
  // Whether the completed cancel actually refunded — taken from the action
  // outcome (server truth), not the pre-cancel `booking.cancellation`.
  const [refunded, setRefunded] = useState(false);

  // Reset the flow whenever a fresh booking is opened, so a previous cancel's
  // "done" state never leaks into the next sheet.
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setFailCode(null);
      setRefunded(false);
    }
  }, [open, booking?.bookingId]);

  async function confirmCancel() {
    if (!booking) return;
    setPhase("submitting");
    setFailCode(null);
    const res = await cancelBookingAction({ bookingId: booking.bookingId });
    if (res.ok) {
      setRefunded(res.outcome.refunded);
      setPhase("done");
      // Re-fetch the server component so the cancelled booking leaves the list.
      router.refresh();
    } else {
      setFailCode(res.code);
      setPhase("error");
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      {booking &&
        (phase === "done" ? (
          <CancelledDone
            lang={lang}
            refunded={refunded}
            credits={booking.creditCost}
            onDone={onClose}
          />
        ) : (
          <CancelContent
            lang={lang}
            booking={booking}
            phase={phase}
            failCode={failCode}
            onConfirm={confirmCancel}
            onKeep={onClose}
          />
        ))}
    </Sheet>
  );
}

/** Format a credit cost for copy: 1 → "1", 1.5 → "1.5" (drops the trailing .0). */
function fmtCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ───────────────────────── cancel content (policy verdict + actions) ─────────────────────────

function CancelContent({
  lang,
  booking,
  phase,
  failCode,
  onConfirm,
  onKeep,
}: {
  lang: Lang;
  booking: MyBooking;
  phase: Phase;
  failCode: CancelActionFailureCode | null;
  onConfirm: () => void;
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

  const free = booking.cancellation.free;
  const late = !free;
  const dateStr = tt(classDateLabel(booking.startsAt));
  const timeRange = `${hhmm(booking.startsAt)}–${endTime(
    booking.startsAt,
    booking.durationMin,
  )}`;
  const untilStr = tt(hoursUntilLabel(booking.cancellation.hoursUntilStart));
  // The exact cost kept/refunded, in the app's "hours" unit (e.g. "1.5 hours") —
  // interpolated into the policy copy so it never misstates a 1.5-credit class.
  const costLabel = `${fmtCredits(booking.creditCost)} ${booking.creditCost === 1 ? t("hour") : t("hours")}`;
  // This booking's OWN free-cancel window (server-locked, 5 | 1) as a localized
  // "5 hours" / "1 hour" phrase, interpolated into the verdict + sub-copy.
  const windowLabel = windowHoursLabel(booking.cancellation.freeCancelHours, t);
  const submitting = phase === "submitting";

  return (
    <div>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-4 mt-1.5 font-head text-[26px] font-semibold tracking-[0.01em] text-ink outline-none"
      >
        {t("cancel_title")}
      </h2>

      {/* summary card (mirrors SummaryCard) */}
      <div className="flex items-start gap-3.5 rounded-lune-sm border border-line bg-surface-2 px-[15px] py-3.5 shadow-soft">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            <span
              className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ background: TYPE_DOT[booking.type] }}
              aria-hidden="true"
            />
            <span className="font-body text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted">
              {tt(booking.typeMeta.short)}
            </span>
          </div>
          <div className="font-head text-[19px] font-semibold leading-[1.1] text-ink">
            {tt(booking.typeMeta.label)}
          </div>
          <div className="mt-1 font-body text-[12.5px] text-ink-soft">
            {dateStr} · {timeRange}
            {booking.instructor ? ` · ${tt(booking.instructor.name)}` : ""}
          </div>
        </div>
      </div>

      {/* countdown */}
      <div className="mt-3 flex items-center justify-between rounded-lune-sm border border-line px-[15px] py-[11px]">
        <span className="font-body text-[12.5px] text-ink-soft">
          {untilStr} {t("time_until_class")}
        </span>
        <Clock size={16} className="text-muted" />
      </div>

      {/* policy verdict — from server-computed cancellation eligibility */}
      <div
        className={`mt-3 flex items-start gap-3 rounded-lune-sm border px-4 py-3.5 ${
          late
            ? "border-rose/30 bg-rose/10"
            : "border-sage/30 bg-sage/10"
        }`}
      >
        <span className={`mt-0.5 shrink-0 ${late ? "text-rose" : "text-sage-deep"}`}>
          {late ? <Info size={20} /> : <Check size={20} />}
        </span>
        <div>
          <div
            className={`mb-[3px] font-body text-[13.5px] font-bold ${
              late ? "text-rose" : "text-sage-deep"
            }`}
          >
            {late ? t("late_cancel").replace("{hours}", windowLabel) : t("free_cancel")}
          </div>
          <div className="font-body text-[12.5px] leading-[1.5] text-ink-soft">
            {late
              ? t("late_cancel_sub").replace("{hours}", windowLabel).replace("{cost}", costLabel)
              : t("free_cancel_sub").replace("{hours}", windowLabel).replace("{cost}", costLabel)}
          </div>
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
            {t(cancelErrorKey(failCode))}
          </p>
        </div>
      )}

      {/* cancel action — rose when late (credit kept), ink when free */}
      <button
        type="button"
        onClick={onConfirm}
        disabled={submitting}
        className={`mt-[18px] flex h-14 w-full items-center justify-center rounded-lune-sm font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none ${
          late ? "bg-rose" : "bg-ink"
        }`}
      >
        {submitting ? `${t("cancel_class")}…` : t("cancel_class")}
      </button>
      <button
        type="button"
        onClick={onKeep}
        disabled={submitting}
        className="mt-2.5 w-full py-3 font-body text-[14.5px] font-bold text-ink disabled:text-muted"
      >
        {t("keep_booking")}
      </button>
    </div>
  );
}

// ───────────────────────── cancelled confirmation ─────────────────────────

function CancelledDone({
  lang,
  refunded,
  credits,
  onDone,
}: {
  lang: Lang;
  refunded: boolean;
  credits: number;
  onDone: () => void;
}) {
  const { t } = makeT(lang);
  const costLabel = `${fmtCredits(credits)} ${credits === 1 ? t("hour") : t("hours")}`;
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="pt-2 text-center" aria-live="polite">
      <div
        className={`mx-auto mb-[18px] mt-1 grid h-[76px] w-[76px] place-items-center rounded-full text-white ${
          refunded ? "bg-sage" : "bg-rose"
        }`}
        style={{
          boxShadow: refunded
            ? "0 10px 30px rgba(140,154,126,0.4)"
            : "0 10px 30px rgba(196,154,134,0.4)",
        }}
      >
        <Check size={34} strokeWidth={2} />
      </div>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 font-head text-[28px] font-semibold text-ink outline-none"
      >
        {t("cancelled_title")}
      </h2>
      <p className="mx-auto mb-[22px] max-w-[290px] font-body text-[14px] leading-[1.55] text-ink-soft">
        {(refunded ? t("cancelled_free_sub") : t("cancelled_late_sub")).replace("{cost}", costLabel)}
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
// Mirrors the CheckoutSheet in checkout-panel.tsx: slide-up animation, backdrop,
// Escape-to-close, focus trap, and focus restore to the trigger on close.

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
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
