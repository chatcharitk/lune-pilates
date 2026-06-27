"use client";

// Admin Schedule management (admin-schedule.jsx + spec §4 baseline→publish).
// Week strip → a day's classes → class editor drawer (create/edit/delete), plus
// the publish bar with the changes-vs-baseline diff. All edits go through server
// actions (per-week instances only — the baseline is never mutated). After each
// action the server data is re-fetched via router.refresh().

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Badge, Dot, Drawer } from "./ui";
import {
  createClass,
  deleteClass,
  generateWeekFromBaseline,
  publishWeek,
  updateClass,
} from "@/app/actions/schedule";
import type { AdminScheduleClass, AdminWeekSchedule } from "@/lib/admin/schedule";
import { CAPACITY, type ClassType } from "@/lib/domain/types";
import type { Bilingual, StrKey } from "@/lib/i18n";

const TYPES: ClassType[] = ["group", "private", "duo", "trio", "rental"];
const TIME_OPTIONS = [
  "07:00", "07:30", "08:00", "09:00", "09:30", "10:00", "11:00", "12:00",
  "13:00", "16:00", "17:00", "17:30", "18:00", "18:30", "19:00",
];
const DURATIONS = [50, 60, 90];

// The three known instructors (mirrors admin-data.jsx AINSTR). Static so this
// client view never imports server-only query code.
const INSTRUCTORS: { id: string; name: Bilingual }[] = [
  { id: "mai", name: { en: "Kru Mai", th: "ครูใหม่" } },
  { id: "ploy", name: { en: "Kru Ploy", th: "ครูพลอย" } },
  { id: "nina", name: { en: "Kru Nina", th: "ครูนีน่า" } },
];

const DOW_KEYS: StrKey[] = [
  "dow_mon", "dow_tue", "dow_wed", "dow_thu", "dow_fri", "dow_sat", "dow_sun",
];

/** Local YYYY-MM-DD for a Date (for the week query param + createClass). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface EditorState {
  mode: "new" | "edit";
  cls?: AdminScheduleClass;
}

export function ScheduleView({ schedule }: { schedule: AdminWeekSchedule }) {
  const { t, tt, lang } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const weekStart = useMemo(() => new Date(schedule.weekStart), [schedule.weekStart]);
  const totalClasses = schedule.days.reduce((a, d) => a + d.classes.length, 0);

  // Default the selected day to "today" if it's in this week, else Monday.
  const [selectedDay, setSelectedDay] = useState<number>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const idx = schedule.days.findIndex((d) => new Date(d.date).toDateString() === today.toDateString());
    return idx >= 0 ? idx : 0;
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [banner, setBanner] = useState<{ key: StrKey } | null>(null);

  const day = schedule.days[selectedDay] ?? schedule.days[0]!;

  function gotoWeek(deltaDays: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + deltaDays);
    router.push(`/admin/schedule?week=${ymd(d)}`);
  }

  function run(fn: () => Promise<{ ok: boolean }>, onOk?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onOk?.();
        router.refresh();
      }
    });
  }

  function onPublish() {
    run(() => publishWeek({ weekStart: schedule.weekStart }), () => {
      setBanner({ key: "published_toast" });
    });
  }

  function onGenerate() {
    run(() => generateWeekFromBaseline({ weekStart: schedule.weekStart }));
  }

  const monthLabel = new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    day: "numeric",
    month: "short",
  });
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 3_600_000);
  const yearFmt = new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { year: "numeric" });
  const rangeLabel = `${monthLabel.format(weekStart)} – ${monthLabel.format(weekEnd)} ${yearFmt.format(weekEnd)}`;

  const { added, removed, changed } = schedule.diff;
  const hasDiff = added + removed + changed > 0;

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
            {t("admin_schedule")}
          </h1>
          <p className="mt-1 font-body text-[13.5px] text-muted">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onGenerate}
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line-strong bg-surface-2 px-3.5 font-body text-[13.5px] font-semibold text-ink disabled:opacity-50"
          >
            {t("generate_from_baseline")}
          </button>
          <button
            type="button"
            onClick={() => setEditor({ mode: "new" })}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 font-body text-[13.5px] font-semibold text-cream"
          >
            <Plus />
            {t("new_class")}
          </button>
        </div>
      </div>

      {/* transient publish banner */}
      {banner && (
        <div className="mb-4 rounded-xl bg-sage/15 px-4 py-2.5 font-body text-[13px] font-semibold text-sage-deep">
          {t(banner.key)}
        </div>
      )}

      {totalClasses === 0 ? (
        <EmptyWeek onGenerate={onGenerate} pending={pending} />
      ) : (
        <>
          {/* week navigation + strip */}
          <div className="mb-4 flex items-center gap-2">
            <NavBtn dir="prev" label={t("prev_week")} onClick={() => gotoWeek(-7)} />
            <ul className="flex flex-1 gap-2 overflow-x-auto pb-1">
              {schedule.days.map((d, i) => {
                const date = new Date(d.date);
                const on = i === selectedDay;
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      onClick={() => setSelectedDay(i)}
                      aria-pressed={on}
                      className={`min-w-[74px] shrink-0 rounded-2xl border px-3.5 py-2.5 text-left transition-colors ${
                        on
                          ? "border-transparent bg-ink text-cream"
                          : "border-line bg-surface-2 text-ink"
                      }`}
                    >
                      <span className="block font-body text-[11px] font-semibold uppercase tracking-wide opacity-70">
                        {t(DOW_KEYS[i]!)}
                      </span>
                      <span className="mt-0.5 flex items-baseline gap-1.5">
                        <span className="font-head text-xl font-bold leading-none">{date.getDate()}</span>
                        <span className="font-body text-[10.5px] opacity-70">
                          {d.classes.length} {t("cls_short")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <NavBtn dir="next" label={t("next_week")} onClick={() => gotoWeek(7)} />
          </div>

          {/* publish bar */}
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 shadow-soft">
            <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-body text-[13px] font-semibold text-ink">
                {schedule.draftCount > 0
                  ? t("n_unpublished").replace("{n}", String(schedule.draftCount))
                  : t("all_published")}
              </span>
              <span className="text-line-strong">·</span>
              {hasDiff ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-body text-[11.5px] font-medium uppercase tracking-wide text-muted">
                    {t("changes_vs_baseline")}
                  </span>
                  {added > 0 && <Badge tone="green">{t("diff_added").replace("{n}", String(added))}</Badge>}
                  {removed > 0 && <Badge tone="rose">{t("diff_removed").replace("{n}", String(removed))}</Badge>}
                  {changed > 0 && <Badge tone="amber">{t("diff_changed").replace("{n}", String(changed))}</Badge>}
                </span>
              ) : (
                <span className="font-body text-[12.5px] text-muted">{t("matches_baseline")}</span>
              )}
            </div>
            <button
              type="button"
              onClick={onPublish}
              disabled={pending || schedule.draftCount === 0}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-sage-deep px-4 font-body text-[13.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check />
              {t("publish_week")}
            </button>
          </div>

          {/* day class list */}
          {day.classes.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
              {t("no_classes_day")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {day.classes.map((c) => (
                <li key={c.id}>
                  <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface-2 px-4 py-3.5 shadow-soft">
                    <div className="w-12 shrink-0">
                      <p className="font-head text-[17px] font-bold leading-none text-ink tabular-nums">{c.time}</p>
                      <p className="mt-1 font-body text-[11px] text-muted">{c.durationMin}′</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Dot type={c.type} />
                        <span className="font-head text-[15px] font-semibold text-ink">{tt(c.typeMeta.label)}</span>
                        <Badge tone={c.status === "published" ? "green" : "neutral"}>
                          {c.status === "published" ? t("status_published") : t("status_draft")}
                        </Badge>
                      </div>
                      <p className="flex items-center gap-2 font-body text-[12.5px] text-ink-soft">
                        <span className={c.instructor ? "" : "text-muted"}>
                          {c.instructor ? tt(c.instructor.name) : t("no_instructor")}
                        </span>
                        <span className="text-line-strong">·</span>
                        <span className="tabular-nums">
                          {c.booked}/{c.capacity} {t("booked_label")}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditor({ mode: "edit", cls: c })}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3.5 font-body text-[13px] font-semibold text-ink"
                    >
                      {t("edit")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {editor && (
        <ClassEditor
          state={editor}
          dayDate={ymd(new Date(day.date))}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── editor drawer ─────────────────────────

const FAILURE_STR: Record<string, StrKey> = {
  CAPACITY_BELOW_BOOKED: "err_capacity_below_booked",
  HAS_BOOKINGS: "err_has_bookings",
  INVALID_INSTRUCTOR: "err_invalid_instructor",
};

function ClassEditor({
  state,
  dayDate,
  onClose,
  onSaved,
}: {
  state: EditorState;
  dayDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tt, lang } = useAdminLang();
  const isNew = state.mode === "new";
  const c = state.cls;

  const [type, setType] = useState<ClassType>(c?.type ?? "group");
  const [time, setTime] = useState<string>(c?.time ?? "07:00");
  const [durationMin, setDurationMin] = useState<number>(c?.durationMin ?? 60);
  const [instructorId, setInstructorId] = useState<string | null>(c?.instructorId ?? null);
  const [capacity, setCapacity] = useState<number>(c?.capacity ?? CAPACITY.group);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  const [pending, startTransition] = useTransition();

  const maxCap = CAPACITY[type];

  function pickType(next: ClassType) {
    setType(next);
    setCapacity(CAPACITY[next]); // each type carries its own cap (prototype parity)
  }

  function save() {
    setErrorKey(null);
    startTransition(async () => {
      const res = isNew
        ? await createClass({ date: dayDate, time, type, durationMin, capacity, instructorId })
        : await updateClass({ id: c!.id, time, type, durationMin, capacity, instructorId });
      if (res.ok) onSaved();
      else setErrorKey(FAILURE_STR[res.code] ?? "err_generic");
    });
  }

  function remove() {
    setErrorKey(null);
    startTransition(async () => {
      const res = await deleteClass({ id: c!.id });
      if (res.ok) onSaved();
      else setErrorKey(FAILURE_STR[res.code] ?? "err_generic");
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? t("new_class") : t("edit_class")}
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
            onClick={save}
            disabled={pending}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
          >
            <Check />
            {t("save_class")}
          </button>
        </>
      }
    >
      {errorKey && (
        <div className="mb-4 rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]">
          {t(errorKey)}
        </div>
      )}

      {/* type */}
      <Field label={t("class_type")}>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((k) => {
            const on = type === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => pickType(k)}
                aria-pressed={on}
                className={`flex items-center gap-2 rounded-xl border-[1.5px] px-3 py-3 text-left ${
                  on ? "border-taupe bg-surface" : "border-line"
                }`}
              >
                <Dot type={k} size={9} />
                <span className="font-body text-[13.5px] font-semibold text-ink">{t(`type_${k}` as StrKey)}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3.5">
        <Field label={t("start_time")}>
          <Select value={time} onChange={setTime} options={TIME_OPTIONS.map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label={t("duration")}>
          <Select
            value={String(durationMin)}
            onChange={(v) => setDurationMin(Number(v))}
            options={DURATIONS.map((d) => ({ value: String(d), label: `${d} ${t("min")}` }))}
          />
        </Field>
      </div>

      {/* instructor */}
      <Field
        label={`${t("instructor")} (${t("instructor_optional")})`}
      >
        <div className="flex flex-wrap gap-2">
          <InstrPill
            label={t("no_instructor")}
            on={instructorId === null}
            onClick={() => setInstructorId(null)}
          />
          {INSTRUCTORS.map((ins) => (
            <InstrPill
              key={ins.id}
              label={tt(ins.name)}
              on={instructorId === ins.id}
              onClick={() => setInstructorId(ins.id)}
            />
          ))}
        </div>
      </Field>

      {/* capacity */}
      <Field label={t("capacity")}>
        <div className="flex items-center gap-3.5">
          <div className="flex items-center overflow-hidden rounded-xl border border-line-strong">
            <Stepper sign="-" disabled={capacity <= 1} onClick={() => setCapacity((v) => Math.max(1, v - 1))} />
            <span className="w-12 text-center font-head text-lg font-bold text-ink tabular-nums">{capacity}</span>
            <Stepper sign="+" disabled={capacity >= maxCap} onClick={() => setCapacity((v) => Math.min(maxCap, v + 1))} />
          </div>
          <span className="font-body text-[13px] text-muted">
            {lang === "th" ? "คน · สูงสุด 3 เครื่อง" : t("people_max_reformers")}
          </span>
        </div>
      </Field>

      {!isNew && (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="mt-2 w-full rounded-xl border border-rose/40 py-3 font-body text-sm font-semibold text-[#a56a52] disabled:opacity-50"
        >
          {t("delete_class")}
        </button>
      )}
    </Drawer>
  );
}

// ───────────────────────── small presentational bits ─────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-2 block font-body text-xs font-semibold tracking-wide text-ink-soft">{label}</label>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
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

function InstrPill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-xl border-[1.5px] px-3.5 py-2.5 font-body text-[13px] font-semibold text-ink ${
        on ? "border-taupe bg-surface" : "border-line"
      }`}
    >
      {label}
    </button>
  );
}

function Stepper({ sign, onClick, disabled }: { sign: "+" | "-"; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={sign === "+" ? "Increase" : "Decrease"}
      className="flex h-11 w-11 items-center justify-center bg-surface text-ink disabled:opacity-30"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        {sign === "+" ? <path d="M12 5v14M5 12h14" /> : <path d="M5 12h14" />}
      </svg>
    </button>
  );
}

function NavBtn({ dir, label, onClick }: { dir: "prev" | "next"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-soft"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {dir === "prev" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
      </svg>
    </button>
  );
}

function EmptyWeek({ onGenerate, pending }: { onGenerate: () => void; pending: boolean }) {
  const { t } = useAdminLang();
  return (
    <div className="flex min-h-[44vh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-2 p-10 text-center">
      <span className="font-brand text-3xl font-semibold text-taupe-deep">
        LUN<span className="lune-spark">E</span>
      </span>
      <p className="font-head text-lg font-semibold text-ink">{t("empty_week_title")}</p>
      <p className="max-w-sm font-body text-sm text-muted">{t("empty_week_sub")}</p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={pending}
        className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        {t("generate_from_baseline")}
      </button>
    </div>
  );
}

function Plus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
