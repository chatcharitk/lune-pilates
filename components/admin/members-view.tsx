"use client";

// Admin "Members / Customers & households" (admin-more.jsx MembersScreen + spec
// §4: house numbers, sharing groups, balances; add a new customer on the spot).
// A searchable customer table → a household-sharing detail drawer, plus an
// "Add customer" form drawer wired to the createCustomer action.
//
// All copy is keyed via the admin language context. Balances/expiry/status are the
// server's (CLAUDE.md §5 invariant 2: a member's balance is the shared household
// pool; invariant 3: a guest's is their own, non-transferable). This view imports
// ONLY the action + erased types — never the DB read model.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Drawer, MiniStat, Sparkle } from "./ui";
import { createCustomer } from "@/app/actions/admin-members";
import {
  adjustCredits,
  getAdjustablePackages,
  getCustomerLedger,
  type AdjustablePackage,
  type AdjustFailureCode,
} from "@/app/actions/admin-credits";
import type { AdminCustomer, CustomerLedgerEntry, LedgerReason } from "@/lib/admin/members";
import type { StrKey } from "@/lib/i18n";


/** Short localised date for an expiry ("24 Jun" / Thai). */
function fmtDate(iso: string, lang: "en" | "th"): string {
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

// ───────────────────────── component ─────────────────────────

export function MembersView({
  customers,
  isOwner,
}: {
  customers: AdminCustomer[];
  /** Owner-scoped controls (Adjust credits) render only when true. */
  isOwner: boolean;
}) {
  const { t, lang } = useAdminLang();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<StrKey | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.house ?? "").toLowerCase().includes(term) ||
        c.phone.toLowerCase().includes(term),
    );
  }, [customers, q]);

  const open = useMemo(
    () => customers.find((c) => c.id === openId) ?? null,
    [customers, openId],
  );

  function flash(key: StrKey) {
    setToast(key);
    window.setTimeout(() => setToast(null), 3200);
  }

  // Member/House/Credits/Sharing/chevron — house, sharing and the chevron collapse
  // on small screens (prototype's admin-hide-sm + dropped column).
  const grid =
    "grid grid-cols-[1.7fr_1fr] sm:grid-cols-[2fr_0.9fr_1.1fr_0.9fr_36px] items-center gap-3";

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
            {t("admin_members")}
          </h1>
          <p className="mt-1 font-body text-[13.5px] text-muted">
            {t("total_members").replace("{n}", String(customers.length))}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 font-body text-[13.5px] font-semibold text-cream"
        >
          <Plus />
          {t("add_customer")}
        </button>
      </div>

      {toast && (
        <div
          role="status"
          className="mb-4 rounded-xl bg-sage/15 px-4 py-2.5 font-body text-[13px] font-semibold text-sage-deep"
        >
          {t(toast)}
        </div>
      )}

      {/* search */}
      <div className="relative mb-[18px] max-w-[420px]">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search_members")}
          aria-label={t("search_members")}
          className="h-11 w-full rounded-xl border border-line-strong bg-surface-2 pl-10 pr-3.5 font-body text-sm text-ink placeholder:text-muted"
        />
      </div>

      {/* table */}
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
          {t("no_members")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-soft">
          <div
            className={`${grid} border-b border-line bg-surface px-[18px] py-3 font-body text-[11px] font-semibold uppercase tracking-[0.06em] text-muted`}
          >
            <span>{t("member")}</span>
            <span className="hidden sm:block">{t("house_label")}</span>
            <span>{t("credits")}</span>
            <span className="hidden sm:block">{t("sharing")}</span>
            <span aria-hidden className="hidden sm:block" />
          </div>

          <ul>
            {filtered.map((c) => {
              const expiring = c.status === "expiring";
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className={`${grid} w-full border-b border-line px-[18px] py-3 text-left transition-colors last:border-b-0 hover:bg-surface`}
                  >
                    {/* member */}
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={c.name} seed={c.id} size={36} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-body text-sm font-semibold text-ink">
                            {c.name}
                          </span>
                          {c.tier === "member" && <Sparkle size={11} />}
                        </span>
                        <span className="font-body text-xs text-muted">
                          {c.tier === "member" ? t("member") : t("guest")}
                        </span>
                      </span>
                    </span>

                    {/* house */}
                    <span className="hidden font-body text-[13.5px] text-ink-soft sm:block">
                      {c.house ?? "—"}
                    </span>

                    {/* credits */}
                    <span className="min-w-0">
                      <span className="font-head text-[15px] font-bold" style={{ color: expiring ? "#a56a52" : "var(--color-ink)" }}>
                        {String(c.balance)}
                      </span>
                      <span className="ml-1 font-body text-[11.5px] text-muted">{t("hrs")}</span>
                      <span
                        className="block font-body text-[11px]"
                        style={{ color: expiring ? "#a56a52" : "var(--color-muted)" }}
                      >
                        {expiring
                          ? t("expiring_soon")
                          : c.expiry
                            ? t("expires_till").replace("{date}", fmtDate(c.expiry, lang))
                            : "—"}
                      </span>
                    </span>

                    {/* sharing */}
                    <span className="hidden sm:block">
                      {c.tier === "member" ? (
                        <Badge tone="green">
                          <ShareIcon />
                          {c.sharing && c.sharing.shared ? c.sharing.householdSize : t("active")}
                        </Badge>
                      ) : (
                        <span className="font-body text-[12.5px] text-muted">—</span>
                      )}
                    </span>

                    {/* chevron */}
                    <span aria-hidden className="hidden justify-self-end text-muted sm:block">
                      <ChevR />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <CustomerDrawer
        customer={open}
        all={customers}
        isOwner={isOwner}
        onClose={() => setOpenId(null)}
        onAdjusted={() => flash("toast_credit_adjusted")}
      />

      <AddCustomerDrawer
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          flash("toast_customer_added");
        }}
      />
    </div>
  );
}

// ───────────────────────── detail drawer ─────────────────────────

function CustomerDrawer({
  customer,
  all,
  isOwner,
  onClose,
  onAdjusted,
}: {
  customer: AdminCustomer | null;
  all: AdminCustomer[];
  isOwner: boolean;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const { t, lang } = useAdminLang();

  // Housemates derived from the fetched list: the MEMBERS sharing this house number
  // (the credit-sharing household — guests are standalone, invariant 3). Only a
  // member with a house has one; matches the server getCustomerDetail grouping.
  const housemates =
    customer && customer.tier === "member" && customer.house
      ? all.filter((c) => c.tier === "member" && c.house === customer.house)
      : [];
  const expiring = customer?.status === "expiring";

  return (
    <Drawer open={customer !== null} onClose={onClose} title={customer?.name ?? ""}>
      {customer && (
        <div className="flex flex-col gap-5">
          {/* identity */}
          <div className="flex items-center gap-3.5">
            <Avatar name={customer.name} seed={customer.id} size={56} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-head text-xl font-semibold text-ink">{customer.name}</span>
                {customer.tier === "member" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 font-body text-[11.5px] font-semibold text-cream">
                    <Sparkle size={10} color="#c9b89e" />
                    {t("member")}
                  </span>
                )}
              </div>
              <p className="mt-1 font-body text-[13px] text-muted">{customer.phone}</p>
            </div>
          </div>

          {/* stats */}
          <div className="grid grid-cols-2 gap-3">
            <MiniStat
              label={t("credits")}
              value={`${String(customer.balance)} ${t("hrs")}`}
              sub={customer.expiry ? t("expires_on").replace("{date}", fmtDate(customer.expiry, lang)) : undefined}
              tone={expiring ? "rose" : undefined}
            />
            <MiniStat
              label={t("house_label")}
              value={customer.house ?? "—"}
              sub={customer.house ? t("in_house").replace("{n}", String(housemates.length)) : undefined}
            />
          </div>

          {/* adjust credits — OWNER-ONLY (Group D #8). The money is the server's:
              this never optimistically mutates the balance, it router.refresh()es
              on success so the pool re-reads from the ledger (CLAUDE.md §8). */}
          {isOwner && (
            <AdjustCreditsControl
              customer={customer}
              onAdjusted={() => {
                onClose();
                onAdjusted();
              }}
            />
          )}

          {/* credit-transaction history (read model via the owner-gated action) */}
          <LedgerSection customerId={customer.id} />

          {/* sharing group */}
          <div>
            <p className="mb-2.5 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {t("shared_group")}
              {customer.house ? ` · ${t("house_label")} ${customer.house}` : ""}
            </p>

            {customer.tier === "member" ? (
              <div className="flex flex-col gap-2">
                {housemates.map((hm) => (
                  <div
                    key={hm.id}
                    className="flex items-center gap-3 rounded-[13px] border border-line px-3 py-2.5"
                  >
                    <Avatar name={hm.name} seed={hm.id} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-body text-[13.5px] font-semibold text-ink">{hm.name}</p>
                      <p className="font-body text-xs text-muted">
                        {hm.tier === "member" ? t("member") : t("guest")}
                      </p>
                    </div>
                    {hm.id === customer.id && <Badge tone="neutral">{t("this_member")}</Badge>}
                  </div>
                ))}
                <div className="mt-1 flex gap-2.5 rounded-[13px] bg-sage/10 px-3.5 py-3">
                  <span className="mt-px shrink-0 text-sage-deep">
                    <ShareIcon size={18} />
                  </span>
                  <p className="font-body text-[12.5px] leading-relaxed text-ink-soft">
                    {t("share_note_member")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex gap-2.5 rounded-[13px] bg-cream-2 px-3.5 py-3">
                <span className="mt-px shrink-0 text-muted">
                  <InfoIcon />
                </span>
                <p className="font-body text-[12.5px] leading-relaxed text-ink-soft">
                  {t("share_note_guest")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ───────────────────────── adjust-credits control (OWNER-ONLY, Group D #8) ─────────────────────────

/** Map an adjust failure code to keyed copy (reuses POS customer/package errors). */
function adjustErrorKey(code: AdjustFailureCode): StrKey {
  switch (code) {
    case "NEGATIVE_BALANCE":
      return "err_negative_balance";
    case "UNKNOWN_PACKAGE":
      return "err_unknown_package";
    case "UNKNOWN_CUSTOMER":
      return "err_unknown_customer";
    default:
      return "err_adjust_credits";
  }
}

/**
 * Owner control to apply a signed credit adjustment to one of a customer's
 * packages. Lists the customer's packages (auto-selects when there's exactly one),
 * a +/- signed whole-number amount, a required note, and a confirm button disabled
 * while pending (the double-submit guard). One idempotencyKey is minted per
 * drawer-open and reused across retries so a dropped response can't double-apply.
 * On success it router.refresh()es (re-reads the balance from the server — the UI
 * never mutates the money) and toasts via onAdjusted.
 */
function AdjustCreditsControl({
  customer,
  onAdjusted,
}: {
  customer: AdminCustomer;
  onAdjusted: () => void;
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<AdjustablePackage[]>([]);
  const [packageId, setPackageId] = useState<string | null>(null);
  // Sign + magnitude are tracked separately so the +/- toggle is explicit; the
  // signed delta is recomputed on submit. magnitude is the raw text (so the field
  // can be empty mid-edit) and validated to a positive integer before sending.
  const [sign, setSign] = useState<1 | -1>(1);
  const [magnitude, setMagnitude] = useState("");
  const [note, setNote] = useState("");
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  // One idempotency token per drawer-open (minted when the control opens), reused
  // across retries so a double-tap / dropped response can't double-apply.
  const [idempotencyKey, setIdempotencyKey] = useState("");

  // Load the customer's adjustable packages whenever the control opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErrorKey(null);
    getAdjustablePackages(customer.id)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setPackages(res.packages);
          // Auto-select when there's exactly one package.
          setPackageId(res.packages.length === 1 ? res.packages[0]!.id : null);
        } else {
          setPackages([]);
          setErrorKey(adjustErrorKey(res.code));
        }
      })
      .catch(() => {
        if (!cancelled) setErrorKey("err_adjust_credits");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, customer.id]);

  function openControl() {
    setSign(1);
    setMagnitude("");
    setNote("");
    setErrorKey(null);
    setPackages([]);
    setPackageId(null);
    setIdempotencyKey(crypto.randomUUID());
    setOpen(true);
  }

  const magInt = Number.parseInt(magnitude, 10);
  const deltaValid = Number.isInteger(magInt) && magInt > 0;
  const canSubmit = !pending && !loading && !!packageId && deltaValid && note.trim().length > 0;

  function submit() {
    if (!packageId || !deltaValid) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await adjustCredits({
        customerId: customer.id,
        packageId,
        deltaHours: sign * magInt,
        note: note.trim(),
        idempotencyKey,
      });
      if (res.ok) {
        // Re-read the balance from the server — never optimistically mutate money.
        router.refresh();
        setOpen(false);
        onAdjusted();
      } else {
        setErrorKey(adjustErrorKey(res.code));
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openControl}
        className="inline-flex h-10 items-center gap-1.5 self-start rounded-xl border border-line-strong px-4 font-body text-[13.5px] font-semibold text-ink transition-colors hover:border-taupe"
      >
        <CoinIcon />
        {t("adjust_credits")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <span className="font-body text-[12.5px] font-semibold uppercase tracking-[0.05em] text-muted">
          {t("adjust_credits")}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("cancel")}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-ink-soft"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loading ? (
        <p className="font-body text-[13px] text-muted">{t("admin_slip_loading")}</p>
      ) : packages.length === 0 ? (
        <p className="font-body text-[13px] text-muted">{t("adjust_no_packages")}</p>
      ) : (
        <>
          {/* package picker (auto-selected when exactly one) */}
          <Field label={t("adjust_select_package")}>
            <div className="flex flex-col gap-2">
              {packages.map((p) => {
                const on = p.id === packageId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPackageId(p.id)}
                    aria-pressed={on}
                    className={`flex items-center justify-between gap-2 rounded-xl border-[1.5px] px-3.5 py-2.5 text-left ${
                      on ? "border-taupe bg-surface" : "border-line"
                    }`}
                  >
                    <span className="min-w-0 truncate font-body text-[13.5px] font-semibold text-ink">
                      {tt(p.label)}
                    </span>
                    <span className="shrink-0 font-body text-[12px] text-muted">
                      {String(p.hoursLeft)} {t("hrs")}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* signed amount: +/- toggle + magnitude */}
          <Field label={t("adjust_amount")}>
            <div className="flex gap-2">
              <div
                role="radiogroup"
                aria-label={t("adjust_amount")}
                className="flex shrink-0 overflow-hidden rounded-xl border border-line-strong"
                onKeyDown={(e) => {
                  if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) {
                    e.preventDefault();
                    setSign((s) => (s === 1 ? -1 : 1));
                  }
                }}
              >
                {([1, -1] as const).map((s) => {
                  const on = sign === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on ? 0 : -1}
                      onClick={() => setSign(s)}
                      className={`px-4 font-head text-lg font-bold ${
                        on ? "bg-ink text-cream" : "bg-surface text-ink-soft"
                      }`}
                    >
                      {s === 1 ? "+" : "−"}
                      <span className="sr-only">{t(s === 1 ? "adjust_add" : "adjust_subtract")}</span>
                    </button>
                  );
                })}
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={magnitude}
                onChange={(e) => setMagnitude(e.target.value)}
                aria-label={t("adjust_amount")}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink placeholder:text-muted"
              />
            </div>
          </Field>

          {/* required note */}
          <Field label={t("adjust_note")}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("adjust_note_ph")}
              rows={2}
              className="w-full resize-none rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 font-body text-sm text-ink placeholder:text-muted"
            />
          </Field>

          {errorKey && (
            <p role="alert" className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]">
              {t(errorKey)}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
          >
            {t("adjust_confirm")}
          </button>
        </>
      )}
    </div>
  );
}

function CoinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.2a2.4 2.4 0 0 1 2.5-1.2c1.4 0 2.3.8 2.3 1.8 0 2.2-4.8 1.2-4.8 3.4 0 1 .9 1.8 2.3 1.8a2.4 2.4 0 0 0 2.5-1.2" />
    </svg>
  );
}

// ───────────────────────── credit-transaction history ─────────────────────────

/** Reason → keyed label for a ledger row. */
const LEDGER_REASON_KEY: Record<LedgerReason, StrKey> = {
  booking: "ledger_booking",
  cancel_refund: "ledger_cancel_refund",
  purchase: "ledger_purchase",
  adjustment: "ledger_adjustment",
};

/** Localised date + time for a ledger row (th-TH → Buddhist era, like the other
 *  admin date displays). */
function fmtLedgerDate(iso: string, lang: "en" | "th"): string {
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * The customer's credit-transaction history (newest-first), fetched on open via the
 * owner-gated getCustomerLedger action. The ledger is the server's source of truth
 * (invariants 1/2) — this only renders it. Loading / empty / error states; each row
 * shows the date, a keyed reason label, the signed delta (green +/rose −) and the
 * running balanceAfter.
 */
function LedgerSection({ customerId }: { customerId: string }) {
  const { t, lang } = useAdminLang();
  const [pending, startTransition] = useTransition();
  const [entries, setEntries] = useState<CustomerLedgerEntry[] | null>(null);

  // (Re)fetch whenever the drawer targets a different customer. The drawer remounts
  // this section per-customer (keyed on customerId via the parent), so this runs on open.
  useEffect(() => {
    setEntries(null);
    startTransition(async () => {
      const rows = await getCustomerLedger(customerId);
      setEntries(rows);
    });
  }, [customerId]);

  const loading = pending || entries === null;

  return (
    <div>
      <p className="mb-2.5 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
        {t("ledger_title")}
      </p>

      {loading ? (
        <p className="rounded-[13px] border border-line bg-surface-2 px-3.5 py-4 font-body text-[13px] text-muted">
          {t("ledger_loading")}
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-[13px] border border-line bg-surface-2 px-3.5 py-4 text-center font-body text-[13px] text-muted">
          {t("ledger_empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => {
            const positive = e.delta >= 0;
            return (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-[13px] border border-line px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-[13.5px] font-semibold text-ink">
                    {t(LEDGER_REASON_KEY[e.reason])}
                  </p>
                  <p className="font-body text-[11.5px] text-muted">
                    {fmtLedgerDate(e.createdAt, lang)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className="font-head text-[14.5px] font-bold tabular-nums"
                    style={{ color: positive ? "var(--color-sage-deep)" : "#a56a52" }}
                  >
                    {positive ? "+" : "−"}
                    {Math.abs(e.delta)}
                  </span>
                  <span className="block font-body text-[11px] text-muted tabular-nums">
                    {t("ledger_running_balance").replace("{n}", String(e.balanceAfter))}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── add-customer drawer ─────────────────────────

interface AddForm {
  name: string;
  phone: string;
  tier: "member" | "guest";
  houseNumber: string;
}

const EMPTY_FORM: AddForm = { name: "", phone: "", tier: "member", houseNumber: "" };

function AddCustomerDrawer({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useAdminLang();
  const router = useRouter();
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof AddForm>(key: K, value: AddForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    setErrorKey(null);
    startTransition(async () => {
      const res = await createCustomer({
        name: form.name,
        phone: form.phone,
        tier: form.tier,
        ...(form.tier === "member" && form.houseNumber.trim()
          ? { houseNumber: form.houseNumber.trim() }
          : {}),
      });
      if (res.ok) {
        setForm(EMPTY_FORM);
        onAdded();
        router.refresh();
      } else {
        setErrorKey(res.code === "PHONE_TAKEN" ? "err_phone_taken" : "err_add_customer");
      }
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("add_customer")}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 font-body text-sm font-semibold text-ink"
          >
            {t("cancel")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={submit}
            disabled={pending || !form.name.trim() || !form.phone.trim()}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
          >
            {t("save_customer")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errorKey && (
          <div className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]">
            {t(errorKey)}
          </div>
        )}

        <Field label={t("customer_name")}>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={t("ph_customer_name")}
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink placeholder:text-muted"
          />
        </Field>

        <Field label={t("phone_label")}>
          <input
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            inputMode="tel"
            placeholder={t("ph_phone")}
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink placeholder:text-muted"
          />
        </Field>

        <Field label={t("tier_label")}>
          <div
            role="radiogroup"
            aria-label={t("tier_label")}
            className="flex gap-2"
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                set("tier", form.tier === "member" ? "guest" : "member");
              }
            }}
          >
            {(["member", "guest"] as const).map((tier) => {
              const on = form.tier === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => set("tier", tier)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border-[1.5px] px-3 py-2.5 font-body text-[13.5px] font-semibold ${
                    on ? "border-taupe bg-surface text-ink" : "border-line text-ink-soft"
                  }`}
                >
                  {tier === "member" && <Sparkle size={11} />}
                  {t(tier === "member" ? "tier_member" : "tier_guest")}
                </button>
              );
            })}
          </div>
        </Field>

        {/* House number — members only (guests can't join a household, invariant 3) */}
        {form.tier === "member" && (
          <Field label={t("house_number")}>
            <input
              value={form.houseNumber}
              onChange={(e) => set("houseNumber", e.target.value)}
              placeholder={t("ph_house_number")}
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink placeholder:text-muted"
            />
          </Field>
        )}
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block font-body text-xs font-semibold tracking-wide text-ink-soft">
        {label}
      </span>
      {children}
    </label>
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
function ChevR() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
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
function ShareIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}
