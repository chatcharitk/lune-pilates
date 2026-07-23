"use client";

// Admin "Packages" — the owner's editor for the purchasable catalog. Mirrors the
// template-editor / instructors-view conventions exactly: the shared Drawer for the
// add/edit form, the same Field/Select primitives, useTransition + router.refresh()
// after every write, a transient keyed toast, and a failure-code → StrKey mapper so
// no server error is ever swallowed.
//
// Items are grouped by credit type (group / private / rental) and ordered by
// sortOrder. `rental` is currently hidden from the CUSTOMER buy screen
// (HIDDEN_CATEGORIES in lib/catalog/packages.ts) but is still fully manageable
// here — hiding it from the owner would strand the rental items.
//
// This view NEVER computes money that matters: `perHour` on a row is the server's
// derived value, and the live per-hour readout in the form is a typing AID only —
// the authoritative value comes back from the action's echoed item on save
// (CLAUDE.md §8). It imports only the action module + erased contract types.
//
// Two fields are IMMUTABLE after creation and the form says so rather than letting
// the owner discover it on save: `id` (it is `packages.type` / `charges.package_id`
// on every historical row) and `category` (it decides which credit bucket a booking
// debits). On edit both render read-only with their `cat_*_hint` copy; the server is
// still the enforcer (CATEGORY_IMMUTABLE is mapped and shown).
//
// Retiring an item ARCHIVES it — never deletes. The confirm copy says past purchases
// keep working, and archiving the literal id "drop" additionally surfaces
// `cat_promo_warning` because the 1+1 free-trial promo keys off that exact id.

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Badge, Drawer } from "./ui";
import {
  archiveCatalogItem,
  createCatalogItem,
  deleteCatalogItem,
  reorderCatalog,
  restoreCatalogItem,
  updateCatalogItem,
  type CreateCatalogItemFailureCode,
  type UpdateCatalogItemFailureCode,
  type ArchiveCatalogItemFailureCode,
  type DeleteCatalogItemFailureCode,
  type ReorderCatalogFailureCode,
} from "@/app/actions/admin-catalog";
import type { AdminCatalogItem, CatalogTag, ValidityUnit } from "@/lib/catalog/packages";
import { VALIDITY_UNITS } from "@/lib/catalog/packages";
import type { PackageCategory } from "@/lib/domain/types";
import { thb, type StrKey } from "@/lib/i18n";

// ───────────────────────── constants ─────────────────────────

/** Display order of the credit types. Rental is hidden from /buy, never from here. */
const CATEGORIES: readonly PackageCategory[] = ["group", "private", "rental"] as const;

/** Section heading key per category (reuses the existing cat_group/private/rental). */
const CATEGORY_KEY: Record<PackageCategory, StrKey> = {
  group: "cat_group",
  private: "cat_private",
  rental: "cat_rental",
};

/** Validity unit → its i18n label key (structured validity, 2026-07-23). */
const VALIDITY_UNIT_KEY: Record<ValidityUnit, StrKey> = {
  day: "validity_unit_day",
  month: "validity_unit_month",
};

const TAG_KEY: Record<CatalogTag, StrKey> = {
  popular: "cat_tag_popular",
  best_value: "cat_tag_best_value",
};

/**
 * The catalog id the 1+1 free-trial promo is keyed to (PROMO_ITEM_ID in
 * lib/credits/creditPackage.ts). Archiving or re-slugging it disables the promo, so
 * the UI warns before either. Duplicated as a literal deliberately: importing the
 * server module into a client component would drag the whole credit engine along.
 */
const PROMO_ITEM_ID = "drop";

/** Same slug shape the server enforces (SLUG_RE in app/actions/admin-catalog.ts). */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ───────────────────────── error mapping ─────────────────────────

// MOCK_NO_DB is mapped in every one of these: in demo mode (no DATABASE_URL) the write
// validates but has nothing to persist to, so the owner must be told "not saved" rather
// than shown a success toast over an unchanged list.

function createErrorKey(code: CreateCatalogItemFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_cat_forbidden";
    case "DUPLICATE_ID":
      return "err_cat_id_taken";
    case "MOCK_NO_DB":
      return "err_cat_mock_no_db";
    default:
      return "err_cat_save";
  }
}

function updateErrorKey(code: UpdateCatalogItemFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_cat_forbidden";
    case "UNKNOWN_ITEM":
      return "err_cat_unknown";
    case "CATEGORY_IMMUTABLE":
      return "err_cat_category_immutable";
    case "MOCK_NO_DB":
      return "err_cat_mock_no_db";
    default:
      return "err_cat_save";
  }
}

function archiveErrorKey(code: ArchiveCatalogItemFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_cat_forbidden";
    case "UNKNOWN_ITEM":
      return "err_cat_unknown";
    case "MOCK_NO_DB":
      return "err_cat_mock_no_db";
    default:
      return "err_cat_save";
  }
}

function deleteErrorKey(code: DeleteCatalogItemFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_cat_forbidden";
    case "UNKNOWN_ITEM":
      return "err_cat_unknown";
    case "MOCK_NO_DB":
      return "err_cat_mock_no_db";
    default:
      return "err_cat_save";
  }
}

function reorderErrorKey(code: ReorderCatalogFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_cat_forbidden";
    case "MOCK_NO_DB":
      return "err_cat_mock_no_db";
    default:
      return "err_cat_save";
  }
}

// ───────────────────────── screen ─────────────────────────

interface FormState {
  mode: "new" | "edit";
  item?: AdminCatalogItem;
}

export function PackagesView({ items }: { items: AdminCatalogItem[] }) {
  const { t } = useAdminLang();
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [archiving, setArchiving] = useState<AdminCatalogItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [toast, setToast] = useState<StrKey | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  const [pending, startTransition] = useTransition();

  // Local mirror of the server list so a reorder / restore can move optimistically;
  // re-seeded whenever the server component sends a fresh list.
  const [order, setOrder] = useState<AdminCatalogItem[]>(items);
  useEffect(() => setOrder(items), [items]);

  function flash(key: StrKey) {
    setErrorKey(null);
    setToast(key);
    window.setTimeout(() => setToast(null), 3200);
  }

  function restore(item: AdminCatalogItem) {
    setErrorKey(null);
    startTransition(async () => {
      const res = await restoreCatalogItem(item.id);
      if (res.ok) {
        flash("toast_cat_restored");
        router.refresh();
      } else {
        setErrorKey(archiveErrorKey(res.code));
      }
    });
  }

  /** Move an ACTIVE item one slot within its category; archived keep their tail order. */
  function move(item: AdminCatalogItem, delta: -1 | 1) {
    const inCat = order
      .filter((i) => i.category === item.category)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const active = inCat.filter((i) => i.active);
    const archived = inCat.filter((i) => !i.active);
    const from = active.findIndex((i) => i.id === item.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= active.length) return;
    const next = [...active];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);

    const ids = [...next, ...archived].map((i) => i.id);
    // Optimistic: restamp sortOrder locally the same way the server will (index × 10).
    const rank = new Map(ids.map((id, index) => [id, index * 10]));
    const before = order;
    setOrder((prev) =>
      prev.map((i) => (rank.has(i.id) ? { ...i, sortOrder: rank.get(i.id)! } : i)),
    );
    setErrorKey(null);
    startTransition(async () => {
      const res = await reorderCatalog({ ids });
      if (res.ok) {
        router.refresh();
      } else {
        setOrder(before); // revert — the server rejected (or, in demo mode, never stored) it
        setErrorKey(reorderErrorKey(res.code));
      }
    });
  }

  const archivedCount = order.filter((i) => !i.active).length;

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
            {t("cat_title")}
          </h1>
          <p className="mt-1 font-body text-[13.5px] text-muted">{t("cat_subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ mode: "new" })}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 font-body text-[13.5px] font-semibold text-cream"
        >
          <PlusSmall />
          {t("cat_add")}
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
        <div
          role="alert"
          className="mb-4 rounded-xl bg-rose/15 px-4 py-2.5 font-body text-[13px] font-medium text-[#a56a52]"
        >
          {t(errorKey)}
        </div>
      )}

      {/* archived toggle */}
      {archivedCount > 0 && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 font-body text-[12.5px] font-semibold transition-colors ${
              showArchived
                ? "border-taupe bg-surface text-ink"
                : "border-line-strong text-ink-soft hover:bg-cream-2"
            }`}
          >
            {t("cat_show_archived")}
            <span className="tabular-nums">({archivedCount})</span>
          </button>
        </div>
      )}

      {/* one section per credit type */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start 2xl:grid-cols-3">
        {CATEGORIES.map((category) => {
          const inCat = order
            .filter((i) => i.category === category)
            .sort((a, b) => a.sortOrder - b.sortOrder);
          const active = inCat.filter((i) => i.active);
          const archived = inCat.filter((i) => !i.active);
          return (
            <section
              key={category}
              aria-labelledby={`cat-${category}`}
              className="rounded-2xl border border-line bg-surface-2 px-3.5 py-3.5"
            >
              <h2
                id={`cat-${category}`}
                className="mb-2.5 font-head text-[15px] font-semibold text-ink"
              >
                {t(CATEGORY_KEY[category])}
              </h2>

              {active.length === 0 ? (
                <p className="rounded-xl bg-cream-2 px-3 py-3 text-center font-body text-[12.5px] text-muted">
                  {t("cat_empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {active.map((item, index) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onEdit={() => setForm({ mode: "edit", item })}
                      onArchive={() => setArchiving(item)}
                      onMoveUp={index > 0 ? () => move(item, -1) : undefined}
                      onMoveDown={index < active.length - 1 ? () => move(item, 1) : undefined}
                      busy={pending}
                    />
                  ))}
                </ul>
              )}

              {showArchived && archived.length > 0 && (
                <div className="mt-3 border-t border-dashed border-line-strong pt-3">
                  <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">
                    {t("cat_archived")}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {archived.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        onEdit={() => setForm({ mode: "edit", item })}
                        onRestore={() => restore(item)}
                        busy={pending}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* add / edit form */}
      <ItemFormDrawer
        state={form}
        onClose={() => setForm(null)}
        onSaved={(key) => {
          setForm(null);
          flash(key);
        }}
      />

      {/* archive confirmation */}
      <ArchiveDrawer
        item={archiving}
        onClose={() => setArchiving(null)}
        onArchived={() => {
          setArchiving(null);
          flash("toast_cat_archived");
        }}
      />
    </div>
  );
}

// ───────────────────────── one catalog row ─────────────────────────

function ItemRow({
  item,
  onEdit,
  onArchive,
  onRestore,
  onMoveUp,
  onMoveDown,
  busy,
}: {
  item: AdminCatalogItem;
  onEdit: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  busy: boolean;
}) {
  const { t, tt, lang } = useAdminLang();
  // The catalog is bilingual content the owner authors, so show BOTH names: the
  // active language large, the other underneath, so a missing/odd translation is
  // visible without switching languages.
  const other = lang === "th" ? item.label.en : item.label.th;

  return (
    <li
      className={`rounded-xl border bg-surface ${
        item.active ? "border-line" : "border-dashed border-line-strong opacity-70"
      }`}
    >
      <div className="flex items-stretch gap-1 px-1 py-1">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${t("cat_edit")} — ${tt(item.label)}`}
          className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-cream-2"
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate font-body text-[13.5px] font-semibold text-ink">
              {tt(item.label)}
            </span>
            {item.tag && <Badge tone="green">{t(TAG_KEY[item.tag])}</Badge>}
            {!item.active && <Badge tone="rose">{t("cat_archived")}</Badge>}
          </span>
          <span className="mt-0.5 block truncate font-body text-[11.5px] text-muted">{other}</span>
          {/* Price on its own line so the longer Thai meta below never wraps into it. */}
          <span className="mt-1 block font-head text-[15px] font-bold leading-none text-ink tabular-nums">
            {thb(item.price)}
          </span>
          <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-body text-[11.5px] text-muted tabular-nums">
            <span>
              {item.hours} {t("hrs")}
            </span>
            <span aria-hidden>·</span>
            <span>
              {thb(item.perHour)}/{t("hour")}
            </span>
            <span aria-hidden>·</span>
            <span>{tt(item.sublabel)}</span>
          </span>
        </button>

        <div className="flex shrink-0 flex-col items-center justify-center gap-1 sm:flex-row">
          {(onMoveUp || onMoveDown) && (
            <div className="flex items-center">
              <IconButton
                label={`${t("cat_move_up")} — ${tt(item.label)}`}
                onClick={onMoveUp}
                disabled={!onMoveUp || busy}
              >
                <ChevronUp />
              </IconButton>
              <IconButton
                label={`${t("cat_move_down")} — ${tt(item.label)}`}
                onClick={onMoveDown}
                disabled={!onMoveDown || busy}
              >
                <ChevronDown />
              </IconButton>
            </div>
          )}
          {onArchive && (
            <button
              type="button"
              onClick={onArchive}
              disabled={busy}
              aria-label={`${t("cat_archive")} — ${tt(item.label)}`}
              className="h-8 whitespace-nowrap rounded-lg border border-line px-2.5 font-body text-[12px] font-semibold text-ink-soft transition-colors hover:bg-cream-2 disabled:opacity-50"
            >
              {t("cat_archive")}
            </button>
          )}
          {onRestore && (
            <button
              type="button"
              onClick={onRestore}
              disabled={busy}
              aria-label={`${t("cat_restore")} — ${tt(item.label)}`}
              className="h-8 whitespace-nowrap rounded-lg border border-line px-2.5 font-body text-[12px] font-semibold text-sage-deep transition-colors hover:bg-sage/10 disabled:opacity-50"
            >
              {t("cat_restore")}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ───────────────────────── add / edit form ─────────────────────────

function ItemFormDrawer({
  state,
  onClose,
  onSaved,
}: {
  state: FormState | null;
  onClose: () => void;
  onSaved: (toastKey: StrKey) => void;
}) {
  const { t } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isEdit = state?.mode === "edit";
  const item = state?.item;

  const [id, setId] = useState("");
  const [category, setCategory] = useState<PackageCategory>("group");
  const [hours, setHours] = useState("1");
  const [price, setPrice] = useState("0");
  // Structured validity (2026-07-23): a whole amount + a day/month unit.
  const [validityAmount, setValidityAmount] = useState("1");
  const [validityUnit, setValidityUnit] = useState<ValidityUnit>("month");
  const [tag, setTag] = useState<CatalogTag | "none">("none");
  const [labelEn, setLabelEn] = useState("");
  const [labelTh, setLabelTh] = useState("");
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  // Inline "delete for good?" confirmation within the edit drawer (destructive).
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Prefill from the target item (edit) or reset to sane defaults (new) on (re)open.
  useEffect(() => {
    if (!state) return;
    setId(item?.id ?? "");
    setCategory(item?.category ?? "group");
    setHours(String(item?.hours ?? 1));
    setPrice(String(item?.price ?? 0));
    setValidityAmount(String(item?.validity.amount ?? 1));
    setValidityUnit(item?.validity.unit ?? "month");
    setTag(item?.tag ?? "none");
    setLabelEn(item?.label.en ?? "");
    setLabelTh(item?.label.th ?? "");
    setErrorKey(null);
    setConfirmingDelete(false);
  }, [state, item]);

  const hoursNum = Number.parseInt(hours, 10);
  const priceNum = Number.parseInt(price, 10);
  const validityAmountNum = Number.parseInt(validityAmount, 10);
  const numbersOk =
    Number.isSafeInteger(hoursNum) &&
    hoursNum > 0 &&
    Number.isSafeInteger(priceNum) &&
    priceNum >= 0 &&
    Number.isSafeInteger(validityAmountNum) &&
    validityAmountNum > 0 &&
    validityAmountNum <= 60;
  // Typing aid only — the authoritative perHour is derived server-side on read.
  const perHour = numbersOk ? Math.round(priceNum / hoursNum) : null;

  function save() {
    setErrorKey(null);
    const slug = id.trim().toLowerCase();
    if (!isEdit && !SLUG_RE.test(slug)) {
      setErrorKey("err_cat_id_invalid");
      return;
    }
    // Both languages are required — the owner's explicit call (CLAUDE.md §6: no
    // half-translated customer-facing copy). The server enforces it too.
    if (labelEn.trim() === "" || labelTh.trim() === "") {
      setErrorKey("err_cat_labels_required");
      return;
    }
    if (!numbersOk) {
      setErrorKey("err_cat_numbers");
      return;
    }

    const common = {
      hours: hoursNum,
      price: priceNum,
      validityAmount: validityAmountNum,
      validityUnit,
      tag: tag === "none" ? null : tag,
      labelEn: labelEn.trim(),
      labelTh: labelTh.trim(),
    };

    startTransition(async () => {
      if (isEdit && item) {
        // `category` is round-tripped unchanged; a mismatch would come back as
        // CATEGORY_IMMUTABLE, which is mapped and shown rather than swallowed.
        const res = await updateCatalogItem({ id: item.id, category: item.category, ...common });
        if (res.ok) {
          onSaved("toast_cat_updated");
          router.refresh();
        } else {
          setErrorKey(updateErrorKey(res.code));
        }
        return;
      }
      const res = await createCatalogItem({ id: slug, category, ...common });
      if (res.ok) {
        onSaved("toast_cat_created");
        router.refresh();
      } else {
        setErrorKey(createErrorKey(res.code));
      }
    });
  }

  /**
   * Delete the edited item. The server hard-deletes it only when it was NEVER sold;
   * if any charge/credit references it, it ARCHIVES instead and reports `archived`.
   * The toast reflects which outcome happened so the owner isn't misled.
   */
  function del() {
    if (!item) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await deleteCatalogItem(item.id);
      if (res.ok) {
        onSaved(res.deleted ? "toast_cat_deleted" : "toast_cat_archived_instead");
        router.refresh();
      } else {
        setConfirmingDelete(false);
        setErrorKey(deleteErrorKey(res.code));
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
        <Check />
        {t("save")}
      </button>
    </>
  );

  return (
    <Drawer
      open={state !== null}
      onClose={onClose}
      title={t(isEdit ? "cat_edit" : "cat_add")}
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

      {/* Archiving or re-slugging the promo item silently turns the 1+1 offer off. */}
      {isEdit && item?.id === PROMO_ITEM_ID && (
        <p className="mb-4 rounded-xl bg-[rgba(193,160,121,0.18)] px-3.5 py-2.5 font-body text-[12.5px] leading-relaxed text-[#9a7b45]">
          {t("cat_promo_warning")}
        </p>
      )}

      {/* id — create only; permanent thereafter */}
      <Field label={t("cat_id")} hint={t("cat_id_hint")}>
        {(fieldId) => (
          <input
            id={fieldId}
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            readOnly={isEdit}
            disabled={isEdit}
            placeholder={t("ph_cat_id")}
            maxLength={40}
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm text-ink placeholder:text-muted disabled:bg-cream-2 disabled:text-ink-soft"
          />
        )}
      </Field>

      {/* category — create only; decides the credit bucket, immutable thereafter */}
      <Field label={t("cat_category")} hint={t("cat_category_hint")}>
        {(fieldId) =>
          isEdit ? (
            <p
              id={fieldId}
              className="flex h-11 items-center rounded-xl border border-line-strong bg-cream-2 px-3.5 font-body text-sm font-semibold text-ink-soft"
            >
              {t(CATEGORY_KEY[category])}
            </p>
          ) : (
            <Select
              id={fieldId}
              value={category}
              onChange={(v) => setCategory(v as PackageCategory)}
              options={CATEGORIES.map((c) => ({ value: c, label: t(CATEGORY_KEY[c]) }))}
            />
          )
        }
      </Field>

      <div className="grid grid-cols-2 gap-3.5">
        <Field label={t("cat_hours")}>
          {(fieldId) => (
            <input
              id={fieldId}
              type="number"
              min={1}
              step={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              inputMode="numeric"
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm font-medium text-ink tabular-nums"
            />
          )}
        </Field>
        <Field label={t("cat_price")}>
          {(fieldId) => (
            <input
              id={fieldId}
              type="number"
              min={0}
              step={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm font-medium text-ink tabular-nums"
            />
          )}
        </Field>
      </div>

      {/* live per-hour rate — the number the owner actually prices against */}
      <div
        aria-live="polite"
        className="mb-4 flex items-baseline justify-between rounded-xl bg-cream-2 px-3.5 py-2.5"
      >
        <span className="font-body text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">
          {t("cat_per_hour")}
        </span>
        <span className="font-head text-lg font-bold text-ink tabular-nums">
          {perHour === null ? "—" : thb(perHour)}
        </span>
      </div>

      {/* validity — a whole amount + a day/month unit (structured, 2026-07-23) */}
      <Field label={t("cat_validity")}>
        {(fieldId) => (
          <div className="grid grid-cols-[1fr_1.3fr] gap-3.5">
            <input
              id={fieldId}
              type="number"
              min={1}
              max={60}
              step={1}
              value={validityAmount}
              onChange={(e) => setValidityAmount(e.target.value)}
              inputMode="numeric"
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm font-medium text-ink tabular-nums"
            />
            <select
              aria-label={t("cat_validity")}
              value={validityUnit}
              onChange={(e) => setValidityUnit(e.target.value as ValidityUnit)}
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm font-medium text-ink"
            >
              {VALIDITY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(VALIDITY_UNIT_KEY[u])}
                </option>
              ))}
            </select>
          </div>
        )}
      </Field>

      <Field label={t("cat_tag")}>
        {(fieldId) => (
          <Select
            id={fieldId}
            value={tag}
            onChange={(v) => setTag(v as CatalogTag | "none")}
            options={[
              { value: "none", label: t("cat_tag_none") },
              { value: "popular", label: t("cat_tag_popular") },
              { value: "best_value", label: t("cat_tag_best_value") },
            ]}
          />
        )}
      </Field>

      <Field label={t("cat_label_en")}>
        {(fieldId) => (
          <input
            id={fieldId}
            type="text"
            value={labelEn}
            onChange={(e) => setLabelEn(e.target.value)}
            placeholder={t("ph_cat_label_en")}
            maxLength={60}
            required
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm text-ink placeholder:text-muted"
          />
        )}
      </Field>

      <Field label={t("cat_label_th")}>
        {(fieldId) => (
          <input
            id={fieldId}
            type="text"
            value={labelTh}
            onChange={(e) => setLabelTh(e.target.value)}
            placeholder={t("ph_cat_label_th")}
            maxLength={60}
            required
            lang="th"
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm text-ink placeholder:text-muted"
          />
        )}
      </Field>

      {/* Delete — a DIFFERENT affordance from Archive. Delete removes the package
          entirely when it was never sold; if it has past purchases the server
          archives it instead (and the toast says so). Guarded by an inline confirm. */}
      {isEdit && item && (
        <div className="mt-2 border-t border-dashed border-line-strong pt-4">
          {confirmingDelete ? (
            <div className="rounded-xl border border-[#e2b7a6] bg-rose/10 px-3.5 py-3">
              <p className="m-0 font-body text-[13px] leading-relaxed text-ink">
                {t("cat_delete_confirm")}
              </p>
              <div className="mt-3 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={del}
                  disabled={pending}
                  className="inline-flex h-10 items-center rounded-xl bg-[#a56a52] px-4 font-body text-[13.5px] font-semibold text-cream disabled:opacity-50"
                >
                  {t("cat_delete")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={pending}
                  className="inline-flex h-10 items-center rounded-xl border border-line-strong px-4 font-body text-[13.5px] font-semibold text-ink disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#e2b7a6] px-4 font-body text-[13.5px] font-semibold text-[#a56a52] transition-colors hover:bg-rose/10"
            >
              <TrashIcon />
              {t("cat_delete")}
            </button>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ───────────────────────── archive confirmation ─────────────────────────

function ArchiveDrawer({
  item,
  onClose,
  onArchived,
}: {
  item: AdminCatalogItem | null;
  onClose: () => void;
  onArchived: () => void;
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  useEffect(() => {
    if (item) setErrorKey(null);
  }, [item]);

  function confirm() {
    if (!item) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await archiveCatalogItem(item.id);
      if (res.ok) {
        onArchived();
        router.refresh();
      } else {
        setErrorKey(archiveErrorKey(res.code));
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
        onClick={confirm}
        disabled={pending}
        className="inline-flex h-11 items-center rounded-xl bg-[#a56a52] px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        {t("cat_archive")}
      </button>
    </>
  );

  return (
    <Drawer open={item !== null} onClose={onClose} title={t("cat_archive")} footer={footer}>
      {item && (
        <div className="flex flex-col gap-3.5">
          <p className="font-head text-lg font-semibold text-ink">{tt(item.label)}</p>
          {/* Archive is "stop selling", never a delete — say so before confirming. */}
          <p className="font-body text-[14px] leading-relaxed text-ink">
            {t("cat_archive_confirm")}
          </p>
          {item.id === PROMO_ITEM_ID && (
            <p className="rounded-xl bg-[rgba(193,160,121,0.18)] px-3.5 py-2.5 font-body text-[13px] leading-relaxed text-[#9a7b45]">
              {t("cat_promo_warning")}
            </p>
          )}
          {errorKey && (
            <p
              role="alert"
              className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]"
            >
              {t(errorKey)}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ───────────────────────── small presentational bits ─────────────────────────

/**
 * Label + control + optional hint. The control is passed as a render prop so the
 * generated `useId()` reaches the real `<input>`/`<select>`: the `<label>` carries
 * `htmlFor`, the control carries the matching `id`, and every field therefore
 * exposes a proper accessible name (a11y M1). Controls that render read-only text
 * still take the id so the label never dangles.
 */
function Field({
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
    <div className="mb-4">
      <label
        htmlFor={id}
        className="mb-2 block font-body text-xs font-semibold tracking-wide text-ink-soft"
      >
        {label}
      </label>
      {children(id)}
      {hint && (
        <p className="mt-1.5 font-body text-[11.5px] leading-relaxed text-muted">{hint}</p>
      )}
    </div>
  );
}

/** Always rendered inside a `<Field>`, which supplies the id and the real `<label>`. */
function Select({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm font-medium text-ink"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-cream-2 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function PlusSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronUp() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
