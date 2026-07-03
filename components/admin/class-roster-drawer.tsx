"use client";

// Roster drawer for the admin Schedule screen. Tapping a class opens this: the
// live attendee list, where the front desk can CHECK IN, change a REFORMER
// POSITION, or CANCEL a booking. The roster is fetched on open (and re-fetched
// after every action) through the loadClassRoster server action; each mutation
// is its own gated server action. The waitlist is shown read-only.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Drawer } from "./ui";
import { loadClassRoster } from "@/app/actions/admin-roster";
import { setCheckIn } from "@/app/actions/admin";
import { adminCancelBooking, adminSetBookingPosition } from "@/app/actions/admin-bookings";
import type { AdminClassRoster } from "@/lib/admin/class-roster";
import type { AdminAttendee } from "@/lib/admin/today";
import type { ReformerPosition } from "@/lib/domain/types";
import type { StrKey } from "@/lib/i18n";
import { formatStudioTime } from "@/lib/time";

const POSITIONS: ReformerPosition[] = ["left", "middle", "right"];
const POS_KEY: Record<ReformerPosition, StrKey> = {
  left: "pos_left",
  middle: "pos_middle",
  right: "pos_right",
};

export function ClassRosterDrawer({
  classId,
  onClose,
}: {
  classId: string | null;
  onClose: () => void;
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [roster, setRoster] = useState<AdminClassRoster | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!classId) {
      setRoster(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setToast(null);
    setConfirmId(null);
    loadClassRoster(classId).then((r) => {
      if (alive) {
        setRoster(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [classId]);

  function withBusy(bookingId: string, fn: () => Promise<void>) {
    setBusyId(bookingId);
    startTransition(async () => {
      await fn();
      if (classId) setRoster(await loadClassRoster(classId));
      router.refresh(); // keep the schedule's booked counts fresh
      setBusyId(null);
    });
  }

  function onCheck(a: AdminAttendee) {
    withBusy(a.bookingId, async () => {
      await setCheckIn({ bookingId: a.bookingId, checkedIn: !a.checkedIn });
    });
  }

  function onPosition(bookingId: string, position: ReformerPosition) {
    setToast(null);
    withBusy(bookingId, async () => {
      const res = await adminSetBookingPosition({ bookingId, position });
      if (!res.ok) setToast(t(res.code === "POSITION_TAKEN" ? "err_position_taken" : "err_generic"));
    });
  }

  function onCancel(bookingId: string) {
    setConfirmId(null);
    setToast(null);
    withBusy(bookingId, async () => {
      const res = await adminCancelBooking({ bookingId });
      if (res.ok) {
        setToast(res.outcome.refunded ? t("booking_cancelled_refunded") : t("booking_cancelled_kept"));
      } else {
        setToast(t("err_generic"));
      }
    });
  }

  const showPositions = roster ? roster.type !== "private" : false;

  return (
    <Drawer
      open={classId !== null}
      onClose={onClose}
      title={
        roster ? `${tt(roster.typeMeta.label)} · ${formatStudioTime(new Date(roster.startsAt))}` : t("roster")
      }
    >
      {loading && !roster ? (
        <p className="py-10 text-center font-body text-sm text-muted">{t("loading")}</p>
      ) : !roster ? (
        <p className="py-10 text-center font-body text-sm text-muted">{t("err_not_found")}</p>
      ) : (
        <div>
          {toast && (
            <div className="mb-4 rounded-xl bg-cream-2 px-3.5 py-2.5 font-body text-[13px] font-medium text-ink">
              {toast}
            </div>
          )}

          {/* instructor + counts */}
          <div className="mb-4 flex items-center justify-between rounded-2xl bg-cream-2 px-3.5 py-3">
            <div>
              <p className="font-body text-[13.5px] font-semibold text-ink">
                {roster.instructor ? tt(roster.instructor.name) : t("no_instructor")}
              </p>
              <p className="font-body text-xs text-muted tabular-nums">
                {formatStudioTime(new Date(roster.startsAt))}–{formatStudioTime(new Date(roster.endsAt))} ·{" "}
                {roster.durationMin} {t("min")}
              </p>
            </div>
            <span className="font-head text-base font-bold text-ink tabular-nums">
              {roster.checkedIn}/{roster.booked}/{roster.capacity}
            </span>
          </div>

          {/* roster */}
          <p className="mb-2.5 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            {t("roster")} · {roster.booked}/{roster.capacity}
          </p>
          {roster.roster.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface-2 p-6 text-center font-body text-sm text-muted">
              {t("no_attendees")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {roster.roster.map((a) => {
                const busy = busyId === a.bookingId;
                return (
                  <li
                    key={a.bookingId}
                    className={`rounded-2xl border px-3 py-3 ${
                      a.checkedIn ? "border-sage/30 bg-sage/[0.06]" : "border-line bg-surface-2"
                    } ${busy ? "opacity-60" : ""}`}
                  >
                    {/* line 1: person + check-in */}
                    <div className="flex items-center gap-3">
                      <Avatar name={a.name} seed={a.userId} size={38} checked={a.checkedIn} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-body text-sm font-semibold text-ink">{a.name}</span>
                          <Badge tone="neutral">{a.isMember ? t("member") : t("guest")}</Badge>
                        </div>
                        <p className="truncate font-body text-xs text-muted">
                          {a.phone}
                          {a.house ? ` · ${t("house_label")} ${a.house}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onCheck(a)}
                        disabled={busy}
                        aria-pressed={a.checkedIn}
                        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 font-body text-[13px] font-semibold transition-colors disabled:opacity-50 ${
                          a.checkedIn ? "bg-sage text-white" : "border border-line-strong text-ink"
                        }`}
                      >
                        <Check />
                        {a.checkedIn ? t("checked") : t("check_in")}
                      </button>
                    </div>

                    {/* line 2: position pills + cancel (or inline cancel confirm) */}
                    {confirmId === a.bookingId ? (
                      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                        <span className="flex-1 font-body text-[13px] font-medium text-ink">
                          {t("cancel_booking")}?
                        </span>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="inline-flex h-9 items-center rounded-xl border border-line-strong px-3 font-body text-[13px] font-semibold text-ink"
                        >
                          {t("keep")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onCancel(a.bookingId)}
                          disabled={busy}
                          className="inline-flex h-9 items-center rounded-xl bg-[#b5765c] px-3 font-body text-[13px] font-semibold text-white disabled:opacity-50"
                        >
                          {t("confirm")}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                        {showPositions ? (
                          <div className="flex flex-1 items-center gap-1.5">
                            {POSITIONS.map((p) => {
                              const own = a.position === p;
                              const takenByOther = !own && roster.takenPositions.includes(p);
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => !own && !takenByOther && onPosition(a.bookingId, p)}
                                  disabled={busy || takenByOther}
                                  aria-pressed={own}
                                  className={`inline-flex h-8 flex-1 items-center justify-center rounded-lg border font-body text-[12px] font-semibold transition-colors ${
                                    own
                                      ? "border-transparent bg-ink text-cream"
                                      : takenByOther
                                        ? "border-line bg-cream-2 text-muted opacity-50"
                                        : "border-line-strong bg-surface-2 text-ink"
                                  }`}
                                >
                                  {t(POS_KEY[p])}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="flex-1" />
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmId(a.bookingId)}
                          disabled={busy}
                          aria-label={t("cancel_booking")}
                          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 font-body text-[12px] font-semibold text-[#b5765c] disabled:opacity-50"
                        >
                          <TrashIcon />
                          {t("cancel_booking")}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* waitlist (read-only here — notify lives on the Today screen) */}
          {roster.waitlist.length > 0 && (
            <div className="mt-5">
              <p className="mb-2.5 font-body text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#9a7b45]">
                {t("waitlist")} · {roster.waitlist.length}
              </p>
              <ul className="flex flex-col gap-2">
                {roster.waitlist.map((w) => (
                  <li
                    key={w.waitlistId}
                    className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-3 py-2.5"
                  >
                    <span className="w-4 shrink-0 text-center font-head text-sm font-bold text-muted tabular-nums">
                      {w.position}
                    </span>
                    <Avatar name={w.name} seed={w.userId} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-body text-[13.5px] font-semibold text-ink">{w.name}</p>
                      <p className="font-body text-xs text-muted">{w.phone}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}
