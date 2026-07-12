"use client";

// One card in the "Waitlist" section of My Bookings (CLAUDE.md §5 invariant 6 —
// "first to confirm wins": the 30-minute offer is a notification head-start, NOT a
// seat reservation). It renders a server-shaped MyWaitlistEntry and handles the
// three live states:
//   - waiting → class summary + "Waitlisted · Position {n}".
//   - offered → highlighted "A spot opened!" card with a LIVE mm:ss countdown to
//     the server's holdExpiresAt and a Confirm button → confirmWaitlistOffer.
//   - expired → muted "Offer expired".
//
// The countdown is purely a display of the SERVER timestamp (entry.holdExpiresAt):
// the client only ticks the clock and renders mm:ss; eligibility, the package to
// debit, the cost, and the authoritative expiry are all decided server-side. When
// the countdown reaches 0 the Confirm button is disabled and the card shows
// "offer expired" — but the real verdict still comes from confirmWaitlistOffer
// (OFFER_EXPIRED), never from this clock.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  confirmWaitlistOffer,
  type ConfirmWaitlistFailureCode,
} from "@/app/actions/waitlist";
import type { MyWaitlistEntry } from "@/lib/waitlist/queries";
import { makeT, type Lang } from "@/lib/i18n";
import type { StrKey } from "@/lib/i18n/strings";
import { classDateLabel, endTime, hhmm, TYPE_DOT } from "./schedule-helpers";
import { Bell, Check, Clock, Info } from "./icons";

type ConfirmPhase = "idle" | "submitting" | "done" | "error";

/** Map a confirm-offer failure code to friendly, keyed copy. */
function confirmErrorKey(code: ConfirmWaitlistFailureCode): StrKey {
  switch (code) {
    case "OFFER_EXPIRED":
    case "NOT_OFFERED":
      return "err_offer_expired";
    case "OFFER_LOST":
      return "err_offer_lost";
    case "NO_USABLE_PACKAGE":
    case "NO_CREDITS":
    case "PACKAGE_NOT_FOUND":
    case "EXPIRED":
      return "err_offer_no_credits";
    case "NOT_FOUND":
      return "err_cancel_not_found";
    case "NOT_VISIBLE":
      return "err_not_visible";
    default:
      return "err_generic";
  }
}

/** Failures that mean the viewer has no usable credits → link them to /buy. */
function isNoCredits(code: ConfirmWaitlistFailureCode): boolean {
  return (
    code === "NO_USABLE_PACKAGE" ||
    code === "NO_CREDITS" ||
    code === "PACKAGE_NOT_FOUND" ||
    code === "EXPIRED"
  );
}

/** mm:ss for a non-negative whole-second remaining count. */
function fmtMmSs(secondsLeft: number): string {
  const s = Math.max(0, secondsLeft);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function WaitlistCard({ lang, entry }: { lang: Lang; entry: MyWaitlistEntry }) {
  const { t, tt } = makeT(lang);
  const dateStr = tt(classDateLabel(entry.startsAt));
  const timeRange = `${hhmm(entry.startsAt)}–${endTime(entry.startsAt, entry.durationMin)}`;

  if (entry.status === "offered" && entry.holdExpiresAt) {
    return <OfferedCard lang={lang} entry={entry} dateStr={dateStr} timeRange={timeRange} />;
  }

  // waiting / expired (and any offered row with no hold) share the calm card shell.
  const expired = entry.status === "expired";
  return (
    <article className={`rounded-lune border border-line bg-surface-2 px-[18px] py-4 shadow-soft ${expired ? "opacity-[0.82]" : ""}`}>
      <CardSummary lang={lang} entry={entry} dateStr={dateStr} timeRange={timeRange} />
      <div className="mt-3 border-t border-line pt-3">
        {expired ? (
          <span className="inline-flex items-center gap-1.5 font-body text-[12.5px] font-semibold text-muted">
            <Info size={14} />
            {t("offer_expired")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-body text-[12.5px] font-semibold text-taupe-deep">
            <Bell size={14} />
            {t("waitlisted_status").replace(
              "{pos}",
              t("waitlist_position").replace("{n}", String(entry.position)),
            )}
          </span>
        )}
      </div>
    </article>
  );
}

// ───────────────────────── offered card (live countdown + confirm) ─────────────────────────

function OfferedCard({
  lang,
  entry,
  dateStr,
  timeRange,
}: {
  lang: Lang;
  entry: MyWaitlistEntry;
  dateStr: string;
  timeRange: string;
}) {
  const { t, tt } = makeT(lang);
  const router = useRouter();
  // Non-null on this path (the parent only renders OfferedCard when holdExpiresAt
  // is set), but TS doesn't know that — guard for a safe fallback.
  const deadline = entry.holdExpiresAt ? new Date(entry.holdExpiresAt).getTime() : 0;

  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    Math.max(0, Math.round((deadline - Date.now()) / 1000)),
  );
  const [phase, setPhase] = useState<ConfirmPhase>("idle");
  const [failCode, setFailCode] = useState<ConfirmWaitlistFailureCode | null>(null);

  const errorRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  // Tick the displayed countdown off the SERVER deadline once per second. This is
  // display only — it never decides eligibility; confirmWaitlistOffer re-checks
  // the hold server-side (→ OFFER_EXPIRED) regardless of this clock.
  useEffect(() => {
    if (phase === "done") return;
    const id = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, phase]);

  useEffect(() => {
    if (phase === "error") errorRef.current?.focus();
    if (phase === "done") doneRef.current?.focus();
  }, [phase]);

  const elapsed = secondsLeft <= 0;
  const submitting = phase === "submitting";

  async function confirm() {
    setPhase("submitting");
    setFailCode(null);
    try {
      const res = await confirmWaitlistOffer({ waitlistId: entry.waitlistId });
      if (res.ok) {
        setPhase("done");
        // The waitlist entry has become a real booking — re-fetch the server
        // component so it leaves this section and joins Upcoming.
        router.refresh();
      } else {
        setFailCode(res.code);
        setPhase("error");
      }
    } catch {
      // A thrown action (network blip) → the keyed generic error state
      // (INVALID_INPUT → err_generic), never an unhandled rejection.
      setFailCode("INVALID_INPUT");
      setPhase("error");
    }
  }

  // Brief in-card confirmation after a successful claim (router.refresh() then
  // sweeps the entry out of this list).
  if (phase === "done") {
    return (
      <article
        className="rounded-lune border border-sage/40 bg-sage/10 px-[18px] py-5 text-center shadow-soft"
        aria-live="polite"
      >
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-sage text-white">
          <Check size={24} />
        </div>
        <div
          ref={doneRef}
          tabIndex={-1}
          className="font-head text-[17px] font-semibold text-ink outline-none"
        >
          {t("waitlist_booked")}
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-lune border border-taupe/40 bg-surface-2 px-[18px] py-4 shadow-soft ring-1 ring-taupe/25">
      {/* highlighted "A spot opened!" header */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-sage/20 text-sage-deep">
          <Bell size={13} />
        </span>
        <span className="font-head text-[14px] font-semibold text-sage-deep">{t("spot_opened")}</span>
      </div>

      <CardSummary lang={lang} entry={entry} dateStr={dateStr} timeRange={timeRange} />

      {/* live countdown to the server's holdExpiresAt (display only) */}
      <div
        className="mt-3 flex items-center justify-between rounded-lune-sm border border-line bg-surface px-[15px] py-[11px]"
        aria-live="polite"
      >
        <span className="font-body text-[12.5px] font-semibold text-ink-soft">
          {elapsed ? t("offer_expired") : t("offer_expires_in").replace("{time}", fmtMmSs(secondsLeft))}
        </span>
        <Clock size={16} className={elapsed ? "text-rose" : "text-taupe-deep"} />
      </div>

      {/* error alert (confirm) */}
      {phase === "error" && failCode && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mt-3 flex items-start gap-3 rounded-lune-sm border border-rose/40 bg-rose/10 px-4 py-3 outline-none"
        >
          <span className="mt-0.5 shrink-0 text-rose">
            <Info size={18} />
          </span>
          <p className="font-body text-[13px] leading-snug text-ink">
            {t(confirmErrorKey(failCode))}
            {isNoCredits(failCode) && (
              <>
                {" "}
                <Link href="/buy" className="font-semibold text-taupe-deep underline">
                  {t("buy_credits")}
                </Link>
              </>
            )}
          </p>
        </div>
      )}

      {/* confirm — disabled once the countdown elapses (the server still re-checks) */}
      <button
        type="button"
        onClick={confirm}
        disabled={submitting || elapsed}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lune-sm bg-ink font-body text-[15px] font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none"
      >
        {submitting ? `${t("confirm_spot")}…` : elapsed ? t("offer_expired") : t("confirm_spot")}
      </button>
    </article>
  );
}

// ───────────────────────── shared class summary block ─────────────────────────

function CardSummary({
  lang,
  entry,
  dateStr,
  timeRange,
}: {
  lang: Lang;
  entry: MyWaitlistEntry;
  dateStr: string;
  timeRange: string;
}) {
  const { t, tt } = makeT(lang);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-[7px]">
        <span
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: TYPE_DOT[entry.type] }}
          aria-hidden="true"
        />
        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
          {tt(entry.typeMeta.short)}
        </span>
      </div>
      <div className="font-head text-[21px] font-semibold leading-[1.1] text-ink">
        {tt(entry.typeMeta.label)}
      </div>
      <div className="mt-[7px] flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
        <Clock size={14} />
        <span>
          {dateStr} · {timeRange}
        </span>
      </div>
      {entry.instructor && (
        <div className="mt-1 font-body text-[12.5px] text-muted">
          {t("with_kru")} {tt(entry.instructor.name)}
        </div>
      )}
    </div>
  );
}
