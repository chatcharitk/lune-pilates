"use client";

// Admin chrome: dark sidebar (md+), top bar with the EN/TH toggle, and a mobile
// bottom nav — mirroring admin-shell.jsx. Mobile-first, responsive to iPad/
// desktop (CLAUDE.md §1). All copy is keyed (no hardcoded strings); the active
// language comes from AdminLangProvider so chrome + pages switch together.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { AdminLangProvider, useAdminLang } from "./admin-context";
import type { AdminRole } from "@/lib/auth/admin";
import type { Lang, StrKey } from "@/lib/i18n";

// Mobile bottom bar fits five primary destinations + a "More" overflow; the
// overflow sheet holds the rest so nothing 404s or is unreachable on a phone
// (Feature 4 nav decision: Dashboard + Instructors live behind "More"). Desktop
// shows every item in the sidebar.
const MOBILE_OVERFLOW: ReadonlySet<string> = new Set([
  "/admin/dashboard",
  "/admin/instructors",
  "/admin/sales",
]);

interface NavItem {
  href: string;
  key: StrKey;
  icon: React.ReactNode;
  /**
   * Owner-only destination — hidden from an instructor (who only sees Today). Only
   * Today is `false`; every other item is owner-only. Filtering here is a UX/nav
   * concern; the real authorization is server-side per page (requireOwner).
   */
  ownerOnly?: boolean;
}

const NAV: NavItem[] = [
  {
    href: "/admin/dashboard",
    key: "admin_dashboard",
    ownerOnly: true,
    icon: <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />,
  },
  {
    href: "/admin/today",
    key: "admin_today",
    ownerOnly: false,
    icon: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  },
  {
    href: "/admin/schedule",
    key: "admin_schedule",
    ownerOnly: true,
    icon: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </>
    ),
  },
  {
    href: "/admin/bookings",
    key: "admin_bookings",
    ownerOnly: true,
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M9 14h6" />
      </>
    ),
  },
  {
    href: "/admin/members",
    key: "admin_members",
    ownerOnly: true,
    icon: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 0 0 0-6M21 20a6 6 0 0 0-5-5.9" />
      </>
    ),
  },
  {
    href: "/admin/payments",
    key: "admin_payments",
    ownerOnly: true,
    icon: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M7 15h3" />
      </>
    ),
  },
  {
    href: "/admin/instructors",
    key: "admin_instructors",
    ownerOnly: true,
    icon: <path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01" />,
  },
  {
    href: "/admin/sales",
    key: "admin_sales",
    ownerOnly: true,
    icon: (
      <>
        <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />
        <path d="m4 13 4-3 4 2 5-5" />
      </>
    ),
  },
];

/** Nav items visible to `role`: instructors see only the non-owner-only items. */
function navForRole(role: AdminRole): NavItem[] {
  return NAV.filter((item) => !item.ownerOnly || role === "owner");
}

function NavIcon({ icon, size = 20 }: { icon: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon}
    </svg>
  );
}

function Brand({ light }: { light?: boolean }) {
  const { t } = useAdminLang();
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`font-brand text-2xl font-semibold tracking-[0.18em] ${light ? "text-cream" : "text-taupe-deep"}`}
      >
        LUN<span className="lune-spark">E</span>
      </span>
      <span
        className={`border-l pl-2.5 font-body text-[9px] font-semibold uppercase tracking-[0.2em] ${
          light ? "border-cream/20 text-cream/50" : "border-line text-muted"
        }`}
      >
        {t("admin_label")}
      </span>
    </div>
  );
}

function Sidebar({ role }: { role: AdminRole }) {
  const { t } = useAdminLang();
  const pathname = usePathname();
  const nav = navForRole(role);
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-admin-ink text-cream md:flex">
      <div className="px-6 py-7">
        <Brand light />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {nav.map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-3 font-body text-[14.5px] transition-colors ${
                active
                  ? "bg-cream/12 font-semibold text-cream"
                  : "font-medium text-cream/65 hover:bg-cream/10 hover:text-cream"
              }`}
            >
              <NavIcon icon={n.icon} />
              <span>{t(n.key)}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#c9b89e]" />}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-cream/12 p-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream/16 font-body text-sm font-bold text-cream">
            ก
          </span>
          <div className="min-w-0">
            <p className="truncate font-body text-[13px] font-semibold text-cream">Kru Mai</p>
            <p className="font-body text-[11px] text-cream/50">{t("admin_greeting")}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function LangToggle() {
  const { t, lang, setLang } = useAdminLang();
  return (
    <div
      className="flex h-9 overflow-hidden rounded-full border border-line bg-surface-2"
      role="group"
      aria-label={t("aria_language")}
    >
      {(["th", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`px-3 font-body text-xs font-semibold uppercase tracking-wide transition-colors ${
            lang === l ? "bg-ink text-cream" : "text-muted"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Topbar() {
  const { t } = useAdminLang();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-cream/85 px-5 py-3 backdrop-blur md:px-10">
      <div className="md:hidden">
        <Brand />
      </div>
      <div className="ml-auto flex items-center gap-2.5">
        <button
          type="button"
          aria-label={t("aria_notifications")}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-soft"
        >
          <NavIcon
            size={18}
            icon={<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />}
          />
        </button>
        <LangToggle />
      </div>
    </header>
  );
}

function MobileNav({ role }: { role: AdminRole }) {
  const { t } = useAdminLang();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const nav = navForRole(role);
  const primary = nav.filter((n) => !MOBILE_OVERFLOW.has(n.href));
  const overflow = nav.filter((n) => MOBILE_OVERFLOW.has(n.href));
  const overflowActive = overflow.some(
    (n) => pathname === n.href || pathname.startsWith(n.href + "/"),
  );

  return (
    <nav className="sticky bottom-0 z-20 border-t border-cream/10 bg-admin-ink pb-[env(safe-area-inset-bottom)] text-cream md:hidden">
      <ul className="flex items-stretch justify-around px-1 py-2">
        {primary.map((n) => {
          const active = pathname === n.href || pathname.startsWith(n.href + "/");
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 px-2.5 py-1 ${
                  active ? "text-cream" : "text-cream/60"
                }`}
              >
                <NavIcon icon={n.icon} size={21} />
                <span className="font-body text-[10px] font-medium">{t(n.key)}</span>
              </Link>
            </li>
          );
        })}
        {overflow.length > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`flex flex-col items-center gap-1 px-2.5 py-1 ${
                overflowActive ? "text-cream" : "text-cream/60"
              }`}
            >
              <NavIcon
                icon={<><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>}
                size={21}
              />
              <span className="font-body text-[10px] font-medium">{t("admin_more")}</span>
            </button>
          </li>
        )}
      </ul>
      {moreOpen && (
        <MoreSheet items={overflow} pathname={pathname} onClose={() => setMoreOpen(false)} />
      )}
    </nav>
  );
}

/** Bottom sheet holding the mobile nav overflow (Dashboard + Instructors). */
function MoreSheet({
  items,
  pathname,
  onClose,
}: {
  items: NavItem[];
  pathname: string;
  onClose: () => void;
}) {
  const { t } = useAdminLang();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab within the dialog so focus can't escape to the page behind it.
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] text-ink">
      <button
        type="button"
        aria-label={t("aria_close")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 rounded-t-[22px] bg-surface pb-[env(safe-area-inset-bottom)] shadow-lift"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 id={titleId} className="font-head text-lg font-semibold text-ink">
            {t("admin_more")}
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("aria_close")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-soft"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ul className="flex flex-col gap-1 p-3">
          {items.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3.5 py-3.5 font-body text-[15px] transition-colors ${
                    active ? "bg-cream-2 font-semibold text-ink" : "font-medium text-ink-soft hover:bg-cream-2"
                  }`}
                >
                  <NavIcon icon={n.icon} />
                  <span>{t(n.key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function AdminShell({
  children,
  role = "owner",
}: {
  children: React.ReactNode;
  /** The acting admin's role — an instructor's nav collapses to just Today. */
  role?: AdminRole;
}) {
  return (
    <AdminLangProvider>
      <div className="flex min-h-dvh bg-cream">
        <Sidebar role={role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 px-5 py-6 md:px-10 md:py-9">{children}</main>
          <MobileNav role={role} />
        </div>
      </div>
    </AdminLangProvider>
  );
}
