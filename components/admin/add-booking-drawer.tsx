"use client";

// "Book for a customer" flow on the admin Bookings screen. A 3-step drawer:
//   1) pick a customer (searchable; shows their usable credit balance)
//   2) pick an upcoming bookable class
//   3) pick a reformer position (optional; hidden for Private)
// then confirm → adminBookForCustomer, the SAME atomic debit the customer flow
// uses (server re-validates seats/credits/visibility; the client only requests).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Dot, Drawer } from "./ui";
import { adminBookForCustomer } from "@/app/actions/admin-bookings";
import type { AdminCustomer } from "@/lib/admin/members";
import type { BookableClass } from "@/lib/schedule/queries";
import type { ClassType, ReformerPosition } from "@/lib/domain/types";
import type { StrKey } from "@/lib/i18n";
import { formatStudioDate, formatStudioTime } from "@/lib/time";

// Display-only credit cost per type (server recomputes authoritatively).
const COST: Record<ClassType, number> = { group: 1, rental: 1, private: 2, duo: 2, trio: 2 };
const POSITIONS: ReformerPosition[] = ["left", "middle", "right"];
const POS_KEY: Record<ReformerPosition, StrKey> = {
  left: "pos_left",
  middle: "pos_middle",
  right: "pos_right",
};
const ERR: Record<string, StrKey> = {
  NO_USABLE_PACKAGE: "err_no_package",
  NOT_BOOKABLE: "err_not_visible",
  NOT_VISIBLE: "err_not_visible",
  CLASS_FULL: "err_full",
  ALREADY_BOOKED: "err_already_booked",
  POSITION_TAKEN: "err_position_taken",
  INVALID_POSITION: "err_invalid_position",
  CLASS_NOT_FOUND: "err_not_found",
};

export function AddBookingDrawer({
  open,
  onClose,
  customers,
  bookable,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  customers: AdminCustomer[];
  bookable: BookableClass[];
  onBooked: () => void;
}) {
  const { t, tt, lang } = useAdminLang();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState<AdminCustomer | null>(null);
  const [cls, setCls] = useState<BookableClass | null>(null);
  const [position, setPosition] = useState<ReformerPosition | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const list = customers.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (digits.length > 0 && c.phone.replace(/\D/g, "").includes(digits))
      );
    });
    return list.slice(0, 40);
  }, [customers, query]);

  const upcoming = useMemo(
    () => bookable.filter((c) => !c.full).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [bookable],
  );

  const cost = cls ? COST[cls.type] : 0;
  const showPositions = cls ? cls.type !== "private" : false;
  const balanceAfter = customer ? customer.balance - cost : 0;
  const insufficient = Boolean(customer && cls && customer.balance < cost);

  function reset() {
    setQuery("");
    setCustomer(null);
    setCls(null);
    setPosition(null);
    setErrorKey(null);
  }
  function close() {
    reset();
    onClose();
  }

  function book() {
    if (!customer || !cls) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await adminBookForCustomer({
        classInstanceId: cls.id,
        userId: customer.id,
        ...(position ? { position } : {}),
      });
      if (res.ok) {
        reset();
        onBooked();
        router.refresh();
      } else {
        setErrorKey(ERR[res.code] ?? "err_generic");
      }
    });
  }

  function classLabel(c: BookableClass): string {
    const d = new Date(c.startsAt);
    return `${formatStudioDate(d, lang, { weekday: "short", day: "numeric", month: "short" })} · ${formatStudioTime(d)}`;
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title={t("book_for_customer")}
      footer={
        customer && cls ? (
          <>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 font-body text-sm font-semibold text-ink"
            >
              {t("cancel")}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={book}
              disabled={pending || insufficient}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
            >
              {t("book_now")}
            </button>
          </>
        ) : undefined
      }
    >
      {errorKey && (
        <div className="mb-4 rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]">
          {t(errorKey)}
        </div>
      )}

      {/* ── step 1: customer ── */}
      <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
        {t("select_customer")}
      </p>
      {customer ? (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-2.5">
          <Avatar name={customer.name} seed={customer.id} size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-body text-sm font-semibold text-ink">{customer.name}</span>
              <Badge tone="neutral">{customer.tier === "member" ? t("member") : t("guest")}</Badge>
            </div>
            <p className="font-body text-xs text-muted">
              {customer.phone} · {t("credits_remaining")} {customer.balance}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCustomer(null);
              setCls(null);
              setPosition(null);
            }}
            className="shrink-0 font-body text-[13px] font-semibold text-taupe-deep"
          >
            {t("change")}
          </button>
        </div>
      ) : (
        <div className="mb-5">
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search_name_phone")}
            className="mb-2 h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink placeholder:text-muted"
          />
          <ul className="max-h-[38vh] overflow-y-auto rounded-xl border border-line">
            {filtered.length === 0 ? (
              <li className="p-4 text-center font-body text-sm text-muted">{t("no_results")}</li>
            ) : (
              filtered.map((c) => (
                <li key={c.id} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomer(c);
                      setErrorKey(null);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <Avatar name={c.name} seed={c.id} size={34} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-body text-[13.5px] font-semibold text-ink">{c.name}</span>
                      <span className="block truncate font-body text-xs text-muted">{c.phone}</span>
                    </div>
                    <span className="shrink-0 font-body text-xs font-semibold text-ink-soft tabular-nums">
                      {c.balance} {t("hours")}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {/* ── step 2: class (after a customer is chosen) ── */}
      {customer && (
        <>
          <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            {t("select_class")}
          </p>
          {cls ? (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-2.5">
              <Dot type={cls.type} size={9} />
              <div className="min-w-0 flex-1">
                <span className="block truncate font-head text-sm font-semibold text-ink">
                  {tt(cls.typeMeta.label)}
                </span>
                <span className="block truncate font-body text-xs text-muted">{classLabel(cls)}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCls(null);
                  setPosition(null);
                }}
                className="shrink-0 font-body text-[13px] font-semibold text-taupe-deep"
              >
                {t("change")}
              </button>
            </div>
          ) : (
            <ul className="mb-4 max-h-[42vh] overflow-y-auto rounded-xl border border-line">
              {upcoming.length === 0 ? (
                <li className="p-4 text-center font-body text-sm text-muted">{t("no_classes")}</li>
              ) : (
                upcoming.map((c) => (
                  <li key={c.id} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => {
                        setCls(c);
                        setErrorKey(null);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                    >
                      <Dot type={c.type} size={8} />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-body text-[13.5px] font-semibold text-ink">
                          {tt(c.typeMeta.label)}
                        </span>
                        <span className="block truncate font-body text-xs text-muted">{classLabel(c)}</span>
                      </div>
                      <span className="shrink-0 font-body text-xs font-semibold text-sage-deep tabular-nums">
                        {c.seatsLeft} {c.seatsLeft === 1 ? t("spot_left") : t("spots_left")}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}

      {/* ── step 3: position (optional; reformer types only) ── */}
      {customer && cls && showPositions && (
        <div className="mb-4">
          <p className="mb-2 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            {t("choose_position")} ({t("instructor_optional")})
          </p>
          <div className="flex items-center gap-1.5">
            {POSITIONS.map((p) => {
              const on = position === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(on ? null : p)}
                  aria-pressed={on}
                  className={`inline-flex h-9 flex-1 items-center justify-center rounded-lg border font-body text-[13px] font-semibold transition-colors ${
                    on ? "border-transparent bg-ink text-cream" : "border-line-strong bg-surface-2 text-ink"
                  }`}
                >
                  {t(POS_KEY[p])}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── cost + balance summary (after a class is chosen) ── */}
      {customer && cls && (
        <div className="rounded-2xl bg-cream-2 px-3.5 py-3">
          <div className="flex items-center justify-between font-body text-[13px]">
            <span className="text-ink-soft">{t("costs")}</span>
            <span className="font-semibold text-ink tabular-nums">
              {cost} {t("hours")}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between font-body text-[13px]">
            <span className="text-ink-soft">{t("remaining_after")}</span>
            <span
              className={`font-semibold tabular-nums ${insufficient ? "text-[#a56a52]" : "text-ink"}`}
            >
              {customer.balance} → {balanceAfter}
            </span>
          </div>
          {insufficient && (
            <p className="mt-2 font-body text-[12px] font-medium text-[#a56a52]">{t("err_no_package")}</p>
          )}
        </div>
      )}
    </Drawer>
  );
}
