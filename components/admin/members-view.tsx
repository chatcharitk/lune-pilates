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

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Drawer, MiniStat, Sparkle } from "./ui";
import { createCustomer } from "@/app/actions/admin-members";
import type { AdminCustomer } from "@/lib/admin/members";
import type { StrKey } from "@/lib/i18n";

// ───────────────────────── helpers ─────────────────────────

/** Whole-credit display: 1 → "1", 1.5 → "1.5". */
function fmtCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Short localised date for an expiry ("24 Jun" / Thai). */
function fmtDate(iso: string, lang: "en" | "th"): string {
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

// ───────────────────────── component ─────────────────────────

export function MembersView({ customers }: { customers: AdminCustomer[] }) {
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
                        {fmtCredits(c.balance)}
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

      <CustomerDrawer customer={open} all={customers} onClose={() => setOpenId(null)} />

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
  onClose,
}: {
  customer: AdminCustomer | null;
  all: AdminCustomer[];
  onClose: () => void;
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
              value={`${fmtCredits(customer.balance)} ${t("hrs")}`}
              sub={customer.expiry ? t("expires_on").replace("{date}", fmtDate(customer.expiry, lang)) : undefined}
              tone={expiring ? "rose" : undefined}
            />
            <MiniStat
              label={t("house_label")}
              value={customer.house ?? "—"}
              sub={customer.house ? t("in_house").replace("{n}", String(housemates.length)) : undefined}
            />
          </div>

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
