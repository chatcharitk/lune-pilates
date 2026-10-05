"use client";

// Admin "Households" (2026-10-05): one card per house number — who is in it and
// how many classes the house has left, by class type — and a drawer listing the
// house's packages. Read-only: people are added to / moved between houses on the
// Members page (updateCustomer), so this screen has one job, making the sharing
// visible. A house holding classes with nobody in it is flagged and sorted first.
//
// Balances are the server's (lib/admin/households.ts); this view imports only types.

import { useMemo, useState } from "react";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Dot, Drawer, Sparkle } from "./ui";
import type { AdminHousehold, HouseholdPackage } from "@/lib/admin/households";
import type { PackageCategory } from "@/lib/domain/types";
import type { StrKey } from "@/lib/i18n";
import { formatStudioDate } from "@/lib/time";

const CAT_KEY: Record<PackageCategory, StrKey> = {
  group: "cat_group",
  private: "cat_private",
  duo: "cat_duo",
  trio: "cat_trio",
  rental: "cat_rental",
};

function fmtDate(iso: string, lang: "en" | "th"): string {
  return formatStudioDate(new Date(iso), lang, { day: "numeric", month: "short", year: "numeric" });
}

export function HouseholdsView({ households }: { households: AdminHousehold[] }) {
  const { t } = useAdminLang();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Search by house number, or by anyone living there (name / phone).
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return households;
    return households.filter(
      (h) =>
        h.houseNumber.toLowerCase().includes(term) ||
        h.members.some((m) => m.name.toLowerCase().includes(term) || m.phone.includes(term)),
    );
  }, [households, q]);

  const open = households.find((h) => h.id === openId) ?? null;

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">{t("admin_households")}</h1>
        <p className="mt-1 font-body text-[13.5px] text-muted">
          {t("hh_subtitle").replace("{n}", String(households.length))}
        </p>
      </div>

      <div className="relative mb-[18px] max-w-[420px]">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("hh_search")}
          aria-label={t("hh_search")}
          className="h-11 w-full rounded-xl border border-line-strong bg-surface-2 pl-10 pr-3.5 font-body text-sm text-ink placeholder:text-muted"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
          {t("hh_none")}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((h) => (
            <li key={h.id}>
              <HouseCard house={h} onOpen={() => setOpenId(h.id)} />
            </li>
          ))}
        </ul>
      )}

      <HouseDrawer house={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

// ───────────────────────── card ─────────────────────────

function HouseCard({ house, onOpen }: { house: AdminHousehold; onOpen: () => void }) {
  const { t, lang } = useAdminLang();
  const stranded = house.members.length === 0 && house.balance > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex h-full w-full flex-col gap-3.5 rounded-2xl border bg-surface-2 p-[18px] text-left shadow-soft transition-colors hover:bg-surface ${
        stranded ? "border-rose/60" : "border-line"
      }`}
    >
      {/* house number + balance */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
            {t("house_label")}
          </p>
          <p className="truncate font-head text-xl font-semibold text-ink">{house.houseNumber}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-head text-xl font-bold" style={{ color: house.expiringSoon ? "#a56a52" : "var(--color-ink)" }}>
            {house.balance}
            <span className="ml-1 font-body text-[12px] font-medium text-muted">{t("hrs")}</span>
          </p>
          <p className="font-body text-[11.5px]" style={{ color: house.expiringSoon ? "#a56a52" : "var(--color-muted)" }}>
            {house.expiry
              ? house.expiringSoon
                ? t("expiring_soon")
                : t("expires_till").replace("{date}", fmtDate(house.expiry, lang))
              : t("hh_no_classes")}
          </p>
        </div>
      </div>

      {/* classes by type */}
      {house.byCategory.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {house.byCategory.map((c) => (
            <span
              key={c.category}
              className="inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 font-body text-[12px] font-semibold text-ink-soft"
            >
              <Dot type={c.category} size={7} />
              {t(CAT_KEY[c.category])} · {c.hours}
            </span>
          ))}
        </div>
      )}

      {/* members */}
      <div className="mt-auto border-t border-line pt-3">
        {house.members.length === 0 ? (
          <Badge tone={stranded ? "rose" : "neutral"}>{t("hh_no_members_badge")}</Badge>
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex -space-x-2">
              {house.members.slice(0, 4).map((m) => (
                <span key={m.id} className="rounded-full ring-2 ring-surface-2">
                  <Avatar name={m.name} seed={m.id} size={28} />
                </span>
              ))}
            </span>
            <span className="min-w-0 truncate font-body text-[13px] text-ink-soft">
              {house.members.map((m) => m.name).join(", ")}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

// ───────────────────────── drawer ─────────────────────────

function HouseDrawer({ house, onClose }: { house: AdminHousehold | null; onClose: () => void }) {
  const { t } = useAdminLang();
  const stranded = house !== null && house.members.length === 0 && house.balance > 0;

  return (
    <Drawer
      open={house !== null}
      onClose={onClose}
      title={house ? `${t("house_label")} ${house.houseNumber}` : ""}
    >
      {house && (
        <div className="flex flex-col gap-6">
          {/* total */}
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <p className="font-body text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              {t("hh_classes_left")}
            </p>
            <p className="mt-1 font-head text-3xl font-bold text-ink">
              {house.balance}
              <span className="ml-1.5 font-body text-sm font-medium text-muted">{t("hrs")}</span>
            </p>
            {house.byCategory.length > 0 && (
              <p className="mt-1.5 font-body text-[13px] text-ink-soft">
                {house.byCategory.map((c) => `${t(CAT_KEY[c.category])} ${c.hours}`).join(" · ")}
              </p>
            )}
          </div>

          {/* members */}
          <section>
            <h3 className="mb-2.5 font-body text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              {t("hh_members")}
            </h3>
            {house.members.length === 0 ? (
              <p
                className={`rounded-xl px-4 py-3 font-body text-[13px] leading-relaxed ${
                  stranded ? "bg-rose/15 text-[#8a5340]" : "bg-cream text-ink-soft"
                }`}
              >
                {t("hh_no_members")}
              </p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-line bg-surface-2">
                {house.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                    <Avatar name={m.name} seed={m.id} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-body text-sm font-semibold text-ink">
                        {m.name}
                        {m.tier === "member" && <Sparkle size={11} />}
                      </p>
                      <p className="font-body text-xs text-muted">{m.phone}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* The empty-house note already says where to fix it. */}
            {house.members.length > 0 && (
              <p className="mt-2 font-body text-[12px] leading-snug text-muted">{t("hh_edit_hint")}</p>
            )}
          </section>

          {/* packages */}
          <section>
            <h3 className="mb-2.5 font-body text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              {t("hh_packages")}
            </h3>
            {house.packages.length === 0 ? (
              <p className="rounded-xl bg-cream px-4 py-3 font-body text-[13px] text-ink-soft">{t("hh_no_classes")}</p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-line bg-surface-2">
                {house.packages.map((p) => (
                  <PackageRow key={p.id} pkg={p} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function PackageRow({ pkg }: { pkg: HouseholdPackage }) {
  const { t, tt, lang } = useAdminLang();
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Dot type={pkg.category} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-sm font-semibold text-ink">
          {tt(pkg.label)}
          {pkg.partySize !== null && (
            <span className="ml-1.5 font-normal text-muted">· {t("hh_people").replace("{n}", String(pkg.partySize))}</span>
          )}
        </p>
        <p className="font-body text-xs text-muted">
          {pkg.expiresAt
            ? t("expires_till").replace("{date}", fmtDate(pkg.expiresAt, lang))
            : t("hh_not_started")}
        </p>
      </div>
      <p className="shrink-0 font-body text-[13px] text-ink-soft">
        {t("hh_of_total").replace("{left}", String(pkg.hoursLeft)).replace("{total}", String(pkg.hoursTotal))}
      </p>
    </li>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
