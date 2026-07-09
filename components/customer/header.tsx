"use client";

// Shared customer header (mirrors lune-ui.jsx `Header` / `BrandLockup` /
// `LangToggle`): the LUNE wordmark lockup with the sparkle "E" motif, the EN/TH
// language toggle, and a notification bell. Shown on the in-nav screens (home,
// schedule, bookings, profile). The active language comes from the
// CustomerLangProvider so the whole app switches together.

import { usePathname } from "next/navigation";
import { useCustomerLang } from "./customer-context";
import { Bell } from "./icons";
import type { Lang } from "@/lib/i18n";

// Route prefixes that render their own focused flow with a back button (no global
// header) — mirrors the prototype, where the detail/credits screens are "pushed"
// over the tab chrome. Kept in sync with bottom-nav.tsx's HIDE_ON.
const HIDE_ON: readonly string[] = ["/buy"];

function isHidden(pathname: string): boolean {
  if (HIDE_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (pathname.startsWith("/schedule/")) return true;
  return false;
}

/** The LUNE wordmark with the 4-point sparkle on the "E" (lune-spark utility). */
export function BrandLockup() {
  return (
    <span className="font-brand text-[26px] font-semibold leading-none tracking-[0.18em] text-taupe-deep">
      LUN<span className="lune-spark">E</span>
    </span>
  );
}

/** EN/TH segmented toggle. Order TH·EN matches the prototype LangToggle.
 *  Exported for screens with their own header chrome (e.g. Buy), so the language
 *  switch is reachable everywhere. */
export function LangToggle() {
  const { t, lang, setLang } = useCustomerLang();
  return (
    <div
      className="flex h-10 overflow-hidden rounded-full border border-line bg-surface-2"
      role="group"
      aria-label={t("aria_language")}
    >
      {(["th", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`px-[13px] font-body text-[12.5px] font-semibold uppercase tracking-wide transition-colors ${
            lang === l ? "bg-ink text-cream" : "text-muted"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const { t } = useCustomerLang();
  if (isHidden(pathname)) return null;

  return (
    <header className="flex shrink-0 items-center justify-between bg-cream px-[18px] pb-2.5 pt-6">
      <BrandLockup />
      <div className="flex items-center gap-2">
        <LangToggle />
        <button
          type="button"
          aria-label={t("aria_notifications")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-ink-soft"
        >
          <Bell size={20} />
        </button>
      </div>
    </header>
  );
}
