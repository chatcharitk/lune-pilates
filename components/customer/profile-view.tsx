"use client";

// Customer Profile screen (mirrors lune-extra.jsx `ProfileScreen`): identity block
// (avatar initial, name, Member badge + house number), the warm-gradient credits
// balance hero (tap → /buy), the household-sharing surface (who shares the house
// pool — finding H1), and the package purchase history.
//
// Reads the active language from the CustomerLangProvider so it switches EN/TH
// with the shared Header's toggle. All DATA is the server-resolved ProfileOverview
// (getProfileOverview) — identity, balance, housemates and purchase prices are
// never trusted from the client (CLAUDE.md §5/§8). `pricePaid` may be null
// (comped/seeded packages) → render "—", never "฿null".

import Link from "next/link";
import type { ProfileOverview } from "@/lib/customer/profile";
import { thb } from "@/lib/i18n";
import { useCustomerLang } from "./customer-context";
import { ArrowRight, Sparkle } from "./icons";

export function ProfileView({ overview }: { overview: ProfileOverview }) {
  const { t, tt, lang } = useCustomerLang();
  const { identity, balance, housemates, purchaseHistory } = overview;

  const isMember = identity.tier === "member";
  const hoursLabel = balance.hours === 1 ? t("hour") : t("hours");
  const expiryLabel = balance.nearestExpiry
    ? balance.nearestExpiry.toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  const avatarInitial = identity.name.trim().charAt(0).toUpperCase() || "·";

  return (
    <div className="px-[22px] pb-7 pt-1.5">
      <h1 className="mb-[18px] mt-1 font-head text-3xl font-medium tracking-[0.01em] text-ink">
        {t("nav_profile")}
      </h1>

      {/* identity */}
      <div className="mb-[22px] flex items-center gap-[15px]">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-taupe font-head text-[28px] font-semibold text-surface-2">
          {avatarInitial}
        </span>
        <div className="min-w-0">
          <div className="font-head text-2xl font-semibold text-ink">{identity.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-[9px] py-[3px] font-body text-[11px] font-semibold ${
                isMember ? "bg-cream-2 text-taupe-deep" : "bg-surface text-muted"
              }`}
            >
              {isMember && <Sparkle size={10} className="text-taupe" />}
              {t(isMember ? "member" : "guest")}
            </span>
            {identity.houseNumber && (
              <span className="font-body text-xs text-muted">
                {t("house_label")} {identity.houseNumber}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* balance hero — tappable: opens the buy-credits screen */}
      <Link
        href="/buy"
        aria-label={t("buy_credits")}
        className="relative mb-5 block overflow-hidden rounded-lune border border-line p-5 shadow-md transition-transform active:scale-[0.99]"
        style={{ background: "linear-gradient(150deg, var(--color-surface-2), var(--color-surface))" }}
      >
        <Sparkle
          size={100}
          className="pointer-events-none absolute -right-[18px] -top-[22px] text-taupe/[0.06]"
          aria-hidden="true"
        />
        <p className="m-0 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          {t("credits_remaining")}
        </p>
        <div className="mb-2.5 mt-1 flex items-baseline gap-[7px]">
          <span className="font-head text-5xl font-semibold leading-none text-ink">{balance.hours}</span>
          <span className="font-body text-base font-medium text-taupe">{hoursLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="font-body text-[12.5px] text-ink-soft">
            {balance.isHouseholdPool && identity.houseNumber ? (
              <>
                {t("shared_pool")}
                {expiryLabel && (
                  <>
                    {" · "}
                    {t("valid_until")} <strong className="text-ink">{expiryLabel}</strong>
                  </>
                )}
              </>
            ) : expiryLabel ? (
              <>
                {t("valid_until")} <strong className="text-ink">{expiryLabel}</strong>
              </>
            ) : null}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-body text-[13px] font-semibold text-taupe-deep">
            {t("buy_credits")}
            <ArrowRight size={15} />
          </span>
        </div>
      </Link>

      {/* household sharing surface (H1) — who shares the house pool */}
      <section className="mb-5">
        <h2 className="mx-0.5 mb-3 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          {t("shared_with")}
        </h2>
        {housemates.length > 0 ? (
          <div className="overflow-hidden rounded-lune border border-line bg-surface-2">
            <ul>
              {housemates.map((m, i) => (
                <li
                  key={m.id}
                  className={`flex items-center gap-3 px-[18px] py-3.5 ${
                    i < housemates.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cream-2 font-head text-sm font-semibold text-taupe-deep">
                    {m.name.trim().charAt(0).toUpperCase() || "·"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-body text-[14px] font-semibold text-ink">
                    {m.name}
                    {m.isViewer && (
                      <span className="font-normal text-muted"> · {t("you")}</span>
                    )}
                  </span>
                  {m.tier === "guest" && (
                    <span className="shrink-0 rounded-full bg-surface px-2.5 py-[3px] font-body text-[10.5px] font-semibold text-muted">
                      {t("guest")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          // Guest (no household — invariant 3) or member without a household.
          <div className="rounded-lune border border-line bg-surface-2 px-[18px] py-4 font-body text-[13px] leading-relaxed text-ink-soft">
            {t("guest_no_household")}
          </div>
        )}
      </section>

      {/* package purchase history */}
      <section>
        <h2 className="mx-0.5 mb-3 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          {t("package_history")}
        </h2>
        {purchaseHistory.length > 0 ? (
          <div className="overflow-hidden rounded-lune border border-line bg-surface-2">
            <ul>
              {purchaseHistory.map((p, i) => (
                <li
                  key={p.id}
                  className={`flex items-center justify-between gap-3 px-[18px] py-[15px] ${
                    i < purchaseHistory.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-head text-[18px] font-semibold text-ink">
                      {tt(p.label)}
                    </div>
                    <div className="mt-0.5 font-body text-xs text-muted">
                      {p.purchasedAt.toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                  <span className="shrink-0 font-body text-sm font-semibold text-ink-soft">
                    {p.pricePaid !== null ? thb(p.pricePaid) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-lune border border-line bg-surface-2 px-[18px] py-4 font-body text-[13px] text-ink-soft">
            {t("no_purchases")}
          </div>
        )}
      </section>
    </div>
  );
}
