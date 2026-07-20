"use client";

// The interactive booking surface on the class detail screen: the reformer seat
// picker (Left/Middle/Right → open/taken/selected), the sticky cost + CTA, and
// the confirm → booked / error flow. It calls the bookClass server action and
// renders state from the typed result; it never computes price, balance, or
// availability itself.
//
// Accessibility: seats are real <button>s in a radiogroup, keyboard-operable;
// focus moves to the confirmation heading on success and to the error alert on
// failure (managed via refs + useEffect).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClassDetail, PositionAvailability } from "@/lib/schedule/queries";
import type { ReformerPosition } from "@/lib/domain/types";
import { bookClass, type BookActionFailureCode } from "@/app/actions/booking";
import {
  joinWaitlist,
  type JoinWaitlistFailureCode,
} from "@/app/actions/waitlist";
import { makeT, type Lang } from "@/lib/i18n";
import type { StrKey } from "@/lib/i18n/strings";
import { POSITION_KEY, windowHoursLabel } from "./schedule-helpers";
import { ArrowRight, Bell, Check, Info } from "./icons";

interface BookingPanelProps {
  lang: Lang;
  detail: ClassDetail;
  /** Cost in credits for this class, resolved server-side. */
  cost: number;
  /**
   * Usable-package balance before booking, resolved server-side (hours), or
   * null when the viewer has no usable package for this class. Null ⇒ hide the
   * pre-booking estimate (the server returns NO_PACKAGE/NO_CREDITS on attempt).
   */
  balanceBefore: number | null;
  /** Whether this class type assigns reformer positions (multi-seat: group/duo/trio/rental). */
  usesPositions: boolean;
  /** Bilingual date string for the confirmation (e.g. "Mon 1 Jun"). */
  dateStr: string;
  /** "HH:MM–HH:MM" time range. */
  timeRange: string;
}

type Phase = "idle" | "submitting" | "booked" | "error";
// Waitlist join is a parallel mini-flow on the full-class state: idle → joining →
// joined (the "You're on the list" confirmation) | wlerror (friendly failure).
type WaitlistPhase = "idle" | "joining" | "joined" | "error";


/** Map an action failure code to a friendly, keyed message. */
function errorKey(code: BookActionFailureCode): StrKey {
  switch (code) {
    case "NO_USABLE_PACKAGE":
    case "PACKAGE_NOT_FOUND":
    case "NO_CREDITS":
    case "EXPIRED":
      return "err_no_package";
    case "CLASS_FULL":
    case "POSITION_TAKEN":
      return "err_full";
    case "INVALID_POSITION":
      return "err_invalid_position";
    case "ALREADY_BOOKED":
      return "err_already_booked";
    case "CLASS_NOT_FOUND":
    case "NOT_BOOKABLE":
      return "err_not_found";
    case "NOT_VISIBLE":
      return "err_not_visible";
    case "INVALID_INPUT":
    default:
      return "err_generic";
  }
}

/** Map a join-waitlist failure code to friendly, keyed copy. */
function joinErrorKey(code: JoinWaitlistFailureCode): StrKey {
  switch (code) {
    case "ALREADY_WAITLISTED":
      return "err_already_waitlisted";
    case "ALREADY_BOOKED":
      return "err_already_booked";
    case "NOT_FULL":
      // A seat actually opened up while the page was stale — nudge to book.
      return "err_waitlist_not_full";
    case "CLASS_NOT_FOUND":
      return "err_not_found";
    case "NOT_VISIBLE":
      return "err_not_visible";
    case "INVALID_INPUT":
    default:
      return "err_generic";
  }
}

export function BookingPanel({
  lang,
  detail,
  cost,
  balanceBefore,
  usesPositions,
  dateStr,
  timeRange,
}: BookingPanelProps) {
  const { t, tt } = makeT(lang);
  const router = useRouter();

  // First open position is the default selection (mirrors the prototype).
  const firstOpenIndex = useMemo(
    () => detail.positions.findIndex((p) => !p.taken),
    [detail.positions],
  );
  const [selected, setSelected] = useState<number>(firstOpenIndex);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failCode, setFailCode] = useState<BookActionFailureCode | null>(null);
  const [balanceAfter, setBalanceAfter] = useState<number | null>(null);
  // The free-cancel window (hours, always 5) the server LOCKED for THIS booking,
  // surfaced on the success screen so the policy notice is accurate per booking.
  const [freeCancelHours, setFreeCancelHours] = useState<number | null>(null);

  // Waitlist join state (full-class path) — the queue position comes from the
  // server join result, never computed here.
  const [wlPhase, setWlPhase] = useState<WaitlistPhase>("idle");
  const [wlFailCode, setWlFailCode] = useState<JoinWaitlistFailureCode | null>(null);
  const [wlPosition, setWlPosition] = useState<number | null>(null);

  const groupRef = useRef<HTMLDivElement>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const wlHeadingRef = useRef<HTMLHeadingElement>(null);
  const wlErrorRef = useRef<HTMLDivElement>(null);

  // Focus management: move focus to the success heading / error alert when the
  // phase changes, so screen-reader and keyboard users land on the new state.
  useEffect(() => {
    if (phase === "booked") confirmHeadingRef.current?.focus();
    if (phase === "error") errorRef.current?.focus();
  }, [phase]);

  // Same focus management for the parallel waitlist-join flow.
  useEffect(() => {
    if (wlPhase === "joined") wlHeadingRef.current?.focus();
    if (wlPhase === "error") wlErrorRef.current?.focus();
  }, [wlPhase]);

  const full = detail.full;
  const seatsLeft = detail.seatsLeft;

  async function submit() {
    setPhase("submitting");
    setFailCode(null);
    const position: ReformerPosition | undefined =
      usesPositions && detail.positions[selected]
        ? detail.positions[selected].position
        : undefined;
    try {
      const res = await bookClass({ classInstanceId: detail.id, position });
      if (res.ok) {
        setBalanceAfter(res.hoursLeft);
        setFreeCancelHours(res.freeCancelHours);
        setPhase("booked");
      } else {
        setFailCode(res.code);
        setPhase("error");
      }
    } catch {
      // A thrown action (network blip / unexpected server error) must surface the
      // keyed generic error, not reject unhandled. INVALID_INPUT → err_generic.
      setFailCode("INVALID_INPUT");
      setPhase("error");
    }
  }

  // Join the waitlist for a full class. Writes a Waitlist row server-side (never a
  // booking, never a charge — CLAUDE.md §5 invariant 6); the returned position is
  // the server's FIFO position, shown on the "You're on the list" confirmation.
  async function joinWl() {
    setWlPhase("joining");
    setWlFailCode(null);
    try {
      const res = await joinWaitlist({ classInstanceId: detail.id });
      if (res.ok) {
        setWlPosition(res.position);
        setWlPhase("joined");
      } else {
        setWlFailCode(res.code);
        setWlPhase("error");
      }
    } catch {
      // Network blip → the same keyed generic error state (INVALID_INPUT → err_generic).
      setWlFailCode("INVALID_INPUT");
      setWlPhase("error");
    }
  }

  // ───────── waitlist "You're on the list" confirmation state ─────────
  // Mirrors the prototype's waitlist SuccessContent (Bell in a cream-2 circle, no
  // shadow — distinct from the sage booked-success). Reuses the existing
  // waitlist_title/waitlist_sub copy (which already mentions the 30-min window).
  if (wlPhase === "joined") {
    return (
      <div className="px-[18px] pb-10 pt-2" aria-live="polite">
        <div className="rounded-lune border border-line bg-surface-2 p-6 text-center shadow-soft">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-cream-2 text-taupe-deep">
            <Bell size={30} />
          </div>
          <h2
            ref={wlHeadingRef}
            tabIndex={-1}
            className="font-head text-2xl font-semibold text-ink outline-none"
          >
            {t("waitlist_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-[18rem] font-body text-[14px] leading-relaxed text-ink-soft">
            {t("waitlist_sub")}
          </p>

          <div className="mt-5 rounded-lune-sm border border-line bg-surface px-4 py-3.5 text-left">
            <div className="font-head text-[17px] font-semibold text-ink">
              {detail.name || tt(detail.typeMeta.label)}
            </div>
            <div className="mt-1 font-body text-[13px] text-ink-soft">
              {dateStr} · {timeRange}
            </div>
            {wlPosition !== null && (
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 font-body text-[13px]">
                <span className="text-muted">{t("waitlist_section")}</span>
                <span className="font-semibold text-ink">
                  {t("waitlist_position").replace("{n}", String(wlPosition))}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => router.push("/bookings")}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift"
          >
            {t("done")}
          </button>
        </div>
      </div>
    );
  }

  // ───────── booked confirmation state ─────────
  if (phase === "booked") {
    return (
      <div className="px-[18px] pb-10 pt-2" aria-live="polite">
        <div className="rounded-lune border border-line bg-surface-2 p-6 text-center shadow-soft">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-sage/20 text-sage-deep">
            <Check size={30} />
          </div>
          <h2
            ref={confirmHeadingRef}
            tabIndex={-1}
            className="font-head text-2xl font-semibold text-ink outline-none"
          >
            {t("booked_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-[18rem] font-body text-[14px] leading-relaxed text-ink-soft">
            {t("booked_sub")}
          </p>

          <div className="mt-5 rounded-lune-sm border border-line bg-surface px-4 py-3.5 text-left">
            <div className="font-head text-[17px] font-semibold text-ink">
              {detail.name || tt(detail.typeMeta.label)}
            </div>
            <div className="mt-1 font-body text-[13px] text-ink-soft">
              {dateStr} · {timeRange}
            </div>
            {balanceAfter !== null && (
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 font-body text-[13px]">
                <span className="text-muted">{t("remaining_after")}</span>
                <span className="font-semibold text-ink">
                  {balanceAfter} {balanceAfter === 1 ? t("hour") : t("hours")}
                </span>
              </div>
            )}
          </div>

          {/* applicable cancellation policy — the window ({hours}) is the
              freeCancelHours the server locked for THIS booking (always 5), and the
              cost is this class's exact credit cost. Never computed client-side. */}
          {freeCancelHours !== null && (
            <div className="mt-3 flex items-start gap-2.5 rounded-lune-sm bg-cream-2 px-4 py-3 text-left">
              <span className="mt-px shrink-0 text-taupe-deep">
                <Info size={16} />
              </span>
              <p className="m-0 font-body text-[12.5px] leading-[1.5] text-ink-soft">
                {t("booked_policy")
                  .replace("{hours}", windowHoursLabel(freeCancelHours, t))
                  .replace(
                    "{cost}",
                    `${String(cost)} ${cost === 1 ? t("hour") : t("hours")}`,
                  )}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => router.push("/bookings")}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift"
          >
            {t("done")}
          </button>
        </div>
      </div>
    );
  }

  // ───────── seat picker + CTA (idle / submitting / error) ─────────
  return (
    <div className="px-[18px] pb-10">
      {/* reformer position picker */}
      {usesPositions && (
        <div className="mt-4 rounded-lune-sm border border-line bg-surface-2 px-4 pb-4 pt-3.5 shadow-soft">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {full ? t("spots_remaining") : t("choose_position")}
            </span>
            <span className="inline-flex items-baseline gap-1 font-body">
              <span className={`text-base font-bold ${full ? "text-rose" : "text-sage-deep"}`}>
                {full ? 0 : seatsLeft}
              </span>
              <span className="text-[12.5px] text-muted">
                / {detail.capacity} {t("open_count")}
              </span>
            </span>
          </div>

          <div
            ref={groupRef}
            role="radiogroup"
            aria-label={t("choose_position")}
            className="flex gap-[9px]"
          >
            {detail.positions.map((pos, i) => (
              <SeatButton
                key={pos.position}
                pos={pos}
                index={i}
                positions={detail.positions}
                selected={selected === i && !pos.taken}
                lang={lang}
                onSelect={() => setSelected(i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* error alert (booking) */}
      {phase === "error" && failCode && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mt-4 flex items-start gap-3 rounded-lune-sm border border-rose/40 bg-rose/10 px-4 py-3.5 outline-none"
        >
          <span className="mt-0.5 shrink-0 text-rose">
            <Info size={18} />
          </span>
          <div className="flex-1">
            <p className="font-body text-[13.5px] leading-snug text-ink">{t(errorKey(failCode))}</p>
            <button
              type="button"
              onClick={() => setPhase("idle")}
              className="mt-1.5 font-body text-[13px] font-semibold text-taupe-deep underline"
            >
              {t("retry")}
            </button>
          </div>
        </div>
      )}

      {/* error alert (waitlist join) */}
      {wlPhase === "error" && wlFailCode && (
        <div
          ref={wlErrorRef}
          role="alert"
          tabIndex={-1}
          className="mt-4 flex items-start gap-3 rounded-lune-sm border border-rose/40 bg-rose/10 px-4 py-3.5 outline-none"
        >
          <span className="mt-0.5 shrink-0 text-rose">
            <Info size={18} />
          </span>
          <div className="flex-1">
            <p className="font-body text-[13.5px] leading-snug text-ink">{t(joinErrorKey(wlFailCode))}</p>
            <button
              type="button"
              onClick={() => setWlPhase("idle")}
              className="mt-1.5 font-body text-[13px] font-semibold text-taupe-deep underline"
            >
              {t("retry")}
            </button>
          </div>
        </div>
      )}

      {/* sticky cost + CTA */}
      <div className="mt-4 flex items-center gap-3.5 rounded-lune-sm border border-line bg-surface-2 px-4 py-3.5 shadow-soft">
        <div className="shrink-0">
          <div className="font-body text-[11px] tracking-[0.02em] text-muted">{t("costs")}</div>
          <div className="font-head text-[20px] font-semibold leading-[1.1] text-ink">
            {cost}{" "}
            <span className="font-body text-[13px] font-medium text-taupe">
              {cost === 1 ? t("hour") : t("hours")}
            </span>
          </div>
        </div>

        <div className="flex-1">
          {full ? (
            <button
              type="button"
              onClick={joinWl}
              disabled={wlPhase === "joining"}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lune-sm border-[1.5px] border-line-strong bg-transparent font-body text-base font-semibold text-ink transition-transform active:scale-[0.985] disabled:border-line disabled:text-muted"
            >
              {wlPhase === "joining" ? t("join_waitlist") + "…" : t("join_waitlist")}
              {wlPhase !== "joining" && <Bell size={18} />}
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={phase === "submitting"}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none"
            >
              {phase === "submitting" ? t("confirm") + "…" : t("book_now")}
              {phase !== "submitting" && <ArrowRight size={18} />}
            </button>
          )}
        </div>
      </div>

      {/* Balance after booking — a pre-booking estimate from the server's
          usable-package balance (balanceBefore − cost). Shown only when a usable
          package exists; when balanceBefore is null the viewer has no usable
          credits, so we hide the estimate and surface that state instead. The
          Book button still attempts; the server returns NO_PACKAGE/NO_CREDITS.
          The authoritative post-booking balance comes from the action result
          (balanceAfter) in the confirmation state above. */}
      {!full && balanceBefore !== null && (
        <p className="mt-2.5 text-center font-body text-[12px] text-muted">
          {t("remaining_after")}:{" "}
          <span className="font-semibold text-ink-soft">
            {Math.max(0, balanceBefore - cost)}{" "}
            {balanceBefore - cost === 1 ? t("hour") : t("hours")}
          </span>
        </p>
      )}
      {!full && balanceBefore === null && (
        <p className="mt-2.5 text-center font-body text-[12px] text-rose">
          {t("err_no_package")}{" "}
          <Link href="/buy" className="font-semibold text-taupe-deep underline">
            {t("buy_credits")}
          </Link>
        </p>
      )}
    </div>
  );
}

function SeatButton({
  pos,
  index,
  positions,
  selected,
  lang,
  onSelect,
}: {
  pos: PositionAvailability;
  index: number;
  positions: PositionAvailability[];
  selected: boolean;
  lang: Lang;
  onSelect: () => void;
}) {
  const { t } = makeT(lang);
  const label = t(POSITION_KEY[pos.position]);
  const statusKey: StrKey = pos.taken ? "pos_taken" : selected ? "pos_selected" : "pos_open";

  // Carriage horizontal offset on the rail, mirroring the prototype.
  const carriageLeft = pos.taken ? "36%" : selected ? "35%" : "8%";
  const railColor = pos.taken ? "var(--color-muted)" : "var(--color-taupe)";

  const statusColor = pos.taken
    ? "text-muted"
    : selected
      ? "text-taupe-deep"
      : "text-sage-deep";

  // Roving-tabindex within the radiogroup: only the active/first-open seat is in
  // the tab order; arrow keys move between seats.
  const firstSelectable = positions.findIndex((p) => !p.taken);
  const tabIndex = pos.taken ? -1 : selected || (firstSelectable === index && !positions.some((p, i) => i < index && !p.taken)) ? 0 : -1;

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    // Find next selectable (non-taken) seat in the chosen direction.
    let i = index + dir;
    while (i >= 0 && i < positions.length) {
      const candidate = positions[i];
      if (candidate && !candidate.taken) {
        const el = e.currentTarget.parentElement?.children[i] as HTMLButtonElement | undefined;
        el?.focus();
        el?.click();
        return;
      }
      i += dir;
    }
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${label} — ${t(statusKey)}`}
      disabled={pos.taken}
      tabIndex={tabIndex}
      onClick={() => !pos.taken && onSelect()}
      onKeyDown={onKeyDown}
      className={`relative flex flex-1 flex-col items-center gap-[7px] rounded-[14px] px-1.5 pb-[11px] pt-[13px] transition-all ${
        selected
          ? "border-[1.5px] border-solid border-taupe bg-surface-2 shadow-soft"
          : pos.taken
            ? "border-[1.5px] border-solid border-transparent bg-cream-2"
            : "border-[1.5px] border-dashed border-line-strong bg-transparent"
      }`}
    >
      {selected && (
        <span className="absolute right-[7px] top-[7px] grid h-[17px] w-[17px] place-items-center rounded-full bg-taupe text-white">
          <Check size={10} />
        </span>
      )}

      <span className={`font-head text-sm font-semibold ${pos.taken ? "text-muted" : "text-ink"}`}>
        {label}
      </span>

      {/* abstract reformer: a carriage on two rails */}
      <span className="relative block h-5 w-full max-w-[46px]" aria-hidden="true">
        <span
          className="absolute left-0 right-0 top-[3px] h-[1.5px] rounded-sm opacity-[0.42]"
          style={{ background: railColor }}
        />
        <span
          className="absolute bottom-[3px] left-0 right-0 h-[1.5px] rounded-sm opacity-[0.42]"
          style={{ background: railColor }}
        />
        <span
          className="absolute bottom-0 top-0 w-[30%] rounded transition-[left] duration-300"
          style={{
            left: carriageLeft,
            background: railColor,
            opacity: pos.taken ? 0.9 : selected ? 1 : 0.7,
          }}
        />
      </span>

      <span className={`font-body text-[10.5px] font-semibold tracking-[0.02em] ${statusColor}`}>
        {t(statusKey)}
      </span>
    </button>
  );
}
