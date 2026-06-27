"use client";

// The fixed customer bottom navigation. Hidden on focused sub-flows (the
// buy-credits checkout, the class detail booking flow) where a sticky footer owns
// the bottom edge — mirroring the prototype, where pushing those screens replaces
// the nav.
//
// Labels are read live from the CustomerLangProvider (useCustomerLang) so they
// switch with the EN/TH toggle — mirroring the admin MobileNav. The nav items
// (href + icon + string key) are defined here, not passed pre-translated, so the
// layout can stay a server component and the nav owns its own translation.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCustomerLang } from "./customer-context";
import type { StrKey } from "@/lib/i18n";

interface NavItem {
  href: string;
  key: StrKey;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  { href: "/home", key: "nav_home", icon: <path d="M3 11l9-8 9 8M5 10v10h14V10" /> },
  {
    href: "/schedule",
    key: "nav_schedule",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </>
    ),
  },
  { href: "/bookings", key: "nav_bookings", icon: <path d="M5 12h14M12 5l7 7-7 7" /> },
  {
    href: "/profile",
    key: "nav_profile",
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  },
];

// Route prefixes that render their own focused flow (no global nav).
const HIDE_ON: readonly string[] = ["/buy", "/join"];

function isHidden(pathname: string): boolean {
  if (HIDE_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  // The class detail (/schedule/<id>) is a focused booking flow with its own
  // cost + Book CTA at the bottom — hide the global nav there so the two don't
  // stack. The /schedule list itself keeps the nav.
  if (pathname.startsWith("/schedule/")) return true;
  return false;
}

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useCustomerLang();
  if (isHidden(pathname)) {
    return null;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[440px] border-t border-line bg-surface-2/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="flex items-stretch justify-around px-2 py-2">
        {NAV.map((n) => {
          const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 rounded-2xl px-4 py-1.5 transition-colors hover:text-taupe-deep ${
                  active ? "text-ink" : "text-muted"
                }`}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 1.9 : 1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {n.icon}
                </svg>
                <span className="font-body text-[10px] font-medium tracking-wide">{t(n.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
