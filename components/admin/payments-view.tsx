"use client";

// Admin "Payments & POS" (spec §4: "POS checkout: Sell packages & retail, take
// PromptPay or cash, issue a receipt."; prototypes admin-more.jsx `PaymentsScreen`
// + admin-mobile-pos.jsx `MPos`/`MPayFlow`).
//
// Two parts:
//   1. The payments list — four period stat tiles + a responsive table (newest
//      first), every charge the studio has opened (paid green / pending amber).
//   2. "New sale" → a stepped POS flow in a Drawer: pick a package → assign a
//      customer (REQUIRED) → choose method → complete. Cash credits immediately;
//      PromptPay shows a QR then confirms. The receipt reads "+N hrs → {customer}".
//
// SCOPE (v1): ONE package per sale — the backend sells a single package per call
// (admin-pos.ts). A multi-item cart + retail are intentionally out of scope (see
// the TODO below); the prototype's cart/retail is collapsed to a single pick.
//
// All money/owner decisions are the server's (CLAUDE.md §8): this view sends only a
// customerId + a catalog packageId + the tender method, and renders whatever the
// action returns. It imports ONLY the POS action fns + erased types + the catalog +
// the AdminCustomer type + thb — never lib/db/*.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Drawer, Sparkle, Stat, type BadgeTone } from "./ui";
import { PromptPayQr, QrDownloadButton } from "@/components/customer/promptpay-qr";
import {
  posSellPackage,
  posConfirmPayment,
  type PosSellPackageResult,
  type PosSellFailureCode,
  type PosConfirmFailureCode,
} from "@/app/actions/admin-pos";
import {
  approveSlip,
  rejectSlip,
  getSlip,
  type SlipImage,
} from "@/app/actions/admin-payments";
import {
  listPackageCatalog,
  type CatalogItem,
  type CatalogCategory,
} from "@/lib/catalog/packages";
import type { AdminCustomer } from "@/lib/admin/members";
import type {
  PaymentRow,
  PaymentsOverview,
  PaymentMethod,
  PaymentStatus,
} from "@/lib/admin/payments";
import type { SalesRow } from "@/lib/admin/sales";
import { SaleDetailDrawer } from "./sale-detail-drawer";
import { thb, type StrKey } from "@/lib/i18n";

// ───────────────────────── helpers ─────────────────────────

/** Whole-credit display: integer credits rendered as-is (e.g. 2 → "2"). */
function fmtHours(n: number): string {
  return String(n);
}

/** Map a POS failure code to keyed copy. */
function posErrorKey(code: PosSellFailureCode | PosConfirmFailureCode): StrKey {
  switch (code) {
    case "UNKNOWN_CUSTOMER":
      return "err_unknown_customer";
    case "UNKNOWN_PACKAGE":
      return "err_unknown_package";
    case "NOT_PAID":
      return "err_not_paid";
    default:
      return "err_pos_sale";
  }
}

// ───────────────────────── component ─────────────────────────

/** Status → badge tone + label key for the payments table. */
const STATUS_BADGE: Record<PaymentStatus, { tone: BadgeTone; key: StrKey }> = {
  paid: { tone: "green", key: "paid" },
  pending: { tone: "amber", key: "pending" },
  awaiting_review: { tone: "amber", key: "status_in_review" },
  rejected: { tone: "rose", key: "status_rejected" },
  cancelled: { tone: "neutral", key: "status_cancelled" },
};

export function PaymentsView({
  overview,
  customers,
}: {
  overview: PaymentsOverview;
  customers: AdminCustomer[];
}) {
  const { t } = useAdminLang();
  const [posOpen, setPosOpen] = useState(false);
  // The charge whose slip is being reviewed (drawer open when non-null).
  const [reviewRow, setReviewRow] = useState<PaymentRow | null>(null);
  // The charge opened in the shared sale-detail drawer (row tap — the same drawer
  // as the Sales-history screen, so details/slip/time-edit are reachable here too).
  const [detailSale, setDetailSale] = useState<SalesRow | null>(null);
  const { stats, rows } = overview;

  /** Reshape a Payments row to the shared SalesRow contract (same charge data). */
  function toSalesRow(p: PaymentRow): SalesRow {
    return {
      id: p.id,
      when: p.when,
      whenDisplay: p.whenDisplay,
      customerName: p.customer.name,
      customerId: p.customer.userId,
      packageLabel: p.packageLabel,
      packageId: p.packageId,
      method: p.method,
      amount: p.amount,
      status: p.status,
      hasSlip: p.hasSlip,
    };
  }

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("admin_payments")}
        </h1>
        <button
          type="button"
          onClick={() => setPosOpen(true)}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 font-body text-[13.5px] font-semibold text-cream"
        >
          <Plus />
          {t("pos_new_sale")}
        </button>
      </div>

      {/* stat tiles */}
      <div className="mb-[22px] grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("revenue_mtd")} value={thb(stats.revenuePaid)} />
        <Stat label={t("pkg_sales")} value={stats.packageSales} sub={t("this_month")} />
        <Stat
          label={t("pending")}
          value={thb(stats.pending)}
          accent={stats.pending ? "#9a7b45" : undefined}
        />
        <Stat label={t("new_members")} value={stats.newMembers} accent="var(--color-sage-deep)" />
      </div>

      {/* payments table */}
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
          {t("no_payments")}
        </p>
      ) : (
        <PaymentsTable
          rows={rows}
          onReview={setReviewRow}
          onOpen={(p) => setDetailSale(toSalesRow(p))}
        />
      )}

      {/* POS flow drawer */}
      <PosDrawer open={posOpen} onClose={() => setPosOpen(false)} customers={customers} />

      {/* slip verification drawer */}
      <SlipReviewDrawer row={reviewRow} onClose={() => setReviewRow(null)} />

      {/* shared sale detail (details / slip / sale-time correction) */}
      <SaleDetailDrawer sale={detailSale} onClose={() => setDetailSale(null)} />
    </div>
  );
}

// ───────────────────────── payments table ─────────────────────────

const METHOD_LABEL: Record<PaymentMethod, StrKey> = {
  promptpay: "pos_method_promptpay",
  cash: "pos_method_cash",
};

function PaymentsTable({
  rows,
  onReview,
  onOpen,
}: {
  rows: PaymentRow[];
  onReview: (row: PaymentRow) => void;
  /** Row tap → open the shared sale-detail drawer. */
  onOpen: (row: PaymentRow) => void;
}) {
  const { t, tt } = useAdminLang();

  // Member · Package · Method[hide-sm] · Amount(right) · Status(right) · Action.
  // Method collapses on small screens (prototype's admin-hide-sm).
  const grid =
    "grid grid-cols-[1.5fr_1fr_auto_auto] sm:grid-cols-[1.8fr_1.4fr_1fr_1fr_auto_auto] items-center gap-3";

  return (
    <div
      role="table"
      aria-label={t("admin_payments")}
      className="overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-soft"
    >
      {/* header */}
      <div
        role="row"
        className={`${grid} border-b border-line bg-surface px-[18px] py-3 font-body text-[11px] font-semibold uppercase tracking-[0.06em] text-muted`}
      >
        <span role="columnheader">{t("member")}</span>
        <span role="columnheader">{t("pkg_sales")}</span>
        <span role="columnheader" className="hidden sm:block">
          {t("pos_method")}
        </span>
        <span role="columnheader" className="text-right">
          {t("amount")}
        </span>
        <span role="columnheader" className="text-right">
          {t("status")}
        </span>
        {/* action column — header is visually empty (the cells carry "View slip") */}
        <span role="columnheader" className="sr-only">
          {t("admin_view_slip")}
        </span>
      </div>

      {/* rows */}
      <div role="rowgroup">
        {rows.map((p) => {
          const badge = STATUS_BADGE[p.status];
          return (
            <div
              key={p.id}
              role="row"
              tabIndex={0}
              // A slip awaiting a decision opens the approve/reject drawer directly
              // (so it's one tap on a phone); any other row opens the read-only detail.
              onClick={() => (p.status === "awaiting_review" ? onReview(p) : onOpen(p))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (p.status === "awaiting_review") onReview(p);
                  else onOpen(p);
                }
              }}
              aria-label={`${p.customer.name} · ${thb(p.amount)}`}
              className={`${grid} cursor-pointer border-b border-line px-[18px] py-3 transition-colors last:border-b-0 hover:bg-surface`}
            >
              {/* member */}
              <span role="cell" className="flex min-w-0 items-center gap-2.5">
                <Avatar name={p.customer.name} seed={p.customer.userId} size={32} />
                <span className="min-w-0">
                  <span className="block truncate font-body text-[13.5px] font-semibold text-ink">
                    {p.customer.name}
                  </span>
                  <span className="font-body text-[11.5px] text-muted">{p.whenDisplay}</span>
                </span>
              </span>

              {/* package */}
              <span
                role="cell"
                className="min-w-0 truncate font-body text-[13.5px] font-semibold text-ink"
              >
                {tt(p.packageLabel)}
              </span>

              {/* method */}
              <span
                role="cell"
                className="hidden items-center gap-1.5 font-body text-[12.5px] text-ink-soft sm:flex"
              >
                {p.method === "promptpay" ? <PromptPayMark /> : <CashMark />}
                {t(METHOD_LABEL[p.method])}
              </span>

              {/* amount */}
              <span
                role="cell"
                className="text-right font-head text-[14.5px] font-bold text-ink tabular-nums"
              >
                {thb(p.amount)}
              </span>

              {/* status */}
              <span role="cell" className="text-right">
                <Badge tone={badge.tone}>{t(badge.key)}</Badge>
              </span>

              {/* action — "View slip" only for rows that have an uploaded slip */}
              <span role="cell" className="text-right">
                {p.hasSlip ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      // The row itself opens the detail drawer — don't double-fire.
                      e.stopPropagation();
                      onReview(p);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 font-body text-[12px] font-semibold text-ink-soft transition-colors hover:border-taupe hover:text-ink"
                  >
                    <EyeIcon />
                    <span className="hidden sm:inline">{t("admin_view_slip")}</span>
                  </button>
                ) : (
                  <span className="sr-only">{t("no_payments")}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── slip verification drawer ─────────────────────────

function SlipReviewDrawer({
  row,
  onClose,
}: {
  row: PaymentRow | null;
  onClose: () => void;
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [slip, setSlip] = useState<SlipImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  // Load the slip image (PII — admin-gated server action) whenever a row opens.
  useEffect(() => {
    if (!row) {
      setSlip(null);
      setReason("");
      setErrorKey(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSlip(null);
    setErrorKey(null);
    getSlip({ chargeId: row.id })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setSlip(res.slip);
        else setErrorKey("admin_slip_review_failed");
      })
      .catch(() => {
        if (!cancelled) setErrorKey("admin_slip_review_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row]);

  function onApprove() {
    if (!row) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await approveSlip({ chargeId: row.id });
      if (!res.ok) {
        setErrorKey("admin_slip_review_failed");
        return;
      }
      onClose();
      router.refresh();
    });
  }

  function onReject() {
    if (!row) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await rejectSlip({ chargeId: row.id, reason: reason.trim() || undefined });
      if (!res.ok) {
        setErrorKey("admin_slip_review_failed");
        return;
      }
      onClose();
      router.refresh();
    });
  }

  const slipAlt = row
    ? t("admin_slip_alt").replace("{name}", row.customer.name)
    : t("admin_slip_review_title");

  // Approve/Reject only make sense while the slip is still under review.
  const actionable = row?.status === "awaiting_review";

  const footer = actionable ? (
    <>
      <button
        type="button"
        onClick={onReject}
        disabled={pending || loading}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line-strong px-4 font-body text-sm font-semibold text-[#a56a52] disabled:opacity-50"
      >
        {t("admin_reject")}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onApprove}
        disabled={pending || loading}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        {t("admin_approve")}
      </button>
    </>
  ) : undefined;

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={t("admin_slip_review_title")}
      footer={footer}
    >
      {row && (
        <div className="flex flex-col gap-4">
          {/* customer · package · amount summary */}
          <div className="flex items-center gap-2.5 rounded-2xl bg-cream-2 px-3.5 py-3">
            <Avatar name={row.customer.name} seed={row.customer.userId} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-body text-sm font-semibold text-ink">
                {row.customer.name}
              </span>
              <span className="block truncate font-body text-[12px] text-muted">
                {tt(row.packageLabel)}
              </span>
            </span>
            <span className="font-head text-base font-bold text-taupe-deep tabular-nums">
              {thb(row.amount)}
            </span>
          </div>

          {/* current status badge */}
          <div className="flex items-center justify-between">
            <span className="font-body text-[13px] text-muted">{t("status")}</span>
            <Badge tone={STATUS_BADGE[row.status].tone}>{t(STATUS_BADGE[row.status].key)}</Badge>
          </div>

          {/* slip image (PII — admin only) */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
            {loading ? (
              <div className="grid h-[220px] place-items-center font-body text-[13px] text-muted">
                {t("admin_slip_loading")}
              </div>
            ) : slip ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slip.dataUrl}
                alt={slipAlt}
                className="max-h-[420px] w-full object-contain"
              />
            ) : (
              <div className="grid h-[220px] place-items-center font-body text-[13px] text-muted">
                {t("admin_slip_review_failed")}
              </div>
            )}
          </div>

          {/* a previously-rejected charge shows the standing reason */}
          {row.status === "rejected" && (
            <p className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] text-[#a56a52]">
              {t("admin_slip_rejected")}
            </p>
          )}

          {/* optional rejection reason (only when actionable) */}
          {actionable && (
            <label className="flex flex-col gap-1.5">
              <span className="font-body text-[12.5px] font-semibold text-ink-soft">
                {t("admin_reject_reason")}
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("admin_reject_reason_ph")}
                rows={2}
                className="w-full resize-none rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 font-body text-sm text-ink placeholder:text-muted"
              />
            </label>
          )}

          {errorKey && (
            <p role="alert" className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]">
              {t(errorKey)}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ───────────────────────── POS flow ─────────────────────────

type Step = "package" | "customer" | "method" | "qr" | "receipt";

interface Receipt {
  hoursAdded: number;
  amount: number;
  customerName: string;
}

function PosDrawer({
  open,
  onClose,
  customers,
}: {
  open: boolean;
  onClose: () => void;
  customers: AdminCustomer[];
}) {
  const { t } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>("package");
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [customer, setCustomer] = useState<AdminCustomer | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("promptpay");
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  // The pending PromptPay charge to confirm (qr step).
  const [charge, setCharge] = useState<{ chargeId: string; qrPayload: string; amount: number; reference: string } | null>(
    null,
  );
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // One idempotency token per sale attempt, REUSED across retries so a dropped
  // response / double-tap can't double-charge (the server keys the cash credit on
  // it). Minted lazily on the first charge and cleared when a new sale starts.
  const [idemKey, setIdemKey] = useState<string | null>(null);

  const catalog = useMemo(() => listPackageCatalog(), []);

  function reset() {
    setStep("package");
    setItem(null);
    setCustomer(null);
    setMethod("promptpay");
    setErrorKey(null);
    setCharge(null);
    setReceipt(null);
    setIdemKey(null);
  }

  function close() {
    onClose();
    // Reset after the drawer has closed so the steps don't flash on the way out.
    window.setTimeout(reset, 200);
  }

  // ── actions ──

  function startSale() {
    if (!item || !customer) return;
    setErrorKey(null);
    // Reuse the token across retries of THIS sale; mint one on the first attempt.
    const key = idemKey ?? crypto.randomUUID();
    if (idemKey !== key) setIdemKey(key);
    startTransition(async () => {
      const res: PosSellPackageResult = await posSellPackage({
        customerId: customer.id,
        packageId: item.id,
        method,
        idempotencyKey: key,
      });
      if (!res.ok) {
        setErrorKey(posErrorKey(res.code));
        return;
      }
      if (res.sale.method === "cash") {
        setReceipt({
          hoursAdded: res.sale.hoursAdded,
          amount: res.sale.amount,
          customerName: customer.name,
        });
        setStep("receipt");
        router.refresh();
      } else {
        setCharge({
          chargeId: res.sale.chargeId,
          qrPayload: res.sale.qrPayload,
          amount: res.sale.amount,
          reference: res.sale.reference,
        });
        setStep("qr");
      }
    });
  }

  function confirmPromptPay() {
    if (!charge || !customer || !item) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await posConfirmPayment({ chargeId: charge.chargeId });
      if (!res.ok) {
        setErrorKey(posErrorKey(res.code));
        return;
      }
      setReceipt({
        hoursAdded: res.receipt.hoursAdded,
        amount: charge.amount,
        customerName: customer.name,
      });
      setStep("receipt");
      router.refresh();
    });
  }

  // ── footer (per step) ──

  let footer: React.ReactNode;
  if (step === "method") {
    footer = (
      <button
        type="button"
        onClick={startSale}
        disabled={pending || !item || !customer}
        className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        <Check />
        {t("pos_complete_sale")}
      </button>
    );
  } else if (step === "qr") {
    footer = (
      <button
        type="button"
        onClick={confirmPromptPay}
        disabled={pending}
        className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        <Check />
        {t("ive_paid")}
      </button>
    );
  } else if (step === "receipt") {
    footer = (
      <>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line-strong px-4 font-body text-sm font-semibold text-ink"
        >
          <Plus />
          {t("pos_new_sale")}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={close}
          className="inline-flex h-11 items-center rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream"
        >
          {t("pos_sale_done")}
        </button>
      </>
    );
  }

  // Title reflects the step.
  const title =
    step === "package"
      ? t("pos_pick_package")
      : step === "customer"
        ? t("pos_select_customer")
        : step === "receipt"
          ? t("pos_receipt")
          : t("pos_new_sale");

  return (
    <Drawer open={open} onClose={close} title={title} footer={footer}>
      {step === "package" && (
        <PackageStep
          catalog={catalog}
          selectedId={item?.id ?? null}
          onPick={(picked) => {
            setItem(picked);
            setStep("customer");
          }}
        />
      )}

      {step === "customer" && item && (
        <CustomerStep
          customers={customers}
          item={item}
          onBack={() => setStep("package")}
          onPick={(c) => {
            setCustomer(c);
            setStep("method");
          }}
        />
      )}

      {step === "method" && item && customer && (
        <MethodStep
          item={item}
          customer={customer}
          method={method}
          onMethod={setMethod}
          onBack={() => setStep("customer")}
          errorKey={errorKey}
        />
      )}

      {step === "qr" && charge && item && (
        <QrStep charge={charge} item={item} errorKey={errorKey} />
      )}

      {step === "receipt" && receipt && <ReceiptStep receipt={receipt} />}
    </Drawer>
  );
}

// ───────────────────────── step: pick package ─────────────────────────

function PackageStep({
  catalog,
  selectedId,
  onPick,
}: {
  catalog: CatalogCategory[];
  selectedId: string | null;
  onPick: (item: CatalogItem) => void;
}) {
  const { t, tt } = useAdminLang();
  return (
    <div className="flex flex-col gap-5">
      <p className="font-body text-[13px] text-muted">{t("pos_pick_package")}</p>
      {catalog.map((cat) => (
        <section key={cat.id}>
          <h4 className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            {tt(cat.label)}
          </h4>
          <div className="grid grid-cols-2 gap-2.5">
            {cat.items.map((it) => {
              const on = it.id === selectedId;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onPick(it)}
                  className={`flex min-h-[96px] flex-col justify-between rounded-2xl border bg-surface-2 p-3.5 text-left shadow-soft transition-colors ${
                    on ? "border-taupe" : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-cream-2 text-taupe-deep">
                    <ClockIcon />
                  </span>
                  <span>
                    <span className="block font-body text-[13.5px] font-semibold leading-tight text-ink">
                      {tt(it.label)}
                    </span>
                    <span className="mt-1 block font-head text-base font-bold text-taupe-deep">
                      {thb(it.price)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {/* TODO(retail): the prototype's POS has a Retail tab + multi-item cart; the
          backend sells ONE package per call (admin-pos.ts), so retail is out of
          scope for v1 until a products model exists. */}
    </div>
  );
}

// ───────────────────────── step: assign customer ─────────────────────────

function CustomerStep({
  customers,
  item,
  onBack,
  onPick,
}: {
  customers: AdminCustomer[];
  item: CatalogItem;
  onBack: () => void;
  onPick: (c: AdminCustomer) => void;
}) {
  const { t } = useAdminLang();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(term) || c.phone.toLowerCase().includes(term),
    );
  }, [customers, q]);

  return (
    <div className="flex flex-col gap-3">
      <SelectedItemRow item={item} onBack={onBack} />

      <p className="font-body text-[13px] text-muted">{t("pos_assign_customer")}</p>

      {/* search */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search_members")}
          aria-label={t("search_members")}
          className="h-11 w-full rounded-xl border border-line-strong bg-surface px-10 font-body text-sm text-ink placeholder:text-muted"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface-2 p-6 text-center font-body text-sm text-muted">
          {t("no_members")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full items-center gap-3 rounded-[13px] border border-line bg-surface-2 px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
              >
                <Avatar name={c.name} seed={c.id} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-body text-sm font-semibold text-ink">
                      {c.name}
                    </span>
                    {c.tier === "member" && <Sparkle size={10} />}
                  </span>
                  <span className="font-body text-[11.5px] text-muted">{c.phone}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── step: method ─────────────────────────

const METHODS: { value: PaymentMethod; label: StrKey }[] = [
  { value: "promptpay", label: "pos_method_promptpay" },
  { value: "cash", label: "pos_method_cash" },
];

function MethodStep({
  item,
  customer,
  method,
  onMethod,
  onBack,
  errorKey,
}: {
  item: CatalogItem;
  customer: AdminCustomer;
  method: PaymentMethod;
  onMethod: (m: PaymentMethod) => void;
  onBack: () => void;
  errorKey: StrKey | null;
}) {
  const { t } = useAdminLang();

  return (
    <div className="flex flex-col gap-4">
      <SelectedItemRow item={item} onBack={onBack} />

      {/* assigned customer */}
      <div className="flex items-center gap-2.5 rounded-2xl bg-cream-2 px-3.5 py-3">
        <Avatar name={customer.name} seed={customer.id} size={32} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-body text-sm font-semibold text-ink">
              {customer.name}
            </span>
            {customer.tier === "member" && <Sparkle size={10} />}
          </span>
          <span className="font-body text-[11.5px] text-muted">{customer.phone}</span>
        </span>
      </div>

      {/* total */}
      <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3.5">
        <span className="font-body text-sm text-ink-soft">{t("total")}</span>
        <span className="font-head text-2xl font-bold text-ink tabular-nums">{thb(item.price)}</span>
      </div>

      {/* method radiogroup */}
      <div
        role="radiogroup"
        aria-label={t("pos_method")}
        className="flex flex-col gap-2.5"
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            onMethod(method === "promptpay" ? "cash" : "promptpay");
          }
        }}
      >
        {METHODS.map((m) => {
          const on = m.value === method;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onMethod(m.value)}
              className={`flex items-center gap-3 rounded-2xl border-[1.5px] px-4 py-3.5 text-left ${
                on ? "border-taupe bg-surface-2" : "border-line"
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-cream-2 text-taupe-deep">
                {m.value === "promptpay" ? <PromptPayMark size={18} /> : <CashMark size={18} />}
              </span>
              <span className="flex-1 font-body text-[15px] font-semibold text-ink">
                {t(m.label)}
              </span>
              <span
                className={`flex items-center justify-center rounded-full border-[1.5px] ${
                  on ? "border-taupe bg-taupe text-white" : "border-line-strong"
                }`}
                style={{ width: 22, height: 22 }}
              >
                {on && <Check small />}
              </span>
            </button>
          );
        })}
      </div>

      {errorKey && (
        <p role="alert" className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]">
          {t(errorKey)}
        </p>
      )}
    </div>
  );
}

// ───────────────────────── step: PromptPay QR ─────────────────────────

function QrStep({
  charge,
  item,
  errorKey,
}: {
  charge: { qrPayload: string; amount: number; reference: string };
  item: CatalogItem;
  errorKey: StrKey | null;
}) {
  const { t, tt } = useAdminLang();
  const qrAlt = t("qr_alt")
    .replace("{amount}", thb(charge.amount))
    .replace("{reference}", charge.reference);

  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="mb-1.5 font-head text-xl font-semibold text-ink">{t("scan_to_pay")}</h2>
      <span
        className="mb-4 inline-flex items-center rounded-full px-3 py-1 font-body text-[11.5px] font-bold tracking-wide text-white"
        style={{ background: "#1a3a6b" }}
      >
        PromptPay
      </span>

      <div className="w-fit rounded-2xl border border-line bg-surface-2 p-[18px] shadow-lift">
        <PromptPayQr payload={charge.qrPayload} alt={qrAlt} size={170} />
      </div>

      <p className="mx-auto mt-3.5 max-w-[240px] font-body text-[13px] leading-relaxed text-muted">
        {t("scan_hint")}
      </p>

      {/* save the QR image — send it to the customer via LINE, or save to gallery */}
      <div className="mt-3.5 w-full">
        <QrDownloadButton
          payload={charge.qrPayload}
          filename={`lune-promptpay-${charge.amount}.png`}
          label={t("download_qr")}
          ariaLabel={t("download_qr_aria")}
          amountLabel={`PromptPay ${thb(charge.amount)}`}
        />
      </div>

      {/* receipt-ish: package + amount */}
      <div className="mt-4 w-full overflow-hidden rounded-2xl border border-line">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-body text-[13px] text-ink-soft">{tt(item.label)}</span>
          <span className="font-body text-[13px] text-muted">+{fmtHours(item.hours)} {t("hrs")}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-body text-[13px] text-ink-soft">{t("amount")}</span>
          <span className="font-head text-base font-bold text-ink tabular-nums">{thb(charge.amount)}</span>
        </div>
      </div>

      {errorKey && (
        <p role="alert" className="mt-3 w-full rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]">
          {t(errorKey)}
        </p>
      )}
    </div>
  );
}

// ───────────────────────── step: receipt ─────────────────────────

function ReceiptStep({ receipt }: { receipt: Receipt }) {
  const { t } = useAdminLang();
  return (
    <div className="flex flex-col items-center pt-2 text-center">
      <span
        className="mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-sage text-white"
        style={{ boxShadow: "0 10px 28px rgba(140,154,126,0.4)" }}
      >
        <Check big />
      </span>
      <h2 className="mb-1.5 font-head text-2xl font-semibold text-ink">{t("pos_receipt")}</h2>
      <p className="font-head text-3xl font-bold text-taupe-deep tabular-nums">{thb(receipt.amount)}</p>
      <p className="mt-2 font-body text-sm text-ink-soft">
        {t("pos_credited_to")
          .replace("{hours}", fmtHours(receipt.hoursAdded))
          .replace("{name}", receipt.customerName)}
      </p>
    </div>
  );
}

// ───────────────────────── shared step UI ─────────────────────────

/** The chosen package, with a Back button — shown atop steps after the pick. */
function SelectedItemRow({
  item,
  onBack,
}: {
  item: CatalogItem;
  onBack: () => void;
}) {
  const { t, tt } = useAdminLang();
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("pos_pick_package")}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-soft"
      >
        <ChevL />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-[13.5px] font-semibold text-ink">
          {tt(item.label)}
        </span>
        <span className="font-body text-[11.5px] text-muted">
          +{fmtHours(item.hours)} {t("hrs")}
        </span>
      </span>
      <span className="font-head text-[15px] font-bold text-taupe-deep tabular-nums">
        {thb(item.price)}
      </span>
    </div>
  );
}

// ───────────────────────── icons ─────────────────────────

function Plus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function Check({ big, small }: { big?: boolean; small?: boolean }) {
  const s = big ? 34 : small ? 12 : 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={small ? 3 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function ChevL() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
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
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
/** Eye glyph for the "View slip" row action. */
function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
/** PromptPay tender mark (the prototype's small navy "P" chip). */
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
/** Cash tender mark (banknote glyph). */
function CashMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v.01M18 14v.01" />
    </svg>
  );
}
