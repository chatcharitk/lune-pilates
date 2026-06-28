"use client";

// Buy-credits screen chrome (mirrors the prototype CreditsScreen header + balance
// recap), reading the active language from the CustomerLangProvider so the whole
// screen switches EN/TH. The interactive catalog + PromptPay checkout live in
// CheckoutPanel. This is a "pushed" flow with its own back button — the global
// header/bottom-nav are hidden here (see header.tsx / bottom-nav.tsx).
//
// Money is never computed here: the balance recap is a display read of the
// server-resolved pool; prices/hours/validity come from the catalog contract and
// the post-purchase balance from the checkout action inside CheckoutPanel.

import Link from "next/link";
import type { CatalogCategory } from "@/lib/catalog/packages";
import { useCustomerLang } from "./customer-context";
import { ChevronLeft } from "./icons";
import { CheckoutPanel } from "./checkout-panel";

export interface BuyViewProps {
  catalog: CatalogCategory[];
  /** The server-resolved usable pool balance (hours), display only. */
  hours: number;
  /** Soonest expiry across the pool as an ISO instant, or null when empty. */
  nearestExpiryIso: string | null;
  /** Whether the viewer is a member with household sharing (display only). */
  isMember: boolean;
  /** The member's house number, for the perk badge (display only). */
  house: string;
}

export function BuyView({ catalog, hours, nearestExpiryIso, isMember, house }: BuyViewProps) {
  const { t, lang } = useCustomerLang();
  const hoursLabel = hours === 1 ? t("hour") : t("hours");
  const expiryLabel = nearestExpiryIso
    ? new Date(nearestExpiryIso).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      {/* header */}
      <header className="flex shrink-0 items-center gap-2 bg-cream px-4 pb-2 pt-6">
        <Link
          href="/home"
          aria-label={t("nav_home")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-ink-soft"
        >
          <ChevronLeft size={20} />
        </Link>
        <h1 className="m-0 font-head text-[24px] font-medium tracking-[0.01em] text-ink">
          {t("packages")}
        </h1>
      </header>

      <div className="pt-2">
        {/* balance recap */}
        <div className="mx-[18px] mb-4 flex items-center justify-between rounded-lune-sm border border-line bg-surface-2 px-4 py-3 shadow-soft">
          <div>
            <p className="m-0 font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t("credits_remaining")}
            </p>
            <div className="mt-0.5 font-head text-[22px] font-semibold text-ink">
              {hours}{" "}
              <span className="font-body text-sm font-medium text-taupe">{hoursLabel}</span>
            </div>
          </div>
          {expiryLabel && (
            <div className="text-right">
              <div className="font-body text-[11px] text-muted">{t("valid_until")}</div>
              <div className="mt-0.5 font-body text-[13.5px] font-semibold text-ink">
                {expiryLabel}
              </div>
            </div>
          )}
        </div>

        {/* tabs + cards + promo + perk + sticky bar + checkout sheet */}
        <CheckoutPanel catalog={catalog} isMember={isMember} house={house} />
      </div>
    </div>
  );
}
