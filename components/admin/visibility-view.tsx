"use client";

// Admin "Booking windows" — the owner's editor for the tiered-visibility lead time
// per class type (CLAUDE.md §5 invariant 4). Mirrors packages-view.tsx's
// conventions closely: the shared Drawer, the same Field/Select shape, useTransition
// + router.refresh() after every write, a transient keyed toast, and a
// failure-code → StrKey mapper so no server error is ever swallowed.
//
// There are always exactly 5 rows (one per ClassType), by construction of the
// backend's per-type seed fallback — there is no create/delete here, only edit.
// `type` is the row's fixed identity, never a form field.
//
// This view never computes the effective lead-HOURS that gate a class — that
// derivation (leadHoursFor) is server-side (lib/schedule/visibilityWindows.ts) and
// only ever applied to classes created/generated AFTER a save (CLAUDE.md §8: no
// client-side business logic). The amount+unit shown here is exactly what round-
// trips from the server on every read.

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Drawer } from "./ui";
import {
  updateVisibilityWindow,
  type UpdateVisibilityWindowFailureCode,
} from "@/app/actions/admin-visibility";
import type { VisibilityUnit, VisibilityWindow } from "@/lib/schedule/visibilityWindows";
import { VISIBILITY_UNITS } from "@/lib/schedule/visibilityWindows";
import type { ClassType } from "@/lib/domain/types";
import type { StrKey } from "@/lib/i18n";

// ───────────────────────── constants ─────────────────────────

/** Stable display order, matching the backend's TYPE_ORDER / CAPACITY ordering. */
const TYPE_ORDER: readonly ClassType[] = ["group", "private", "duo", "trio", "rental"] as const;

const TYPE_LABEL_KEY: Record<ClassType, StrKey> = {
  group: "type_group",
  private: "type_private",
  duo: "type_duo",
  trio: "type_trio",
  rental: "type_rental",
};

const UNIT_KEY: Record<VisibilityUnit, StrKey> = {
  day: "validity_unit_day",
  week: "validity_unit_week",
  month: "validity_unit_month",
};

/** Flat hour ratios — display-only, mirrors leadHoursFor's day/week/month ratios so
 * the "guest ≥ member" hint compares like-for-like without importing server code. */
const UNIT_HOURS: Record<VisibilityUnit, number> = { day: 24, week: 168, month: 720 };

function leadHours(amount: number, unit: VisibilityUnit): number {
  return amount * UNIT_HOURS[unit];
}

// ───────────────────────── error mapping ─────────────────────────

function updateErrorKey(code: UpdateVisibilityWindowFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_vis_forbidden";
    case "INVALID_INPUT":
      return "err_vis_numbers";
    case "MOCK_NO_DB":
      return "err_vis_mock_no_db";
    default:
      return "err_vis_save";
  }
}

// ───────────────────────── screen ─────────────────────────

export function VisibilityView({ windows }: { windows: VisibilityWindow[] }) {
  const { t } = useAdminLang();
  const router = useRouter();
  const [editing, setEditing] = useState<VisibilityWindow | null>(null);
  const [toast, setToast] = useState<StrKey | null>(null);

  const byType = new Map(windows.map((w) => [w.type, w]));

  function flash(key: StrKey) {
    setToast(key);
    window.setTimeout(() => setToast(null), 3200);
  }

  return (
    <div>
      <div className="mb-5 max-w-2xl">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("vis_title")}
        </h1>
        <p className="mt-1 font-body text-[13.5px] leading-relaxed text-muted">
          {t("vis_subtitle")}
        </p>
      </div>

      {toast && (
        <div
          role="status"
          className="mb-4 rounded-xl bg-sage/15 px-4 py-2.5 font-body text-[13px] font-semibold text-sage-deep"
        >
          {t(toast)}
        </div>
      )}

      <ul className="flex flex-col gap-2.5">
        {TYPE_ORDER.map((type) => {
          const w = byType.get(type);
          if (!w) return null;
          return <WindowRow key={type} window={w} onEdit={() => setEditing(w)} />;
        })}
      </ul>

      <p className="mt-4 max-w-2xl font-body text-[12px] leading-relaxed text-muted">
        {t("vis_no_retro_note")}
      </p>

      <EditDrawer
        window={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          flash("vis_saved_toast");
          router.refresh();
        }}
      />
    </div>
  );
}

// ───────────────────────── one class-type row ─────────────────────────

function windowText(t: (k: StrKey) => string, amount: number, unit: VisibilityUnit): string {
  return `${amount} ${t(UNIT_KEY[unit])}`;
}

function WindowRow({ window: w, onEdit }: { window: VisibilityWindow; onEdit: () => void }) {
  const { t } = useAdminLang();
  return (
    <li className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${t("vis_edit")} — ${t(TYPE_LABEL_KEY[w.type])}`}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-cream-2"
      >
        <span className="min-w-0 font-body text-[14px] font-semibold text-ink">
          {t(TYPE_LABEL_KEY[w.type])}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 font-body text-[12.5px] text-muted sm:flex-row sm:items-center sm:gap-3">
          <span className="whitespace-nowrap">
            <span className="text-ink-soft">{t("vis_member_lead")}</span>{" "}
            <span className="font-semibold text-ink tabular-nums">
              {windowText(t, w.memberAmount, w.memberUnit)}
            </span>
          </span>
          <span className="whitespace-nowrap">
            <span className="text-ink-soft">{t("vis_guest_lead")}</span>{" "}
            <span className="font-semibold text-ink tabular-nums">
              {windowText(t, w.guestAmount, w.guestUnit)}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

// ───────────────────────── edit drawer ─────────────────────────

function EditDrawer({
  window: w,
  onClose,
  onSaved,
}: {
  window: VisibilityWindow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useAdminLang();
  const [pending, startTransition] = useTransition();

  const [memberAmount, setMemberAmount] = useState("1");
  const [memberUnit, setMemberUnit] = useState<VisibilityUnit>("month");
  const [guestAmount, setGuestAmount] = useState("1");
  const [guestUnit, setGuestUnit] = useState<VisibilityUnit>("day");
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  // Prefill on (re)open.
  useEffect(() => {
    if (!w) return;
    setMemberAmount(String(w.memberAmount));
    setMemberUnit(w.memberUnit);
    setGuestAmount(String(w.guestAmount));
    setGuestUnit(w.guestUnit);
    setErrorKey(null);
  }, [w]);

  const memberAmountNum = Number.parseInt(memberAmount, 10);
  const guestAmountNum = Number.parseInt(guestAmount, 10);
  const numbersOk =
    Number.isSafeInteger(memberAmountNum) &&
    memberAmountNum > 0 &&
    memberAmountNum <= 365 &&
    Number.isSafeInteger(guestAmountNum) &&
    guestAmountNum > 0 &&
    guestAmountNum <= 365;

  // Gentle, non-blocking hint: members normally get the LONGER (earlier) window.
  const guestAheadOfMember =
    numbersOk && leadHours(guestAmountNum, guestUnit) >= leadHours(memberAmountNum, memberUnit);

  function save() {
    if (!w) return;
    setErrorKey(null);
    if (!numbersOk) {
      setErrorKey("err_vis_numbers");
      return;
    }
    startTransition(async () => {
      const res = await updateVisibilityWindow({
        type: w.type,
        memberAmount: memberAmountNum,
        memberUnit,
        guestAmount: guestAmountNum,
        guestUnit,
      });
      if (res.ok) {
        onSaved();
      } else {
        setErrorKey(updateErrorKey(res.code));
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
        disabled={pending}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        {t("vis_save")}
      </button>
    </>
  );

  return (
    <Drawer
      open={w !== null}
      onClose={onClose}
      title={w ? `${t("vis_edit")} — ${t(TYPE_LABEL_KEY[w.type])}` : t("vis_edit")}
      footer={footer}
    >
      {errorKey && (
        <div
          role="alert"
          className="mb-4 rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]"
        >
          {t(errorKey)}
        </div>
      )}

      <AmountUnitField
        label={t("vis_member_lead")}
        amount={memberAmount}
        onAmount={setMemberAmount}
        unit={memberUnit}
        onUnit={setMemberUnit}
      />
      <AmountUnitField
        label={t("vis_guest_lead")}
        amount={guestAmount}
        onAmount={setGuestAmount}
        unit={guestUnit}
        onUnit={setGuestUnit}
      />

      {guestAheadOfMember && (
        <p
          role="status"
          className="mb-4 rounded-xl bg-[rgba(193,160,121,0.18)] px-3.5 py-2.5 font-body text-[12.5px] leading-relaxed text-[#9a7b45]"
        >
          {t("vis_guest_ge_member_hint")}
        </p>
      )}
    </Drawer>
  );
}

/** Amount input + unit select, both scoped under one accessible label group. The
 * amount input gets the real `<label htmlFor>`; the unit select carries its own
 * `aria-label` (mirrors packages-view.tsx's validity amount+unit pair). */
function AmountUnitField({
  label,
  amount,
  onAmount,
  unit,
  onUnit,
}: {
  label: string;
  amount: string;
  onAmount: (v: string) => void;
  unit: VisibilityUnit;
  onUnit: (v: VisibilityUnit) => void;
}) {
  const { t } = useAdminLang();
  const amountId = useId();
  return (
    <div className="mb-4">
      <label
        htmlFor={amountId}
        className="mb-2 block font-body text-xs font-semibold tracking-wide text-ink-soft"
      >
        {label}
      </label>
      <div className="grid grid-cols-[1fr_1.3fr] gap-3.5">
        <input
          id={amountId}
          type="number"
          min={1}
          max={365}
          step={1}
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          inputMode="numeric"
          aria-label={`${label} — ${t("vis_amount")}`}
          className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm font-medium text-ink tabular-nums"
        />
        <select
          value={unit}
          onChange={(e) => onUnit(e.target.value as VisibilityUnit)}
          aria-label={`${label} — ${t("vis_unit")}`}
          className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm font-medium text-ink"
        >
          {VISIBILITY_UNITS.map((u) => (
            <option key={u} value={u}>
              {t(UNIT_KEY[u])}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1.5 font-body text-[11.5px] leading-relaxed text-muted">
        {t("vis_before_start")}
      </p>
    </div>
  );
}
