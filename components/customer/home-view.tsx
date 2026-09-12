"use client";

// Customer Home (CLAUDE.md §4–§6, spec §4). Warm-gradient balance hero with the
// sparkle motif, a date-aware greeting, the viewer's next-class card with a
// "starts in" countdown, one primary CTA, a horizontal this-week strip, and the
// policy clarity. Mirrors lune-pilates/project/lune-home.jsx pixel-faithfully and
// reads the active language from the CustomerLangProvider so it switches EN/TH
// with the shared Header's toggle.
//
// All DATA is server-resolved and passed in: the balance hero shows the real
// summed household pool (invariant 2); the next-class card shows the viewer's real
// soonest upcoming booking with the server-computed time-until-start; the
// this-week strip is the SAME real bookable query the Schedule screen uses (so the
// two never disagree); and `hasOffer` reflects a live waitlist hold. This view
// only renders + translates — no business logic, no money math. The greeting and
// long date are derived from the viewer's local clock (display-only).

import Link from "next/link";
import type { MyBooking } from "@/lib/bookings/queries";
import type { BookableClass } from "@/lib/schedule/queries";
import { STR, type StrKey } from "@/lib/i18n";
import type { PackageCategory } from "@/lib/domain/types";
import { useCustomerLang } from "./customer-context";
import {
  classDateLabel,
  greetingKey,
  hhmm,
  hoursUntilLabel,
  longDateLabel,
  relativeDateLabel,
  TYPE_DOT,
} from "./schedule-helpers";
import { Bell, Clock, Sparkle } from "./icons";
import { formatStudioDate, studioDayFromYmd } from "@/lib/time";
import { studioImage } from "@/lib/studio-images";

export interface HomeViewProps {
  /** Viewer identity (display only — server-resolved). */
  viewer: { name: string; tier: "member" | "guest"; houseNumber: string | null; avatarUrl: string | null };
  /**
   * The viewer's usable balance PER CLASS FORMAT, biggest first, server-resolved.
   * Only formats they actually hold appear — a balance can only book its own format
   * (they are not interchangeable), so there is deliberately no combined total.
   */
  balances: {
    category: PackageCategory;
    classes: number;
    nearestExpiryIso: string | null;
    /** Credits within this pool that only open particular days' classes. */
    eventCredits: { days: string[]; classes: number }[];
  }[];
  /** true when these balances are the shared household pool rather than personal. */
  isHouseholdPool: boolean;
  /** The viewer's soonest upcoming booking, or null to hide the card. */
  next: MyBooking | null;
  /** Whether the viewer holds a live (`offered`) waitlist hold right now. */
  hasOffer: boolean;
  /** This-week preview rows — the real bookable query (same as the Schedule screen). */
  week: BookableClass[];
}

/** Class format → its i18n label key (mirrors the Buy screen's tab labels). */
const CATEGORY_KEY: Record<PackageCategory, StrKey> = {
  group: "cat_group",
  private: "cat_private",
  duo: "cat_duo",
  trio: "cat_trio",
  rental: "cat_rental",
};

export function HomeView({
  viewer,
  balances,
  isHouseholdPool,
  next,
  hasOffer,
  week,
}: HomeViewProps) {
  const { t, tt, lang } = useCustomerLang();
  const avatarInitial = viewer.name.trim().charAt(0).toUpperCase() || "·";

  function expiryLabelFor(iso: string | null): string | null {
    return iso
      ? formatStudioDate(new Date(iso), lang, { day: "numeric", month: "short", year: "numeric" })
      : null;
  }

  return (
    <div className="px-[18px] pt-1.5">
      {/* greeting — date-aware time-of-day line, long localized date, and the
          LINE avatar with the green "L" presence badge (lune-home.jsx). */}
      <header className="mb-[18px] mt-1 flex items-center justify-between gap-3.5">
        <div className="min-w-0">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            {tt(longDateLabel())}
          </p>
          <h1 className="mt-1.5 font-head text-[28px] font-medium leading-[1.1] tracking-[0.01em] text-ink">
            {t(greetingKey())}
            <br />
            <span className="text-taupe-deep">{viewer.name}</span>
          </h1>
        </div>
        <div className="relative shrink-0">
          {viewer.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external LINE CDN photo, not an optimizable asset
            <img
              src={viewer.avatarUrl}
              alt={viewer.name}
              className="h-[52px] w-[52px] rounded-full border-2 border-surface-2 object-cover shadow-md"
            />
          ) : (
            <span className="grid h-[52px] w-[52px] place-items-center rounded-full border-2 border-surface-2 bg-taupe font-head text-xl font-semibold text-surface-2 shadow-md">
              {avatarInitial}
            </span>
          )}
          <span
            className="absolute -bottom-0.5 -right-0.5 grid h-[20px] w-[20px] place-items-center rounded-full border-[2.5px] border-cream font-body text-[9px] font-extrabold tracking-[-0.5px] text-white"
            style={{ background: "#06C755" }}
            aria-hidden="true"
          >
            L
          </span>
        </div>
      </header>

      {/* balance hero — warm cream gradient + sparkle motif; tappable to /buy.
          Same treatment as the Profile screen so the two stay consistent. */}
      {/* CLASS BALANCES — one per format the viewer holds (2026-09-08).
          Group, 1:1, Duo, Trio and Rental classes are separate balances that can
          only book their own format, so this deliberately shows NO combined total:
          a customer with 5 group and 2 duo classes has no "7" they can spend on
          anything. Empty formats are omitted rather than shown as zeros. */}
      <Link
        href="/buy"
        aria-label={t("buy_credits")}
        className="relative block overflow-hidden rounded-lune border border-line p-[18px] shadow-md transition-transform active:scale-[0.99]"
        style={{ background: "linear-gradient(150deg, var(--color-surface-2), var(--color-surface))" }}
      >
        <Sparkle
          size={120}
          className="pointer-events-none absolute -right-[22px] -top-[26px] text-taupe/[0.05]"
          aria-hidden="true"
        />
        <div className="relative flex items-start justify-between">
          <span className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            {balances.length > 0 ? t("balances_title") : t("credits_remaining")}
          </span>
          {viewer.tier === "member" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-2 px-[11px] py-[5px] font-body text-[11.5px] font-semibold tracking-[0.02em] text-taupe-deep">
              <Sparkle size={11} className="text-taupe" aria-hidden="true" />
              {t("member")}
            </span>
          )}
        </div>

        {balances.length === 0 ? (
          /* Nothing to show — say so plainly and point at the shop, rather than a
             row of zeros for formats they have never bought. */
          <div className="relative mt-2">
            <p className="m-0 font-head text-[26px] font-semibold leading-tight text-ink">
              {t("balances_empty_title")}
            </p>
            <p className="m-0 mt-1 font-body text-[13px] text-ink-soft">
              {t("balances_empty_body")}
            </p>
          </div>
        ) : (
          <ul className="relative mt-3 flex flex-col">
            {balances.map((b, i) => {
              const expiry = expiryLabelFor(b.nearestExpiryIso);
              return (
                <li
                  key={b.category}
                  className={`flex items-baseline justify-between gap-3 py-2.5 ${
                    i > 0 ? "border-t border-line" : "pt-0"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-head text-[15px] font-semibold leading-tight text-ink">
                      {t(CATEGORY_KEY[b.category])}
                    </span>
                    {expiry && (
                      <span className="mt-0.5 block font-body text-[11.5px] leading-tight text-muted">
                        {t("balance_expires").replace("{date}", expiry)}
                      </span>
                    )}
                    {/* Part of this number may be EVENT credits, good only for the
                        classes of certain days. Saying so here is the difference
                        between a balance and a promise the booking screen breaks. */}
                    {b.eventCredits.map((e) => (
                      <span
                        key={e.days.join(",")}
                        className="mt-1 block font-body text-[11.5px] leading-tight text-taupe-deep"
                      >
                        {t("balance_event_days")
                          .replace("{n}", String(e.classes))
                          .replace(
                            "{days}",
                            e.days
                              .map((d) =>
                                formatStudioDate(studioDayFromYmd(d), lang, {
                                  day: "numeric",
                                  month: "short",
                                }),
                              )
                              .join(" · "),
                          )}
                      </span>
                    ))}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    <span className="font-head text-[30px] font-semibold leading-none text-ink tabular-nums">
                      {b.classes}
                    </span>
                    <span className="font-body text-[13px] font-medium text-taupe">
                      {b.classes === 1 ? t("hour") : t("hours")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="relative mt-2.5 flex items-center justify-between gap-4 border-t border-line pt-3">
          <span className="min-w-0 font-body text-[12.5px] text-ink-soft">
            {/* Nothing to caption when they hold nothing — "shared with your house"
                over an empty balance reads as a bug. */}
            {balances.length === 0
              ? null
              : balances.length > 1
                ? t("balances_note")
                : isHouseholdPool && viewer.houseNumber
                  ? t("balance_pool_shared")
                  : null}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-body text-[13.5px] font-semibold text-taupe-deep">
            {t("buy_credits")}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </div>
      </Link>

      {/* waitlist offer banner — only when a live offer is outstanding. Minimal,
          links to /bookings where the countdown + Confirm live. */}
      {hasOffer && (
        <Link
          href="/bookings"
          className="mt-4 flex items-center gap-3 rounded-lune-sm border border-sage/40 bg-sage/10 px-4 py-3 shadow-soft transition-transform active:scale-[0.99]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sage text-white">
            <Bell size={17} />
          </span>
          <span className="flex-1 font-body text-[13.5px] font-semibold text-sage-deep">
            {t("spot_opened_banner")}
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-sage-deep"><path d="M9 6l6 6-6 6" /></svg>
        </Link>
      )}

      {/* next class — the viewer's real soonest upcoming booking; hidden if none.
          The "starts in {time}" countdown uses the server-computed
          cancellation.hoursUntilStart (never recomputed here). */}
      {next && (
        <section className="mt-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-body text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              {t("next_class")}
            </h2>
            {next.cancellation.hoursUntilStart > 0 && (
              <span className="font-body text-xs text-muted">
                {t("starts_in")} {tt(hoursUntilLabel(next.cancellation.hoursUntilStart))}
              </span>
            )}
          </div>
          <Link
            href="/bookings"
            className="flex items-center gap-0 overflow-hidden rounded-lune border border-line bg-surface-2 shadow-soft transition-transform active:scale-[0.99]"
          >
            {/* studio-photo thumbnail over a taupe gradient (gradient shows if the
                image is missing). */}
            <span
              aria-hidden="true"
              className="relative h-[82px] w-[80px] shrink-0 overflow-hidden"
              style={{ background: "linear-gradient(150deg, var(--color-cream-2), var(--color-taupe))" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static studio asset in /public */}
              <img
                src={studioImage(next.type)}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </span>
            <div className="min-w-0 flex-1 px-4 py-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span
                  className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: TYPE_DOT[next.type] }}
                  aria-hidden="true"
                />
                <span className="font-body text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                  {tt(next.typeMeta.short)}
                </span>
              </div>
              <p className="font-head text-[17px] font-semibold leading-[1.1] text-ink">
                {tt(next.typeMeta.label)}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
                <Clock size={14} className="shrink-0 text-muted" />
                <span>
                  {tt(relativeDateLabel(next.startsAt, STR.today, STR.tomorrow))} · {hhmm(next.startsAt)} ·{" "}
                  {next.durationMin} {t("min")}
                </span>
              </p>
            </div>
          </Link>
        </section>
      )}

      {/* primary action — the only hero CTA */}
      <Link
        href="/schedule"
        className="mt-5 flex items-center justify-center gap-2 rounded-lune bg-taupe px-6 py-3.5 font-head text-base font-semibold text-cream shadow-soft transition-colors hover:bg-taupe-deep"
      >
        {t("book_a_class")}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </Link>

      {/* this week — horizontal-scroll strip of bookable cards (lune-home.jsx). */}
      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-body text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            {t("this_week")}
          </h2>
          <Link href="/schedule" className="font-body text-[13px] font-semibold text-taupe-deep">
            {t("see_all")}
          </Link>
        </div>
        {week.length > 0 ? (
          // Bleed the row to the screen edges so cards can scroll past the gutter,
          // then re-pad the inner content (mirrors lune-home.jsx's -22px margin).
          <ul className="-mx-[18px] flex gap-2.5 overflow-x-auto px-[18px] pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {week.map((c) => (
              <li key={c.id} className="shrink-0">
                <ThisWeekCard cls={c} dateLabel={tt(classDateLabel(c.startsAt))} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lune-sm border border-line bg-surface-2 px-4 py-5 text-center font-body text-[13px] text-muted">
            {t("no_classes")}
          </p>
        )}
      </section>

      {/* policy clarity */}
      <p className="mt-5 rounded-lune-sm border-l-2 border-taupe bg-surface px-4 py-3 font-body text-[12.5px] leading-relaxed text-ink-soft">
        {t("policy_body")}
      </p>
      <p className="mt-3 text-center font-body text-[11px] text-muted">{t("open_hours")}</p>
    </div>
  );
}

// ───────────────────────── this-week card ─────────────────────────

function ThisWeekCard({ cls, dateLabel }: { cls: BookableClass; dateLabel: string }) {
  const { t, tt } = useCustomerLang();
  const low = cls.seatsLeft <= 1;
  return (
    <Link
      href={`/schedule/${cls.id}`}
      className="block w-[144px] overflow-hidden rounded-lune-sm border border-line bg-surface-2 shadow-soft transition-transform active:scale-[0.98]"
    >
      {/* studio-photo band over a taupe gradient (gradient shows if missing) */}
      <span
        aria-hidden="true"
        className="relative block h-[76px] w-full"
        style={{ background: "linear-gradient(150deg, var(--color-cream-2), var(--color-taupe))" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static studio asset in /public */}
        <img
          src={studioImage(cls.type)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </span>
      <div className="px-3.5 py-3">
      <p className="mb-2 font-body text-xs font-semibold uppercase tracking-[0.04em] text-taupe-deep">
        {dateLabel}
      </p>
      <p className="font-head text-lg font-semibold leading-[1.1] text-ink">{hhmm(cls.startsAt)}</p>
      <div className="mb-2.5 mt-1 flex items-center gap-1.5">
        <span
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: TYPE_DOT[cls.type] }}
          aria-hidden="true"
        />
        <span className="truncate font-body text-[12.5px] text-ink-soft">{cls.name || tt(cls.typeMeta.short)}</span>
      </div>
      <p className={`font-body text-[11.5px] font-semibold ${low ? "text-rose" : "text-sage-deep"}`}>
        {cls.seatsLeft} {cls.seatsLeft === 1 ? t("spot_left") : t("spots_left")}
      </p>
      </div>
    </Link>
  );
}
