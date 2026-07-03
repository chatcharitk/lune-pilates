"use client";

// Admin Schedule management (admin-schedule.jsx + spec §4).
// Week strip → a day's classes → class editor drawer (create/edit/delete).
// Classes are born published (createClass/generateWeekFromBaseline publish
// immediately), so there is no publish bar. All edits go through server
// actions (per-week instances only — the baseline is never mutated). After
// each action the server data is re-fetched via router.refresh().

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Dot, Drawer } from "./ui";
import { TemplateEditor } from "./template-editor";
import {
  createClass,
  deleteClass,
  generateWeekFromBaseline,
  updateClass,
} from "@/app/actions/schedule";
import type { AdminScheduleClass, AdminWeekSchedule } from "@/lib/admin/schedule";
import type { TemplateSlot } from "@/lib/admin/schedule-template";
import { CAPACITY, type ClassType } from "@/lib/domain/types";
import type { Bilingual, StrKey } from "@/lib/i18n";
import { addDays, formatStudioDate, studioParts, studioStartOfDay } from "@/lib/time";

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

/** Bangkok YYYY-MM-DD for an instant (for the week query param + createClass). */
function ymd(d: Date): string {
  const { year, month0, day } = studioParts(d);
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface EditorState {
  mode: "new" | "edit";
  cls?: AdminScheduleClass;
}

export function ScheduleView({
  schedule,
  template,
}: {
  schedule: AdminWeekSchedule;
  template: TemplateSlot[];
}) {
  const { t, tt, lang } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [templateOpen, setTemplateOpen] = useState(false);

  const weekStart = useMemo(() => new Date(schedule.weekStart), [schedule.weekStart]);
  const totalClasses = schedule.days.reduce((a, d) => a + d.classes.length, 0);

  // Default the selected day to "today" if it's in this week, else Monday.
  const [selectedDay, setSelectedDay] = useState<number>(() => {
    const today = studioStartOfDay(new Date()).getTime();
    const idx = schedule.days.findIndex(
      (d) => studioStartOfDay(new Date(d.date)).getTime() === today,
    );
    return idx >= 0 ? idx : 0;
  });
  const [editor, setEditor] = useState<EditorState | null>(null);

  const day = schedule.days[selectedDay] ?? schedule.days[0]!;

  function gotoWeek(deltaDays: number) {
    router.push(`/admin/schedule?week=${ymd(addDays(weekStart, deltaDays))}`);
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

  function onGenerate() {
    run(() => generateWeekFromBaseline({ weekStart: schedule.weekStart }));
  }

  const dayMonthOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = `${formatStudioDate(weekStart, lang, dayMonthOpts)} – ${formatStudioDate(
    weekEnd,
    lang,
    dayMonthOpts,
  )} ${formatStudioDate(weekEnd, lang, { year: "numeric" })}`;

  return (
    <div>
      {/* header: title */}
      <h1 className="mb-2.5 font-head text-xl font-semibold tracking-tight text-ink">
        {t("admin_schedule")}
      </h1>

      {/* actions — all three on one line */}
      <div className="mb-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTemplateOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-line-strong bg-surface-2 px-2.5 font-body text-[12.5px] font-semibold text-ink"
        >
          <SlidersIcon />
          {t("manage_template")}
        </button>
        <button
          type="button"
          onClick={onGenerate}
          disabled={pending}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-line-strong bg-surface-2 px-2.5 font-body text-[12.5px] font-semibold text-ink disabled:opacity-50"
        >
          {t("generate_from_baseline")}
        </button>
        <button
          type="button"
          onClick={() => setEditor({ mode: "new" })}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-ink px-2.5 font-body text-[12.5px] font-semibold text-cream"
        >
          <Plus />
          {t("new_class")}
        </button>
      </div>

      {/* week navigation — always visible: prev · range · next */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <NavBtn dir="prev" label={t("prev_week")} onClick={() => gotoWeek(-7)} />
        <p className="min-w-0 truncate text-center font-body text-[13px] font-semibold text-ink">
          {rangeLabel}
        </p>
        <NavBtn dir="next" label={t("next_week")} onClick={() => gotoWeek(7)} />
      </div>

      {/* 7-day strip — always visible, whole week fits (Mon..Sun) */}
      <ul className="mb-4 grid grid-cols-7 gap-1">
        {schedule.days.map((d, i) => {
          const dayOfMonth = studioParts(new Date(d.date)).day;
          const on = i === selectedDay;
          const count = d.classes.length;
          return (
            <li key={d.date}>
              <button
                type="button"
                onClick={() => setSelectedDay(i)}
                aria-pressed={on}
                className={`flex w-full flex-col items-center rounded-xl border py-1.5 transition-colors ${
                  on ? "border-transparent bg-ink text-cream" : "border-line bg-surface-2 text-ink"
                }`}
              >
                <span className="font-body text-[10px] font-semibold uppercase opacity-70">
                  {t(DOW_KEYS[i]!)}
                </span>
                <span className="mt-0.5 font-head text-[15px] font-bold leading-none">{dayOfMonth}</span>
                <span className="mt-1 font-body text-[10px] font-semibold leading-none opacity-70">
                  {count > 0 ? count : "·"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* content: selected day's classes, or empty states (strip stays above) */}
      {day.classes.length === 0 ? (
        totalClasses === 0 ? (
          <EmptyWeek onGenerate={onGenerate} pending={pending} />
        ) : (
          <p className="rounded-2xl border border-line bg-surface-2 p-8 text-center font-body text-sm text-muted">
            {t("no_classes_day")}
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-1.5">
          {day.classes.map((c) => (
                <li key={c.id}>
                  <div className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-line bg-surface-2 py-1.5 pl-3 pr-1.5 shadow-soft md:gap-3 md:pl-4 md:pr-2">
                    <div className="w-11 shrink-0 md:w-12">
                      <p className="font-head text-[14px] font-semibold leading-none text-ink tabular-nums">{c.time}</p>
                      <p className="mt-0.5 font-body text-[10.5px] leading-none text-muted">{c.durationMin}′</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Dot type={c.type} size={7} />
                        <span className="truncate font-head text-[13.5px] font-semibold leading-tight text-ink">
                          {tt(c.typeMeta.label)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-body text-[11.5px] text-ink-soft">
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-px font-body text-[10px] font-semibold ${
                            c.status === "published" ? "bg-sage/15 text-sage-deep" : "bg-cream-2 text-ink-soft"
                          }`}
                        >
                          {c.status === "published" ? t("status_published") : t("status_draft")}
                        </span>
                        <span className={`min-w-0 truncate ${c.instructor ? "" : "text-muted"}`}>
                          {c.instructor ? tt(c.instructor.name) : t("no_instructor")}
                        </span>
                        <span className="shrink-0 text-line-strong">·</span>
                        <span className="shrink-0 whitespace-nowrap tabular-nums">
                          {c.booked}/{c.capacity}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditor({ mode: "edit", cls: c })}
                      aria-label={t("edit")}
                      title={t("edit")}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-surface"
                    >
                      <PencilIcon />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
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

      <TemplateEditor
        open={templateOpen}
        template={template}
        onClose={() => setTemplateOpen(false)}
      />
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

function SlidersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
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
