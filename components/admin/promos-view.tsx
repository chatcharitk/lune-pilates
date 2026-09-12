"use client";

// Settings → Promo codes: the owner's editor for event discounts (pre-opening,
// soft opening, grand opening).
//
// Conventions mirror visibility-view.tsx / packages-view.tsx: the shared Drawer for
// the form, useTransition + router.refresh() after every write, a transient keyed
// toast, and a failure-code → StrKey mapper so no server error is swallowed.
//
// Retiring a code switches it OFF rather than deleting it — the redemption rows
// reference it and record who received which discount.

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Badge, Drawer } from "./ui";
import {
  savePromoCode,
  setPromoActive,
  type AdminPromoCode,
  type SavePromoFailureCode,
} from "@/app/actions/admin-promos";
import type { PackageCategory } from "@/lib/domain/types";
import { isValidPromoCodeShape } from "@/lib/promos/codes";
import { thb, type Bilingual, type StrKey } from "@/lib/i18n";

const CATEGORY_KEY: Record<PackageCategory, StrKey> = {
  group: "cat_group",
  private: "cat_private",
  duo: "cat_duo",
  trio: "cat_trio",
  rental: "cat_rental",
};

function saveErrorKey(code: SavePromoFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_cat_forbidden";
    case "PERCENT_TOO_LARGE":
      return "err_promo_percent";
    case "BAD_WINDOW":
      return "err_promo_window";
    case "MOCK_NO_DB":
      return "err_cat_mock_no_db";
    default:
      return "err_promo_save";
  }
}

export interface PromoItemOption {
  id: string;
  label: Bilingual;
  category: PackageCategory;
}

interface FormState {
  mode: "new" | "edit";
  code?: AdminPromoCode;
}

export function PromosView({
  codes,
  items,
}: {
  codes: AdminPromoCode[];
  items: PromoItemOption[];
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [toast, setToast] = useState<StrKey | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  const [pending, startTransition] = useTransition();

  function flash(key: StrKey) {
    setErrorKey(null);
    setToast(key);
    window.setTimeout(() => setToast(null), 3200);
  }

  function toggle(code: AdminPromoCode) {
    setErrorKey(null);
    startTransition(async () => {
      const res = await setPromoActive({ code: code.code, active: !code.active });
      if (res.ok) {
        flash("promo_saved");
        router.refresh();
      } else {
        setErrorKey(res.code === "MOCK_NO_DB" ? "err_cat_mock_no_db" : "err_promo_save");
      }
    });
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
            {t("settings_promos_title")}
          </h1>
          <p className="mt-1 font-body text-[13.5px] leading-relaxed text-muted">
            {t("settings_promos_desc")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ mode: "new" })}
          className="inline-flex h-11 items-center rounded-xl bg-ink px-4 font-body text-sm font-semibold text-cream"
        >
          + {t("promo_new")}
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
      {errorKey && (
        <div role="alert" className="mb-4 rounded-xl bg-rose/15 px-4 py-2.5 font-body text-[13px] text-[#a56a52]">
          {t(errorKey)}
        </div>
      )}

      {codes.length === 0 ? (
        <p className="font-body text-[13.5px] text-muted">{t("promo_none")}</p>
      ) : (
        <ul className="flex max-w-3xl flex-col gap-2.5">
          {codes.map((c) => (
            <li
              key={c.code}
              className={`rounded-xl border px-4 py-3.5 ${
                c.active ? "border-line bg-surface" : "border-dashed border-line-strong bg-cream-2/40"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-body text-[14px] font-bold tracking-[0.06em] text-ink">
                      {c.code}
                    </span>
                    <Badge tone={c.active ? "green" : "neutral"}>
                      {c.kind === "percent" ? `−${c.value}%` : `−${thb(c.value)}`}
                    </Badge>
                    {c.firstPurchaseOnly && (
                      <Badge tone="amber">{t("promo_first_only")}</Badge>
                    )}
                  </div>
                  <p className="mt-1 font-body text-[12.5px] text-muted">
                    {tt(c.label)}
                    {" · "}
                    {c.maxRedemptions
                      ? t("promo_used_of")
                          .replace("{used}", String(c.used))
                          .replace("{max}", String(c.maxRedemptions))
                      : t("promo_used_count").replace("{used}", String(c.used))}
                    {(c.startsOn || c.endsOn) && (
                      <>
                        {" · "}
                        {c.startsOn ?? "…"} – {c.endsOn ?? "…"}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ mode: "edit", code: c })}
                    className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 font-body text-[13px] font-semibold text-ink"
                  >
                    {t("promo_edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    disabled={pending}
                    className="inline-flex h-9 items-center rounded-lg border border-line px-3 font-body text-[13px] font-semibold text-muted disabled:opacity-50"
                  >
                    {c.active ? t("promo_retire") : t("promo_restore")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PromoDrawer
        state={form}
        items={items}
        onClose={() => setForm(null)}
        onSaved={() => {
          setForm(null);
          flash("promo_saved");
          router.refresh();
        }}
      />
    </div>
  );
}

// ───────────────────────── create / edit ─────────────────────────

function PromoDrawer({
  state,
  items,
  onClose,
  onSaved,
}: {
  state: FormState | null;
  items: PromoItemOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tt } = useAdminLang();
  const [pending, startTransition] = useTransition();
  const existing = state?.code;
  const isEdit = state?.mode === "edit";

  const [code, setCode] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [labelTh, setLabelTh] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("20");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [maxTotal, setMaxTotal] = useState("0");
  const [maxPerCustomer, setMaxPerCustomer] = useState("1");
  const [appliesTo, setAppliesTo] = useState(""); // "" | cat:<c> | item:<id>
  const [firstOnly, setFirstOnly] = useState(false);
  const [active, setActive] = useState(true);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  // Re-seed whenever the drawer opens on a different code (or on "new").
  useEffect(() => {
    if (!state) return;
    setCode(existing?.code ?? "");
    setLabelEn(existing?.label.en ?? "");
    setLabelTh(existing?.label.th ?? "");
    setKind(existing?.kind ?? "percent");
    setValue(String(existing?.value ?? 20));
    setStartsOn(existing?.startsOn ?? "");
    setEndsOn(existing?.endsOn ?? "");
    setMaxTotal(String(existing?.maxRedemptions ?? 0));
    setMaxPerCustomer(String(existing?.maxPerCustomer ?? 1));
    setAppliesTo(
      existing?.appliesToItemId
        ? `item:${existing.appliesToItemId}`
        : existing?.appliesToCategory
          ? `cat:${existing.appliesToCategory}`
          : "",
    );
    setFirstOnly(existing?.firstPurchaseOnly ?? false);
    setActive(existing?.active ?? true);
    setErrorKey(null);
  }, [state, existing]);

  function save() {
    setErrorKey(null);
    if (!isValidPromoCodeShape(code)) {
      setErrorKey("err_promo_code_shape");
      return;
    }
    const numericValue = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(numericValue) || numericValue <= 0) {
      setErrorKey("err_promo_save");
      return;
    }
    if (kind === "percent" && numericValue > 100) {
      setErrorKey("err_promo_percent");
      return;
    }

    startTransition(async () => {
      try {
        const res = await savePromoCode({
          code: code.trim().toUpperCase(),
          labelEn: labelEn.trim(),
          labelTh: labelTh.trim(),
          kind,
          value: numericValue,
          startsOn,
          endsOn,
          maxRedemptions: Math.max(0, Number.parseInt(maxTotal, 10) || 0),
          maxPerCustomer: Math.max(1, Number.parseInt(maxPerCustomer, 10) || 1),
          appliesToCategory: appliesTo.startsWith("cat:")
            ? (appliesTo.slice(4) as PackageCategory)
            : null,
          appliesToItemId: appliesTo.startsWith("item:") ? appliesTo.slice(5) : null,
          firstPurchaseOnly: firstOnly,
          active,
        });
        if (res.ok) onSaved();
        else setErrorKey(saveErrorKey(res.code));
      } catch {
        setErrorKey("err_promo_save");
      }
    });
  }

  const footer = (
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
        onClick={save}
        disabled={pending || code.trim() === "" || labelEn.trim() === "" || labelTh.trim() === ""}
        className="inline-flex h-11 items-center rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        {t("save")}
      </button>
    </>
  );

  return (
    <Drawer
      open={state !== null}
      onClose={onClose}
      title={isEdit ? t("promo_edit") : t("promo_new")}
      footer={footer}
    >
      <div className="flex flex-col gap-3.5">
        {errorKey && (
          <div role="alert" className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] text-[#a56a52]">
            {t(errorKey)}
          </div>
        )}

        <PromoField label={t("promo_code_label")} hint={t("promo_code_hint")}>
          {(id) => (
            <input
              id={id}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              // The code is the primary key and is referenced by redemption rows —
              // editing it on an existing code would orphan that history.
              readOnly={isEdit}
              disabled={isEdit}
              maxLength={24}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="GRANDOPEN"
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm uppercase tracking-[0.06em] text-ink disabled:bg-cream-2 disabled:text-ink-soft"
            />
          )}
        </PromoField>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <PromoField label={t("promo_name_en")}>
            {(id) => (
              <input
                id={id}
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                maxLength={60}
                placeholder="Grand opening"
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink"
              />
            )}
          </PromoField>
          <PromoField label={t("promo_name_th")}>
            {(id) => (
              <input
                id={id}
                value={labelTh}
                onChange={(e) => setLabelTh(e.target.value)}
                maxLength={60}
                lang="th"
                placeholder="เปิดร้านใหญ่"
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink"
              />
            )}
          </PromoField>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <PromoField label={t("promo_kind")}>
            {(id) => (
              <select
                id={id}
                value={kind}
                onChange={(e) => setKind(e.target.value as "percent" | "fixed")}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm text-ink"
              >
                <option value="percent">{t("promo_kind_percent")}</option>
                <option value="fixed">{t("promo_kind_fixed")}</option>
              </select>
            )}
          </PromoField>
          <PromoField label={t("promo_value")}>
            {(id) => (
              <input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                max={kind === "percent" ? 100 : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink"
              />
            )}
          </PromoField>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <PromoField label={t("promo_starts")} hint={t("promo_window_hint")}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink"
              />
            )}
          </PromoField>
          <PromoField label={t("promo_ends")}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink"
              />
            )}
          </PromoField>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <PromoField label={t("promo_max_total")} hint={t("promo_max_total_hint")}>
            {(id) => (
              <input
                id={id}
                type="number"
                inputMode="numeric"
                min={0}
                value={maxTotal}
                onChange={(e) => setMaxTotal(e.target.value)}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink"
              />
            )}
          </PromoField>
          <PromoField label={t("promo_max_per_customer")}>
            {(id) => (
              <input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                value={maxPerCustomer}
                onChange={(e) => setMaxPerCustomer(e.target.value)}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink"
              />
            )}
          </PromoField>
        </div>

        <PromoField label={t("promo_applies_to")}>
          {(id) => (
            <select
              id={id}
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm text-ink"
            >
              <option value="">{t("promo_applies_all")}</option>
              {(["group", "private", "duo", "trio", "rental"] as const).map((c) => (
                <option key={c} value={`cat:${c}`}>
                  {t(CATEGORY_KEY[c])}
                </option>
              ))}
              {items.map((i) => (
                <option key={i.id} value={`item:${i.id}`}>
                  {tt(i.label)}
                </option>
              ))}
            </select>
          )}
        </PromoField>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-strong bg-surface px-3.5 py-3">
          <input
            type="checkbox"
            checked={firstOnly}
            onChange={(e) => setFirstOnly(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#8C7A63]"
          />
          <span className="font-body text-sm text-ink">{t("promo_first_only")}</span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-strong bg-surface px-3.5 py-3">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#8C7A63]"
          />
          <span className="font-body text-sm text-ink">{t("promo_active")}</span>
        </label>
      </div>
    </Drawer>
  );
}

function PromoField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-body text-[12px] font-semibold uppercase tracking-[0.07em] text-muted"
      >
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 font-body text-[11.5px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}
