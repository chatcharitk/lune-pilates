"use client";

// Admin "Sales history" view (Group D #1). A date-range picker + a read-only table
// of every charge in the window (all statuses), reusing the Payments table's column
// + badge conventions, plus a "Download CSV" anchor that streams the export for the
// SAME range.
//
// The range lives in the URL (from/to, yyyy-mm-dd): changing a date pushes a new URL
// so the server component (app/admin/sales/page.tsx) re-fetches — money/identities
// are always read server-side (CLAUDE.md §8). The CSV anchor is a plain <a> to
// /api/admin/sales/export so the browser streams the file (the route is owner-gated
// + no-store). All copy is keyed via the admin language context.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, type BadgeTone } from "./ui";
import type { SalesRow, PaymentMethod, PaymentStatus } from "@/lib/admin/sales";
import { presetRange, type SalesRangePreset } from "@/lib/admin/period";
import { thb, type StrKey } from "@/lib/i18n";
import { formatStudioDate, formatStudioTime } from "@/lib/time";

// ───────────────────────── shared conventions (mirror payments-view.tsx) ─────────────────────────

/** Status → badge tone + label key — identical to the Payments table's STATUS_BADGE. */
const STATUS_BADGE: Record<PaymentStatus, { tone: BadgeTone; key: StrKey }> = {
  paid: { tone: "green", key: "paid" },
  pending: { tone: "amber", key: "pending" },
  awaiting_review: { tone: "amber", key: "status_in_review" },
  rejected: { tone: "rose", key: "status_rejected" },
};

const METHOD_LABEL: Record<PaymentMethod, StrKey> = {
  promptpay: "pos_method_promptpay",
  cash: "pos_method_cash",
};

/** The quick-pick presets, in display order, with their keyed labels. */
const RANGE_PRESETS: { preset: SalesRangePreset; key: StrKey }[] = [
  { preset: "today", key: "range_today" },
  { preset: "week", key: "range_week" },
  { preset: "month", key: "range_month" },
  { preset: "year", key: "range_year" },
];

// ───────────────────────── default range (mirrors rangeBounds) ─────────────────────────

/** Local yyyy-mm-dd of a Date, for the <input type=date> value + the export query. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** First-of-this-month — the rangeBounds default `from` when none is supplied. */
function defaultFrom(now = new Date()): string {
  return ymd(new Date(now.getFullYear(), now.getMonth(), 1));
}

/** Today — the rangeBounds default INCLUSIVE `to` when none is supplied. */
function defaultTo(now = new Date()): string {
  return ymd(now);
}

// ───────────────────────── component ─────────────────────────

export function SalesView({
  rows,
  from,
  to,
}: {
  rows: SalesRow[];
  /** The active `from`/`to` from the URL, or null (server used the defaults). */
  from: string | null;
  to: string | null;
}) {
  const { t, tt, lang } = useAdminLang();
  const router = useRouter();

  // The dates shown in the inputs: the URL value, else the rangeBounds default —
  // so the picker always reflects the window the table is actually showing.
  const fromValue = from ?? defaultFrom();
  const toValue = to ?? defaultTo();

  // Push a new range to the URL so the server re-fetches. Both dates are always
  // sent so the export anchor + the table stay on the same explicit window.
  function setRange(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams();
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    router.push(`/admin/sales?${params.toString()}`);
  }

  // Jump to a quick-pick preset: compute its from/to days and push them (the server
  // re-fetches, same mechanism as the date inputs).
  function applyPreset(preset: SalesRangePreset) {
    const { fromDay, toDay } = presetRange(preset);
    setRange(fromDay, toDay);
  }

  // Highlight the preset whose computed from/to matches the active window (if any).
  const activePreset = useMemo<SalesRangePreset | null>(() => {
    for (const { preset } of RANGE_PRESETS) {
      const { fromDay, toDay } = presetRange(preset);
      if (fromDay === fromValue && toDay === toValue) return preset;
    }
    return null;
  }, [fromValue, toValue]);

  // The CSV export streams the SAME explicit window (owner-gated, no-store route).
  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ from: fromValue, to: toValue });
    return `/api/admin/sales/export?${params.toString()}`;
  }, [fromValue, toValue]);

  // Member · Package · Method[hide-sm] · Amount(right) · Status(right) — mirrors the
  // Payments table grid; Method collapses on small screens.
  const grid =
    "grid grid-cols-[1.6fr_1fr_auto_auto] sm:grid-cols-[1.8fr_1.4fr_1fr_1fr_auto] items-center gap-3";

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
            {t("admin_sales")}
          </h1>
          <p className="mt-1 font-body text-[13.5px] text-muted">{t("sales_history")}</p>
        </div>

        {/* CSV export — a plain <a> so the browser streams the file (no fetch). */}
        <a
          href={exportHref}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 font-body text-[13.5px] font-semibold text-cream"
        >
          <DownloadIcon />
          {t("sales_download_csv")}
        </a>
      </div>

      {/* quick-pick range presets */}
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t("sales_history")}>
        {RANGE_PRESETS.map(({ preset, key }) => {
          const on = activePreset === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              aria-pressed={on}
              className={`h-9 rounded-full border px-4 font-body text-[13px] font-semibold transition-colors ${
                on
                  ? "border-taupe bg-ink text-cream"
                  : "border-line-strong bg-surface-2 text-ink-soft hover:bg-cream-2"
              }`}
            >
              {t(key)}
            </button>
          );
        })}
      </div>

      {/* date-range picker */}
      <div className="mb-[18px] flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1.5 block font-body text-xs font-semibold tracking-wide text-ink-soft">
            {t("sales_range_from")}
          </span>
          <input
            type="date"
            value={fromValue}
            max={toValue}
            onChange={(e) => setRange(e.target.value, toValue)}
            aria-label={t("sales_range_from")}
            className="h-11 rounded-xl border border-line-strong bg-surface-2 px-3.5 font-body text-sm text-ink"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-body text-xs font-semibold tracking-wide text-ink-soft">
            {t("sales_range_to")}
          </span>
          <input
            type="date"
            value={toValue}
            min={fromValue}
            onChange={(e) => setRange(fromValue, e.target.value)}
            aria-label={t("sales_range_to")}
            className="h-11 rounded-xl border border-line-strong bg-surface-2 px-3.5 font-body text-sm text-ink"
          />
        </label>
      </div>

      {/* table */}
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
          {t("sales_empty")}
        </p>
      ) : (
        <div
          role="table"
          aria-label={t("sales_history")}
          className="overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-soft"
        >
          {/* header */}
          <div
            role="row"
            className={`${grid} border-b border-line bg-surface px-[18px] py-3 font-body text-[11px] font-semibold uppercase tracking-[0.06em] text-muted`}
          >
            <span role="columnheader">{t("sales_col_customer")}</span>
            <span role="columnheader">{t("sales_col_package")}</span>
            <span role="columnheader" className="hidden sm:block">
              {t("sales_col_method")}
            </span>
            <span role="columnheader" className="text-right">
              {t("sales_col_amount")}
            </span>
            <span role="columnheader" className="text-right">
              {t("sales_col_status")}
            </span>
          </div>

          {/* rows */}
          <div role="rowgroup">
            {rows.map((r) => {
              const badge = STATUS_BADGE[r.status];
              return (
                <div
                  key={r.id}
                  role="row"
                  className={`${grid} border-b border-line px-[18px] py-3 last:border-b-0`}
                >
                  {/* customer + when (the Date column) */}
                  <span role="cell" className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={r.customerName} seed={r.customerId} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate font-body text-[13.5px] font-semibold text-ink">
                        {r.customerName}
                      </span>
                      <span className="font-body text-[11.5px] text-muted">
                        {fmtWhen(r.when, lang)}
                      </span>
                    </span>
                  </span>

                  {/* package */}
                  <span
                    role="cell"
                    className="min-w-0 truncate font-body text-[13.5px] font-semibold text-ink"
                  >
                    {tt(r.packageLabel)}
                  </span>

                  {/* method */}
                  <span
                    role="cell"
                    className="hidden items-center gap-1.5 font-body text-[12.5px] text-ink-soft sm:flex"
                  >
                    {r.method === "promptpay" ? <PromptPayMark /> : <CashMark />}
                    {t(METHOD_LABEL[r.method])}
                  </span>

                  {/* amount */}
                  <span
                    role="cell"
                    className="text-right font-head text-[14.5px] font-bold text-ink tabular-nums"
                  >
                    {thb(r.amount)}
                  </span>

                  {/* status */}
                  <span role="cell" className="text-right">
                    <Badge tone={badge.tone}>{t(badge.key)}</Badge>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── helpers ─────────────────────────

/** Localised day + time for the sales Date column (e.g. "12 Jun, 09:12"). */
function fmtWhen(iso: string, lang: "en" | "th"): string {
  const d = new Date(iso);
  const date = formatStudioDate(d, lang, { day: "numeric", month: "short" });
  const time = formatStudioTime(d);
  return `${date}, ${time}`;
}

// ───────────────────────── icons (mirror payments-view.tsx) ─────────────────────────

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}
function PromptPayMark({ size = 18 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[5px] font-head font-extrabold text-white"
      style={{ width: size, height: size, background: "#1a3a6b", fontSize: size * 0.5 }}
      aria-hidden
    >
      P
    </span>
  );
}
function CashMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v.01M18 14v.01" />
    </svg>
  );
}
