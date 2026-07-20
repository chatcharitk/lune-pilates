"use client";

// Class detail + booking screen (CLAUDE.md §4–§6, §5 invariant 7). Reads the
// active language from the CustomerLangProvider so the whole screen switches
// EN/TH. This is a "pushed" flow with its own back button — the global header /
// bottom-nav are hidden here.
//
// All DATA is server-resolved and passed in (the visibility-checked ClassDetail,
// the per-type credit cost, and the usable pre-booking balance). The about/blurb,
// instructor, fact grid, and the cancellation policy are display content; the seat
// picker + Book CTA + confirm/error flow live in the client BookingPanel, which
// calls the bookClass server action. No business logic / money math here.

import Link from "next/link";
import type { ClassDetail } from "@/lib/schedule/queries";
import { studioImage } from "@/lib/studio-images";
import { useCustomerLang } from "./customer-context";
import { classDateLabel, endTime, hhmm, TYPE_DOT } from "./schedule-helpers";
import {
  CalendarIcon,
  ChevronLeft,
  Clock,
  Info,
  Pin,
  Users,
} from "./icons";
import { BookingPanel } from "./booking-panel";

export interface ClassDetailViewProps {
  detail: ClassDetail;
  /** Per-type credit cost the debit charges (server-resolved). */
  cost: number;
  /** Usable single-package balance before booking, or null when none covers the cost. */
  balanceBefore: number | null;
  /** Whether this class type assigns reformer positions (multi-seat). */
  usesPositions: boolean;
}

export function ClassDetailView({ detail, cost, balanceBefore, usesPositions }: ClassDetailViewProps) {
  const { t, tt, lang } = useCustomerLang();

  const start = hhmm(detail.startsAt);
  const timeRange = `${start}–${endTime(detail.startsAt, detail.durationMin)}`;
  const dateStr = tt(classDateLabel(detail.startsAt));
  const reformerSub = detail.type === "group" ? `3 ${t("reformers")}` : null;

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      {/* hero — studio photo over the gradient (gradient shows if the image 404s) */}
      <div className="relative h-[168px] shrink-0 bg-gradient-to-b from-taupe/40 via-taupe/20 to-cream">
        {/* eslint-disable-next-line @next/next/no-img-element -- static studio asset in /public */}
        <img
          src={studioImage(detail.id)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        {/* legibility scrim under the back button */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/15 to-transparent" />
        <div className="absolute inset-x-4 top-5 flex justify-between">
          <Link
            href="/schedule"
            aria-label={t("nav_schedule")}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/40 bg-white/55 text-ink backdrop-blur"
          >
            <ChevronLeft size={20} />
          </Link>
        </div>
      </div>

      <div className="relative -mt-[34px]">
        <div className="px-[18px]">
          {/* type pill */}
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-[7px] rounded-full border border-line bg-surface-2 px-[13px] py-1.5 shadow-soft">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: TYPE_DOT[detail.type] }}
                aria-hidden="true"
              />
              <span className="font-body text-[12px] font-semibold tracking-[0.03em] text-ink-soft">
                {tt(detail.typeMeta.short)}
              </span>
            </span>
          </div>

          {/* title */}
          <h1 className="mb-1 font-head text-[28px] font-semibold leading-[1.05] tracking-[0.01em] text-ink">
            {tt(detail.typeMeta.label)}
          </h1>

          {/* fact grid */}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Fact icon={<CalendarIcon size={17} />} label={t("when")} value={timeRange} sub={dateStr} />
            <Fact icon={<Clock size={17} />} label={t("duration")} value={`${detail.durationMin} ${t("min")}`} />
            <Fact
              icon={<Users size={17} />}
              label={t("capacity")}
              value={`${detail.capacity} ${t("people")}`}
              sub={reformerSub}
            />
            <Fact
              icon={<Pin size={17} />}
              label={t("location")}
              value={t("studio_name")}
              sub={t("studio_level")}
            />
          </div>
        </div>

        {/* seat picker + cost + Book CTA (client, calls the server action) */}
        <BookingPanel
          lang={lang}
          detail={detail}
          cost={cost}
          balanceBefore={balanceBefore}
          usesPositions={usesPositions}
          dateStr={dateStr}
          timeRange={timeRange}
        />

        {/* instructor — read-only. For instructor-selectable types (private/duo/
            trio) we surface the class's already-assigned instructor only.
            TODO: instructor *selection* belongs to the private-appointment
            booking flow (future slice). */}
        {detail.instructor && (
          <div className="px-[18px]">
            <h2 className="mb-3 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t("instructor")}
            </h2>
            <div className="flex items-center gap-3 rounded-lune-sm border border-line bg-surface-2 px-4 py-3 shadow-soft">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-taupe font-head text-base font-semibold text-surface-2">
                {tt(detail.instructor.name).replace(/^Kru\s+|^ครู/, "").charAt(0) || "·"}
              </span>
              <div>
                <div className="font-head text-[17px] font-semibold leading-[1.1] text-ink">
                  {tt(detail.instructor.name)}
                </div>
                {detail.instructor.tag && (
                  <div className="mt-0.5 font-body text-[12.5px] text-ink-soft">
                    {tt(detail.instructor.tag)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* about */}
        <div className="mt-5 px-[18px]">
          <h2 className="mb-2 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            {t("about_class")}
          </h2>
          <p className="m-0 font-body text-[14.5px] leading-[1.62] text-ink-soft">
            {tt(detail.typeMeta.blurb)}
          </p>
        </div>

        {/* cancellation policy */}
        <div className="mx-[18px] mb-10 mt-4 flex gap-3 rounded-lune-sm bg-cream-2 px-4 py-3.5">
          <span className="mt-px shrink-0 text-taupe-deep">
            <Info size={20} />
          </span>
          <div>
            <div className="mb-[3px] font-body text-[13px] font-bold text-ink">
              {t("policy_title")}
            </div>
            <div className="font-body text-[13px] leading-[1.55] text-ink-soft">
              {t("policy_body")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-lune-sm border border-line bg-surface-2 px-[15px] py-3 shadow-soft">
      <div className="mb-2 flex items-center gap-[7px] text-taupe">
        {icon}
        <span className="font-body text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
      </div>
      <div className="font-head text-[16px] font-semibold leading-[1.1] text-ink">{value}</div>
      {sub && <div className="mt-0.5 font-body text-[12px] text-muted">{sub}</div>}
    </div>
  );
}
