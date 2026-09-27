"use client";

// The studio's booking rules, shown when a customer books (owner, 2026-09-27):
// cancel 6 hours ahead, arrive 10 minutes early, no entry more than 10 minutes late,
// grip socks throughout.
//
// The sheet opens on EVERY booking — it doubles as the confirm step, so a mis-tap
// can no longer spend a class — but the tick is only required until the customer
// has accepted the current version. After that the rules are shown as a reminder
// and the button books straight away: asking a regular to re-tick the same four
// lines before every class teaches them to tick without reading. When the owner
// publishes new rules, everyone is asked again.
//
// The server holds the record and makes the decision (lib/settings/terms.ts →
// gateBookingTerms); this sheet only asks.

import { useContext, useEffect, useId, useRef, useState } from "react";
import { makeT, type Lang } from "@/lib/i18n";
import { Check } from "./icons";
import { Sheet, SheetTitleContext } from "./sheet";

/** The active booking rules as the class screen receives them. */
export interface CustomerBookingTerms {
  id: string;
  version: number;
  body: { en: string; th: string };
  /** Whether this customer has already accepted THIS version. */
  accepted: boolean;
}

export function BookingTermsSheet({
  open,
  lang,
  terms,
  submitting,
  onConfirm,
  onClose,
}: {
  open: boolean;
  lang: Lang;
  terms: CustomerBookingTerms;
  submitting: boolean;
  /** Called with the version id when the customer ticked it now, else undefined. */
  onConfirm: (acceptedVersionId: string | undefined) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      <Body lang={lang} terms={terms} submitting={submitting} onConfirm={onConfirm} onClose={onClose} />
    </Sheet>
  );
}

function Body({
  lang,
  terms,
  submitting,
  onConfirm,
  onClose,
}: {
  lang: Lang;
  terms: CustomerBookingTerms;
  submitting: boolean;
  onConfirm: (acceptedVersionId: string | undefined) => void;
  onClose: () => void;
}) {
  const { t, tt } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const checkboxId = useId();
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const needsTick = !terms.accepted;
  const canConfirm = !submitting && (!needsTick || agreed);

  return (
    <div className="pt-1">
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-1 mt-1.5 text-center font-head text-[24px] font-semibold tracking-[0.01em] text-ink outline-none"
      >
        {t("booking_terms_title")}
      </h2>
      <p className="mx-auto mb-4 max-w-[300px] text-center font-body text-[12.5px] leading-[1.55] text-muted">
        {needsTick ? t("booking_terms_intro") : t("booking_terms_reminder")}
      </p>

      <div
        role="region"
        aria-label={t("booking_terms_title")}
        tabIndex={0}
        className="max-h-[40vh] overflow-y-auto whitespace-pre-line rounded-lune-sm border border-line bg-surface-2 px-4 py-3.5 font-body text-[13.5px] leading-[1.75] text-ink"
      >
        {tt(terms.body)}
      </div>

      {needsTick && (
        <label
          htmlFor={checkboxId}
          className={`mt-3.5 flex cursor-pointer items-start gap-3 rounded-lune-sm border-[1.5px] px-4 py-3.5 transition-colors ${
            agreed ? "border-taupe bg-surface-2" : "border-line bg-surface"
          }`}
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="sr-only"
          />
          <span
            aria-hidden
            className={`mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border-[1.5px] transition-all ${
              agreed ? "border-taupe bg-taupe text-white" : "border-line-strong text-transparent"
            }`}
          >
            <Check size={14} />
          </span>
          <span className="font-body text-[13px] leading-[1.5] text-ink">
            {t("booking_terms_agree")}
          </span>
        </label>
      )}

      <button
        type="button"
        onClick={() => onConfirm(needsTick ? terms.id : undefined)}
        disabled={!canConfirm}
        className="mt-4 flex h-12 w-full items-center justify-center rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none"
      >
        {submitting ? t("confirm") + "…" : t("booking_terms_confirm")}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 flex h-11 w-full items-center justify-center rounded-lune-sm font-body text-sm font-semibold text-ink-soft"
      >
        {t("cancel")}
      </button>
    </div>
  );
}
