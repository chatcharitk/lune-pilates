"use client";

// Detail drawer for one sale (a `charges` row) — shared by the Sales-history
// screen AND the Payments screen, so tapping a transaction anywhere shows the
// same record: customer, package, amount, method, status, Bangkok date/time,
// the uploaded payment slip (fetched owner-gated on open via getSlip), and an
// Owner correction for WHEN the sale was recorded (updateSaleTime). Money
// fields (amount/package/method/status) are read-only by design — corrections
// to those are a cancel/re-sell, never an in-place rewrite.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Drawer, type BadgeTone } from "./ui";
import { getSlip } from "@/app/actions/admin-payments";
import { updateSaleTime } from "@/app/actions/admin-sales";
import type { SalesRow, PaymentMethod, PaymentStatus } from "@/lib/admin/sales";
import { thb, type StrKey } from "@/lib/i18n";
import { formatStudioDate, formatStudioTime, studioInstant, studioParts } from "@/lib/time";

/** Status → badge tone + label key — identical to the Payments/Sales tables. */
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

/** Localised day + time (e.g. "12 Jun, 09:12"), Bangkok wall-clock. */
function fmtWhen(iso: string, lang: "en" | "th"): string {
  const d = new Date(iso);
  const date = formatStudioDate(d, lang, { day: "numeric", month: "short" });
  const time = formatStudioTime(d);
  return `${date}, ${time}`;
}

export function SaleDetailDrawer({ sale, onClose }: { sale: SalesRow | null; onClose: () => void }) {
  const { t, tt, lang } = useAdminLang();
  const router = useRouter();
  const [slip, setSlip] = useState<{ state: "loading" | "error" } | { state: "ok"; dataUrl: string } | null>(null);
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  const [toast, setToast] = useState<StrKey | null>(null);
  const [pending, startTransition] = useTransition();

  // On open (keyed by the sale ID, not the row object — router.refresh() swaps the
  // row objects, and re-running then would wipe the success toast and refetch the
  // slip): prefill the Bangkok wall-clock date/time inputs and fetch the slip.
  const saleId = sale?.id ?? null;
  useEffect(() => {
    if (!sale) {
      setSlip(null);
      setToast(null);
      return;
    }
    const p = studioParts(new Date(sale.when));
    setDateValue(`${p.year}-${String(p.month0 + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`);
    setTimeValue(`${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`);
    setToast(null);
    if (sale.hasSlip) {
      setSlip({ state: "loading" });
      let alive = true;
      getSlip({ chargeId: sale.id })
        .then((res) => {
          if (!alive) return;
          setSlip(res.ok ? { state: "ok", dataUrl: res.slip.dataUrl } : { state: "error" });
        })
        .catch(() => {
          if (alive) setSlip({ state: "error" });
        });
      return () => {
        alive = false;
      };
    }
    setSlip(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id by design
  }, [saleId]);

  function saveTime() {
    if (!sale || !dateValue || !timeValue) return;
    const [y, m, d] = dateValue.split("-").map(Number);
    const [hh, mm] = timeValue.split(":").map(Number);
    const soldAt = studioInstant(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0).toISOString();
    setToast(null);
    startTransition(async () => {
      const res = await updateSaleTime({ chargeId: sale.id, soldAt });
      if (res.ok) {
        setToast("sale_time_saved");
        router.refresh(); // re-fetch the window (the row may move / re-sort)
      } else {
        setToast("err_generic");
      }
    });
  }

  const badge = sale ? STATUS_BADGE[sale.status] : null;

  return (
    <Drawer open={sale !== null} onClose={onClose} title={t("sale_detail")}>
      {sale && (
        <div>
          {toast && (
            <div
              role="status"
              className={`mb-4 rounded-xl px-3.5 py-2.5 font-body text-[13px] font-semibold ${
                toast === "sale_time_saved" ? "bg-sage/15 text-sage-deep" : "bg-rose/15 text-[#a56a52]"
              }`}
            >
              {t(toast)}
            </div>
          )}

          {/* record */}
          <div className="mb-4 flex items-center gap-3 rounded-2xl bg-cream-2 px-3.5 py-3">
            <Avatar name={sale.customerName} seed={sale.customerId} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-body text-sm font-semibold text-ink">{sale.customerName}</p>
              <p className="truncate font-body text-xs text-muted">{tt(sale.packageLabel)}</p>
            </div>
            <span className="shrink-0 font-head text-lg font-bold text-ink tabular-nums">{thb(sale.amount)}</span>
          </div>

          <dl className="mb-5 flex flex-col gap-2.5">
            <DetailRow label={t("pos_method")}>
              <span className="flex items-center gap-1.5">
                {sale.method === "promptpay" ? <PromptPayMark /> : <CashMark />}
                {t(METHOD_LABEL[sale.method])}
              </span>
            </DetailRow>
            <DetailRow label={t("status")}>
              {badge && <Badge tone={badge.tone}>{t(badge.key)}</Badge>}
            </DetailRow>
            <DetailRow label={t("sale_datetime")}>
              <span className="tabular-nums">{fmtWhen(sale.when, lang)}</span>
            </DetailRow>
          </dl>

          {/* edit the recorded sale time (Owner correction) */}
          <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            {t("edit_sale_time")}
          </p>
          <div className="mb-5 flex flex-wrap items-end gap-2">
            <input
              type="date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
              aria-label={t("sales_range_from")}
              className="h-11 rounded-xl border border-line-strong bg-surface px-3 font-body text-sm text-ink"
            />
            <input
              type="time"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              aria-label={t("start_time")}
              className="h-11 rounded-xl border border-line-strong bg-surface px-3 font-body text-sm text-ink"
            />
            <button
              type="button"
              onClick={saveTime}
              disabled={pending || !dateValue || !timeValue}
              className="inline-flex h-11 items-center rounded-xl bg-ink px-4 font-body text-sm font-semibold text-cream disabled:opacity-50"
            >
              {t("save")}
            </button>
          </div>

          {/* payment slip */}
          <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            {t("payment_slip")}
          </p>
          {!sale.hasSlip ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-6 text-center font-body text-[13px] text-muted">
              {t("no_slip")}
            </p>
          ) : slip?.state === "loading" ? (
            <p className="rounded-2xl border border-line bg-surface-2 p-6 text-center font-body text-[13px] text-muted">
              {t("loading")}
            </p>
          ) : slip?.state === "ok" ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, not an optimizable asset
            <img
              src={slip.dataUrl}
              alt={t("payment_slip")}
              className="w-full rounded-2xl border border-line bg-white"
            />
          ) : (
            <p className="rounded-2xl border border-line bg-surface-2 p-6 text-center font-body text-[13px] text-muted">
              {t("err_generic")}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="font-body text-[13px] text-muted">{label}</dt>
      <dd className="font-body text-[13.5px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

function PromptPayMark({ size = 16 }: { size?: number }) {
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

function CashMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v.01M18 14v.01" />
    </svg>
  );
}
