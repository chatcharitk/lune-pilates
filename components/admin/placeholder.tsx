"use client";

// Placeholder for admin screens not yet built (Schedule, Bookings, Members,
// Payments, Instructors). Keeps the nav fully navigable — no 404s — and stays
// bilingual via the admin language context. Replaced as each screen lands.

import { useAdminLang } from "./admin-context";
import { BrandLogo } from "@/components/brand";
import type { StrKey } from "@/lib/i18n";

export function ComingSoon({ titleKey }: { titleKey: StrKey }) {
  const { t } = useAdminLang();
  return (
    <div>
      <h1 className="mb-6 font-head text-2xl font-semibold tracking-tight text-ink">
        {t(titleKey)}
      </h1>
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-2 p-10 text-center">
        <BrandLogo
          imgHeight={52}
          fallback={
            <span className="font-brand text-3xl font-semibold text-taupe-deep">
              LUN<span className="lune-spark">E</span>
            </span>
          }
        />
        <p className="font-body text-sm text-muted">{t("admin_coming_soon")}</p>
      </div>
    </div>
  );
}
