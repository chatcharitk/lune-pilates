"use client";

// Admin "Business Overview" (Feature 4) client view. Consumes the server
// DashboardOverview read model (lib/admin/analytics.ts) and renders the three
// prototype sections pixel-faithfully (desktop: LUNE Admin Analytics.html ·
// mobile single-column: admin-mobile-analytics.jsx):
//   01 Sales & revenue   02 Capacity & operations   03 Retention & CRM
//
// READ-ONLY (CLAUDE.md §5): nothing here mutates studio state. Capacity-alert
// actions are LINKS that deep-link to /admin/schedule (inv 5 — never mutate the
// schedule from the dashboard). The renewal pills are an OPTIMISTIC local "Sent"
// affordance only (the real send fires through LINE OA in production, per the
// footnote) — they make no server write here.
//
// All money/aggregation is server-side already (the view only formats). All copy
// is keyed; the read model's Bilingual fields go through tt().

import Link from "next/link";
import { useState } from "react";
import { useAdminLang } from "./admin-context";
import { Avatar } from "./ui";
import { Donut, Gauge, ProgressTrack, Sparkline, thbCompact } from "./charts";
import { thb, type Bilingual, type StrKey } from "@/lib/i18n";
import type { DashboardOverview, CapacitySection, RetentionSection } from "@/lib/admin/analytics";

// Per-instructor / per-house track colours: deterministic from a stable id so the
// avatar tint and its progress track always match (mirrors the prototype's fixed
// instructor colours without the read model having to ship a colour).
const TRACK_COLORS = ["#8c7a63", "#8e9a82", "#c0a079", "#6e84a3", "#c49a86", "#8c9a7e"];
function trackColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TRACK_COLORS[h % TRACK_COLORS.length]!;
}

const AMBER = "#b98c3e";
const ROSE = "#b5765c";
const BLUE = "#6e84a3";

// Mix category → display key + dot colour (matches the prototype donut palette).
const MIX_META: Record<string, { key: StrKey; color: string }> = {
  group: { key: "mix_group", color: "var(--color-taupe)" },
  private: { key: "mix_private", color: "var(--color-sage)" },
  rental: { key: "mix_rental", color: BLUE },
};

// Fill-rate type → display key + track colour (prototype palette).
const FILL_META: Record<string, { key: StrKey; color: string }> = {
  group: { key: "fill_group", color: "var(--color-taupe)" },
  private: { key: "fill_private", color: "var(--color-sage)" },
  duo: { key: "fill_duo", color: "#c0a079" },
  trio: { key: "fill_trio", color: BLUE },
};

export function DashboardView({ overview }: { overview: DashboardOverview }) {
  const { t, lang } = useAdminLang();
  const [period, setPeriod] = useState<"mtd" | "today">("mtd");
  const { sales, capacity, retention, period: meta } = overview;

  // "As of" date in the active language (full weekday + date).
  const asOfDate = new Date(meta.asOf);
  const asOfLabel = asOfDate.toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-[1360px]">
      {/* ── header ── */}
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-head text-[25px] font-semibold leading-tight tracking-[-0.4px] text-ink">
            {t("biz_overview")}
          </h1>
          <p className="mt-0.5 font-body text-[13.5px] text-muted">
            {t("as_of")} {asOfLabel}
          </p>
        </div>
        <PeriodToggle period={period} setPeriod={setPeriod} />
      </header>

      {/* ════ 01 · SALES & REVENUE ════ */}
      <SectionLabel n="01" title={t("sales_revenue")} sub={t("sales_top_priority")} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr_1fr]">
        <SalesCard sales={sales} period={period} />
        <RevenueMixDonut sales={sales} />
        <TrialConversionGauge sales={sales} />
        <PackageLiabilityCard sales={sales} />
      </div>

      <PerInstructorPanel sales={sales} />

      {/* ════ 02 · CAPACITY & OPERATIONS ════ */}
      <SectionLabel n="02" title={t("capacity_ops")} spaced />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FillRatePanel capacity={capacity} />
        <AlertsPanel alerts={capacity.alerts} />
      </div>

      {/* ════ 03 · RETENTION & CRM ════ */}
      <SectionLabel n="03" title={t("retention_crm")} spaced />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
        <ExpiringPanel rows={retention.expiringSoon} />
        <HouseUsagePanel houses={retention.houseUsage} />
      </div>

      <Footnote />
    </div>
  );
}

// ───────────────────────── shared chrome ─────────────────────────

function PeriodToggle({
  period,
  setPeriod,
}: {
  period: "mtd" | "today";
  setPeriod: (p: "mtd" | "today") => void;
}) {
  const { t } = useAdminLang();
  const opts: { v: "mtd" | "today"; key: StrKey }[] = [
    { v: "mtd", key: "period_mtd" },
    { v: "today", key: "period_today" },
  ];
  return (
    <div
      role="group"
      aria-label={t("biz_overview")}
      className="flex rounded-[11px] bg-cream-2 p-[3px]"
    >
      {opts.map((o) => {
        const on = period === o.v;
        return (
          <button
            key={o.v}
            type="button"
            aria-pressed={on}
            onClick={() => setPeriod(o.v)}
            className={`rounded-lg px-4 py-2 font-body text-[13px] font-semibold transition-colors ${
              on ? "bg-surface-2 text-ink shadow-soft" : "text-ink-soft hover:text-ink"
            }`}
          >
            {t(o.key)}
          </button>
        );
      })}
    </div>
  );
}

function SectionLabel({
  n,
  title,
  sub,
  spaced,
}: {
  n: string;
  title: string;
  sub?: string;
  spaced?: boolean;
}) {
  return (
    <div className={`mx-0.5 mb-4 flex items-baseline gap-2.5 ${spaced ? "mt-10" : "mt-1.5"}`}>
      <span className="font-brand text-[21px] italic text-taupe">{n}</span>
      <h2 className="font-head text-[19px] font-semibold tracking-[-0.2px] text-ink">{title}</h2>
      {sub && <span className="font-body text-[13px] font-medium text-muted">{sub}</span>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[18px] border border-line bg-surface-2 shadow-soft ${className}`}>
      {children}
    </div>
  );
}

function Eyebrow({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p
      className={`font-body text-[10.5px] font-bold uppercase tracking-[0.8px] ${
        dark ? "text-cream/50" : "text-muted"
      }`}
    >
      {children}
    </p>
  );
}

function DeltaPill({ pct, suffixKey, dark }: { pct: number; suffixKey: StrKey; dark?: boolean }) {
  const { t } = useAdminLang();
  const up = pct >= 0;
  const sign = up ? "+" : "";
  const label = `${sign}${pct}% ${t(suffixKey)}`;
  if (dark) {
    return (
      <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-sage/[0.22] px-2.5 py-[3px] font-body text-[12px] font-bold text-[#b9c7a8]">
        <Chevron up={up} />
        {label}
      </span>
    );
  }
  return (
    <span
      className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] font-body text-[12.5px] font-bold ${
        up ? "bg-sage/[0.16] text-sage-deep" : "bg-rose/[0.14] text-[#b5765c]"
      }`}
    >
      <Chevron up={up} />
      {label}
    </span>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: up ? undefined : "rotate(180deg)" }}
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

// ───────────────────────── 01 · sales ─────────────────────────

function SalesCard({ sales, period }: { sales: DashboardOverview["sales"]; period: "mtd" | "today" }) {
  const { t } = useAdminLang();
  const primary =
    period === "mtd"
      ? { eyebrow: t("sales_revenue_mtd"), value: sales.revenueMtd, delta: sales.deltaMtdPct, deltaKey: "vs_last_month" as StrKey }
      : { eyebrow: t("period_today"), value: sales.revenueToday, delta: sales.deltaTodayPct, deltaKey: "vs_yesterday" as StrKey };
  const secondary =
    period === "mtd"
      ? { eyebrow: t("period_today"), value: sales.revenueToday, delta: sales.deltaTodayPct, deltaKey: "vs_yesterday" as StrKey }
      : { eyebrow: t("sales_revenue_mtd"), value: sales.revenueMtd, delta: sales.deltaMtdPct, deltaKey: "vs_last_month" as StrKey };

  const sparkValues = sales.dailyRevenue.map((d) => d.amount);
  const sparkAria = `${t("daily_revenue_14d")}: ${sparkValues.map((v) => thb(v)).join(", ")}`;

  return (
    <div className="flex flex-col rounded-[18px] bg-admin-ink p-4 md:p-6 text-cream lg:row-span-2">
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-8">
        <div className="flex-1">
          <Eyebrow dark>{primary.eyebrow}</Eyebrow>
          <p className="mt-1.5 font-head text-[34px] font-bold leading-[1.05] tracking-[-1px] text-cream">
            {thb(primary.value)}
          </p>
          <DeltaPill pct={primary.delta} suffixKey={primary.deltaKey} dark />
        </div>
        <div className="hidden w-px bg-cream/[0.14] sm:block" />
        <div className="flex-1">
          <Eyebrow dark>{secondary.eyebrow}</Eyebrow>
          <p className="mt-1.5 font-head text-[26px] font-bold leading-[1.05] tracking-[-0.5px] text-cream/[0.86]">
            {thb(secondary.value)}
          </p>
          <DeltaPill pct={secondary.delta} suffixKey={secondary.deltaKey} dark />
        </div>
      </div>
      <div className="mt-auto pt-5">
        <div className="mb-2.5">
          <Eyebrow dark>{t("daily_revenue_14d")}</Eyebrow>
        </div>
        <Sparkline data={sparkValues} ariaLabel={sparkAria} dark />
      </div>
    </div>
  );
}

function RevenueMixDonut({ sales }: { sales: DashboardOverview["sales"] }) {
  const { t } = useAdminLang();
  const segments = sales.revenueMix.map((m) => ({
    pct: m.pct,
    color: MIX_META[m.category]?.color ?? "var(--color-taupe)",
  }));
  const aria = `${t("revenue_mix")}: ${sales.revenueMix
    .map((m) => `${t(MIX_META[m.category]?.key ?? "mix_group")} ${m.pct}% ${thb(m.amount)}`)
    .join(", ")}`;
  return (
    <Card className="flex flex-col p-4 md:p-5">
      <Eyebrow>{t("revenue_mix")}</Eyebrow>
      <div className="mt-3.5 flex items-center gap-4">
        <Donut
          segments={segments}
          centerTop={thbCompact(sales.revenueTotalMix)}
          centerBottom={t("period_mtd").toUpperCase()}
          ariaLabel={aria}
        />
        <ul className="flex flex-1 flex-col gap-2.5">
          {sales.revenueMix.map((m) => {
            const mm = MIX_META[m.category] ?? MIX_META.group!;
            return (
              <li key={m.category}>
                <div className="flex items-center gap-2.5 font-body text-[13px]">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: mm.color }}
                  />
                  <span className="flex-1 font-medium text-ink-soft">{t(mm.key)}</span>
                  <span className="font-head text-[13.5px] font-bold text-ink">{m.pct}%</span>
                </div>
                <p className="ml-[19px] font-body text-[11.5px] text-muted">{thb(m.amount)}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

function TrialConversionGauge({ sales }: { sales: DashboardOverview["sales"] }) {
  const { t } = useAdminLang();
  const { converted, total, pct } = sales.trialConversion;
  const aria = `${t("trial_conversion")}: ${pct}% — ${converted} ${t("trial_of")} ${total}`;
  return (
    <Card className="flex flex-col p-4 md:p-5">
      <Eyebrow>{t("trial_conversion")}</Eyebrow>
      <p className="mt-0.5 font-body text-[12.5px] text-muted">{t("b1g1_note")}</p>
      <div className="mt-3.5 flex items-center gap-4">
        <Gauge pct={pct} ariaLabel={aria} />
        <div>
          <p className="font-head text-[30px] font-bold leading-none text-ink">{pct}%</p>
          <p className="mt-1.5 font-body text-[12.5px] text-muted">
            <b className="text-ink-soft">
              {converted} {t("trial_of")} {total}
            </b>
            <br />
            {t("trials_converted")}
          </p>
        </div>
      </div>
    </Card>
  );
}

function PackageLiabilityCard({ sales }: { sales: DashboardOverview["sales"] }) {
  const { t } = useAdminLang();
  const { thb: amount, hoursOutstanding, pctOfSold } = sales.packageLiability;
  return (
    <Card className="flex flex-col p-4 md:p-5">
      <Eyebrow>{t("package_liability")}</Eyebrow>
      <p className="mt-0.5 font-body text-[12.5px] text-muted">{t("liability_note")}</p>
      <p className="mt-3 font-head text-[27px] font-bold tracking-[-0.5px] text-taupe-deep">
        {thb(amount)}
      </p>
      <div className="mt-2.5 flex gap-[18px]">
        <div>
          <p className="font-head text-[17px] font-bold text-ink">
            {hoursOutstanding} {t("hrs_taught")}
          </p>
          <p className="font-body text-[12.5px] text-muted">{t("hours_outstanding")}</p>
        </div>
        <div>
          <p className="font-head text-[17px] font-bold text-ink">{pctOfSold}%</p>
          <p className="font-body text-[12.5px] text-muted">{t("pct_of_sold")}</p>
        </div>
      </div>
    </Card>
  );
}

function PerInstructorPanel({ sales }: { sales: DashboardOverview["sales"] }) {
  const { t, tt } = useAdminLang();
  const maxRev = Math.max(1, ...sales.perInstructor.map((r) => r.revenue));
  return (
    <Card className="mt-4 p-4 md:p-6">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="font-head text-[16.5px] font-semibold text-ink">{t("revenue_per_instructor")}</h3>
        <span className="font-body text-[12.5px] text-muted">{t("per_instructor_basis")}</span>
      </div>
      <p className="mb-[18px] font-body text-[12.5px] text-muted">{t("per_instructor_sub")}</p>
      <ul className="flex flex-col gap-4">
        {sales.perInstructor.map((r) => {
          const color = trackColor(r.instructorId);
          return (
            <li key={r.instructorId} className="flex items-center gap-[15px]">
              <Avatar name={tt(r.name)} seed={r.instructorId} initials={r.initials} size={42} />
              <div className="min-w-0 flex-1">
                <div className="mb-[7px] flex items-baseline justify-between gap-3">
                  <span className="truncate font-body text-[14.5px] font-semibold text-ink">
                    {tt(r.name)}
                    {r.tag && <span className="ml-2 font-body text-[12px] font-medium text-muted">{tt(r.tag)}</span>}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2.5">
                    <span className="font-head text-[16px] font-bold text-ink">{thb(r.revenue)}</span>
                    <span className="font-body text-[12px] text-muted">
                      {r.hours} {t("hrs_taught")}
                    </span>
                  </span>
                </div>
                <ProgressTrack value={(r.revenue / maxRev) * 100} color={color} height={9} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ───────────────────────── 02 · capacity ─────────────────────────

function FillRatePanel({ capacity }: { capacity: CapacitySection }) {
  const { t } = useAdminLang();
  return (
    <Card className="p-4 md:p-6">
      <h3 className="font-head text-[16.5px] font-semibold text-ink">{t("class_fill_rate")}</h3>
      <p className="mb-1 mt-0.5 font-body text-[12.5px] text-muted">{t("avg_group_30d")}</p>
      <div className="mb-1 flex items-baseline gap-2.5">
        <span className="font-head text-[40px] font-bold tracking-[-1px] text-ink">
          {capacity.fillRateOverall}%
        </span>
        <span className="inline-flex items-center gap-1 font-body text-[12.5px] font-bold text-sage-deep">
          <Chevron up={capacity.fillRateDeltaPts >= 0} />+{capacity.fillRateDeltaPts} {t("pts")}
        </span>
      </div>
      <ul className="mt-3.5 flex flex-col gap-3.5">
        {capacity.fillRateByType.map((row) => {
          const fm = FILL_META[row.type] ?? FILL_META.group!;
          return (
            <li key={row.type}>
              <div className="mb-1.5 flex items-center justify-between font-body text-[12.5px]">
                <span className="flex items-center gap-[7px] font-semibold text-ink-soft">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: fm.color }} />
                  {t(fm.key)}
                </span>
                <span className="font-head font-bold text-ink">{row.pct}%</span>
              </div>
              <ProgressTrack value={row.pct} color={fm.color} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AlertsPanel({ alerts }: { alerts: CapacitySection["alerts"] }) {
  const { t, tt } = useAdminLang();
  return (
    <Card className="p-4 md:p-6">
      <h3 className="font-head text-[16.5px] font-semibold text-ink">{t("actionable_alerts")}</h3>
      <p className="mb-[18px] mt-0.5 font-body text-[12.5px] text-muted">{t("next_24_48h")}</p>
      <ul className="flex flex-col gap-2.5">
        {alerts.map((a) => (
          <AlertRow key={a.classInstanceId} alert={a} t={t} tt={tt} />
        ))}
      </ul>
    </Card>
  );
}

function AlertRow({
  alert,
  t,
  tt,
}: {
  alert: CapacitySection["alerts"][number];
  t: (k: StrKey) => string;
  tt: (b: Bilingual | null | undefined) => string;
}) {
  const typeLabel = `${tt(alert.whenLabel)} · ${tt(CLASS_TYPE_LABEL[alert.type])}`;
  const warn = alert.tone === "warn";

  // Bilingual description per severity, from typed numbers (never hardcoded copy).
  let desc: React.ReactNode;
  if (alert.severity === "overbooked") {
    desc = (
      <>
        {alert.booked} {t("booked_lc")} ·{" "}
        <b style={{ color: AMBER }}>
          {alert.waitlistCount} {t("on_waitlist_n")}
        </b>{" "}
        — {t("demand_exceeds_supply")}
      </>
    );
  } else if (alert.severity === "empty") {
    desc = (
      <>
        {alert.booked} {t("booked_of")} {alert.capacity} — <b style={{ color: ROSE }}>{t("empty_class")}</b>
      </>
    );
  } else {
    desc = (
      <>
        {alert.booked} {t("booked_of")} {alert.capacity} — <b style={{ color: BLUE }}>{t("low_enrolment")}</b>
      </>
    );
  }

  return (
    <li className="flex items-center gap-3.5 rounded-[14px] border border-line p-3.5">
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        style={{
          background: warn ? "rgba(185,140,62,0.14)" : "rgba(110,132,163,0.14)",
          color: warn ? AMBER : BLUE,
        }}
      >
        {warn ? (
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 9v4M12 17h.01M10.3 4l-7 12A2 2 0 0 0 5 19h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0Z" />
          </svg>
        ) : (
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 17l6-6 4 4 7-8" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-body text-[14px] font-semibold text-ink">{typeLabel}</p>
        <p className="mt-0.5 font-body text-[12.5px] text-muted">{desc}</p>
      </div>
      <div className="flex shrink-0 gap-[7px]">
        {alert.severity === "overbooked" ? (
          <ScheduleLink solid>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("add_class")}
          </ScheduleLink>
        ) : (
          <>
            <ScheduleLink>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 4h16v12H7l-3 3V4Z" />
              </svg>
              {t("promote")}
            </ScheduleLink>
            <ScheduleLink rose>{t("alert_cancel")}</ScheduleLink>
          </>
        )}
      </div>
    </li>
  );
}

const CLASS_TYPE_LABEL: Record<string, Bilingual> = {
  group: { en: "Group", th: "กลุ่ม" },
  private: { en: "Private", th: "ส่วนตัว" },
  duo: { en: "Duo", th: "ดูโอ" },
  trio: { en: "Trio", th: "ทรีโอ" },
  rental: { en: "Rental", th: "เช่า" },
};

/** Capacity-alert action: a LINK to /admin/schedule (read-only dashboard — inv 5). */
function ScheduleLink({
  children,
  solid,
  rose,
}: {
  children: React.ReactNode;
  solid?: boolean;
  rose?: boolean;
}) {
  const base =
    "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 font-body text-[12.5px] font-semibold transition-colors";
  const tone = solid
    ? "border border-ink bg-ink text-white hover:bg-[#3a332a]"
    : rose
      ? "border border-[rgba(181,118,92,0.4)] bg-transparent text-[#b5765c] hover:bg-cream-2"
      : "border border-line-strong bg-transparent text-ink hover:bg-cream-2";
  return (
    <Link href="/admin/schedule" className={`${base} ${tone}`}>
      {children}
    </Link>
  );
}

// ───────────────────────── 03 · retention ─────────────────────────

function ExpiringPanel({ rows }: { rows: RetentionSection["expiringSoon"] }) {
  const { t, tt } = useAdminLang();
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const unsentCount = rows.filter((r) => !sentIds.has(r.packageId)).length;

  const markSent = (ids: string[]) =>
    setSentIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });

  return (
    <Card className="p-4 md:p-6">
      <h3 className="font-head text-[16.5px] font-semibold text-ink">{t("expiring_7d")}</h3>
      <p className="mb-1 mt-0.5 font-body text-[12.5px] text-muted">{t("tap_to_nudge")}</p>
      <ul>
        {rows.map((r) => {
          const sent = sentIds.has(r.packageId);
          return (
            <li
              key={r.packageId}
              className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
            >
              <Avatar name={r.ownerLabel} seed={r.userId || r.packageId} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-[14px] font-semibold text-ink">{r.ownerLabel}</p>
                <p className="mt-px font-body text-[12px] text-muted">{tt(r.ownerSubtitle)}</p>
              </div>
              <div className="mr-1 shrink-0 text-right">
                <p className="font-head text-[15px] font-bold text-ink">
                  {r.hoursLeft} {t("h_left")}
                </p>
                <p className="font-body text-[11px] font-semibold text-[#b5765c]">
                  {t("exp_short")} {r.expiresDisplay}
                </p>
              </div>
              <LinePill sent={sent} onClick={() => markSent([r.packageId])} />
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => markSent(rows.map((r) => r.packageId))}
        disabled={unsentCount === 0}
        className="mt-3.5 flex h-[42px] w-full items-center justify-center gap-2 rounded-[10px] border border-line-strong font-body text-[12.5px] font-semibold text-ink transition-colors hover:bg-cream-2 disabled:opacity-50"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 4h16v12H7l-3 3V4Z" />
        </svg>
        {t("remind_all")} {rows.length} {t("at_once")}
      </button>
    </Card>
  );
}

function LinePill({ sent, onClick }: { sent: boolean; onClick: () => void }) {
  const { t } = useAdminLang();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sent}
      className={`inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 font-body text-[12.5px] font-semibold ${
        sent ? "cursor-default bg-[rgba(6,199,85,0.12)] text-[#0a8f43]" : "bg-[#06C755] text-white"
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded text-[9px] font-extrabold ${
          sent ? "bg-[#06C755] text-white" : "bg-white text-[#06C755]"
        }`}
        aria-hidden
      >
        L
      </span>
      {sent ? t("reminder_sent") : t("send_reminder")}
    </button>
  );
}

function HouseUsagePanel({ houses }: { houses: RetentionSection["houseUsage"] }) {
  const { t, tt } = useAdminLang();
  return (
    <Card className="p-4 md:p-6">
      <h3 className="font-head text-[16.5px] font-semibold text-ink">{t("house_usage")}</h3>
      <p className="mb-[18px] mt-0.5 font-body text-[12.5px] text-muted">{t("shared_burn_rate")}</p>
      <ul className="flex flex-col gap-2.5">
        {houses.map((h) => {
          const warn = h.tone === "warn";
          const barColor = warn ? (h.pct >= 80 ? AMBER : ROSE) : "var(--color-sage)";
          return (
            <li key={h.householdId} className="rounded-[14px] border border-line p-3.5">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 font-head text-[14.5px] font-semibold text-ink">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-taupe)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 11l9-8 9 8M5 10v10h14V10" />
                  </svg>
                  {t("house_word")} {h.houseNumber}
                </span>
                <div className="flex">
                  {h.memberIds.slice(0, 4).map((id, i) => (
                    <span
                      key={id}
                      className="rounded-full border-2 border-surface-2"
                      style={{ marginLeft: i ? -7 : 0 }}
                    >
                      <Avatar name={id} seed={id} size={24} />
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <ProgressTrack value={h.pct} color={barColor} height={8} />
                </div>
                <span className="whitespace-nowrap font-head text-[13px] font-bold text-ink">
                  {h.usedHours} / {h.totalHours} {t("hrs_taught")}
                </span>
              </div>
              <p
                className="mt-2 font-body text-[11.5px]"
                style={{ color: warn ? AMBER : "var(--color-muted)", fontWeight: warn ? 600 : 400 }}
              >
                {tt(h.burnNote)}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Footnote() {
  const { t } = useAdminLang();
  return (
    <div className="mt-[22px] flex items-start gap-2.5 px-0.5 font-body text-[12.5px] leading-relaxed text-muted">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mt-0.5 shrink-0" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none" />
      </svg>
      <span>{t("illustrative_footnote")}</span>
    </div>
  );
}
