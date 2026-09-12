"use client";

// The Settings hub: a plain list of the owner's configuration surfaces. Purely
// navigational — it reads nothing and writes nothing, so each destination page
// stays the single place its own data is fetched and gated.

import Link from "next/link";
import { useAdminLang } from "./admin-context";
import type { StrKey } from "@/lib/i18n";

interface SettingsLink {
  href: string;
  titleKey: StrKey;
  descKey: StrKey;
  icon: React.ReactNode;
}

const LINKS: SettingsLink[] = [
  {
    href: "/admin/settings/terms",
    titleKey: "settings_terms_title",
    descKey: "settings_terms_desc",
    icon: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </>
    ),
  },
  {
    href: "/admin/settings/studio",
    titleKey: "settings_studio_title",
    descKey: "settings_studio_desc",
    icon: (
      <>
        <path d="M3 21h18M5 21V8l7-5 7 5v13" />
        <path d="M10 21v-6h4v6" />
      </>
    ),
  },
  {
    href: "/admin/settings/promos",
    titleKey: "settings_promos_title",
    descKey: "settings_promos_desc",
    icon: (
      <>
        <path d="M20.6 8.4 12 3 3.4 8.4v7.2L12 21l8.6-5.4z" />
        <path d="M9 12h6M12 9v6" />
      </>
    ),
  },
  // Existing routes — see the page doc for why they are linked, not re-homed.
  {
    href: "/admin/visibility",
    titleKey: "admin_visibility",
    descKey: "settings_windows_desc",
    icon: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    href: "/admin/packages",
    titleKey: "admin_packages",
    descKey: "settings_packages_desc",
    icon: (
      <>
        <path d="M21 8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" />
        <rect x="2" y="4" width="20" height="4" rx="1" />
        <path d="M12 4v16" />
      </>
    ),
  },
];

export function SettingsView() {
  const { t } = useAdminLang();

  return (
    <div>
      <div className="mb-5 max-w-2xl">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("admin_settings")}
        </h1>
        <p className="mt-1 font-body text-[13.5px] leading-relaxed text-muted">
          {t("settings_subtitle")}
        </p>
      </div>

      <ul className="flex max-w-2xl flex-col gap-2.5">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="flex items-center gap-3.5 rounded-xl border border-line bg-surface px-4 py-3.5 transition-colors hover:bg-cream-2"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cream-2 text-taupe-deep">
                <svg
                  width={19}
                  height={19}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {l.icon}
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-body text-[14px] font-semibold text-ink">
                  {t(l.titleKey)}
                </span>
                <span className="mt-0.5 block font-body text-[12.5px] leading-snug text-muted">
                  {t(l.descKey)}
                </span>
              </span>
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0 text-muted"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
