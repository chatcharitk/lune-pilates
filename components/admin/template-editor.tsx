"use client";

// Admin "Manage template" — the editor for the RECURRING weekly schedule template
// (lib/admin/schedule-template.ts read model + the template CRUD actions in
// app/actions/schedule.ts). It mirrors the instructor-availability editor's Drawer
// pattern (components/admin/instructors-view.tsx): a Mon→Sun view of the template
// slots, each with Edit + Remove, and an "+ Add slot" per day, plus a nested
// add/edit Drawer form. Editing the template changes what "Load from baseline"
// generates — it never touches concrete class instances (CLAUDE.md §5 invariant 5).
//
// This view consumes ONLY the typed contract (TemplateSlot) + the template actions,
// never lib/db/*. Capacity is clamped client-side to the type's hard cap; the server
// re-validates. After each action: router.refresh() + a transient toast.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Badge, Dot, Drawer } from "./ui";
import {
  createTemplateSlot,
  deleteTemplateSlot,
  updateTemplateSlot,
  type TemplateCrudFailureCode,
} from "@/app/actions/schedule";
import type { TemplateSlot } from "@/lib/admin/schedule-template";
import { CAPACITY, type ClassType } from "@/lib/domain/types";
import type { Bilingual, StrKey } from "@/lib/i18n";

const TYPES: ClassType[] = ["group", "private", "duo", "trio"]; // rental hidden 2026-07-20
const DURATIONS = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

// ISO weekday (1=Mon … 7=Sun) → full-name i18n key (reuses the availability editor's
// day_mon..day_sun keys).
const DAY_KEYS: { dow: number; key: StrKey }[] = [
  { dow: 1, key: "day_mon" },
  { dow: 2, key: "day_tue" },
  { dow: 3, key: "day_wed" },
  { dow: 4, key: "day_thu" },
  { dow: 5, key: "day_fri" },
  { dow: 6, key: "day_sat" },
  { dow: 7, key: "day_sun" },
];

// The three known instructors (mirrors schedule-view.tsx INSTRUCTORS / admin-data.jsx
// AINSTR). Static so this client view never imports server-only query code.
const INSTRUCTORS: { id: string; name: Bilingual }[] = [
  { id: "mai", name: { en: "Kru Mai", th: "ครูใหม่" } },
  { id: "ploy", name: { en: "Kru Ploy", th: "ครูพลอย" } },
  { id: "nina", name: { en: "Kru Nina", th: "ครูนีน่า" } },
];

/** Map a template CRUD failure code to keyed copy. */
function templateErrorKey(code: TemplateCrudFailureCode): StrKey {
  switch (code) {
    case "INVALID_INPUT":
      return "err_template_invalid";
    case "UNKNOWN_TEMPLATE":
      return "err_template_unknown";
    case "UNKNOWN_INSTRUCTOR":
      return "err_template_unknown_instructor";
    default:
      return "err_template_save";
  }
}

interface FormState {
  mode: "new" | "edit";
  /** Pre-selected day for a new slot, or the slot being edited. */
  dayOfWeek: number;
  slot?: TemplateSlot;
}

// ───────────────────────── editor drawer (the weekly list) ─────────────────────────

export function TemplateEditor({
  open,
  template,
  onClose,
}: {
  open: boolean;
  template: TemplateSlot[];
  onClose: () => void;
}) {
  const { t } = useAdminLang();
  const [form, setForm] = useState<FormState | null>(null);
  const [removing, setRemoving] = useState<TemplateSlot | null>(null);
  const [toast, setToast] = useState<StrKey | null>(null);

  function flash(key: StrKey) {
    setToast(key);
    window.setTimeout(() => setToast(null), 3200);
  }

  return (
    <>
      <Drawer open={open} onClose={onClose} title={t("manage_template_title")}>
        <p className="mb-4 font-body text-[13px] leading-relaxed text-muted">
          {t("manage_template_sub")}
        </p>

        {toast && (
          <div
            role="status"
            className="mb-4 rounded-xl bg-sage/15 px-4 py-2.5 font-body text-[13px] font-semibold text-sage-deep"
          >
            {t(toast)}
          </div>
        )}

        {template.length === 0 && (
          <div className="mb-4 rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-center font-body text-[13px] text-muted">
            {t("template_empty")}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {DAY_KEYS.map(({ dow, key }) => {
            const slots = template
              .filter((s) => s.dayOfWeek === dow)
              .sort((a, b) => a.time.localeCompare(b.time));
            return (
              <DaySection
                key={dow}
                dayLabel={t(key)}
                slots={slots}
                onAdd={() => setForm({ mode: "new", dayOfWeek: dow })}
                onEdit={(slot) => setForm({ mode: "edit", dayOfWeek: dow, slot })}
                onRemove={(slot) => setRemoving(slot)}
              />
            );
          })}
        </div>
      </Drawer>

      {/* add / edit form (nested drawer over the list) */}
      <SlotFormDrawer
        state={form}
        onClose={() => setForm(null)}
        onSaved={(key) => {
          setForm(null);
          flash(key);
        }}
      />

      {/* remove confirmation */}
      <RemoveSlotDrawer
        slot={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          flash("toast_template_removed");
        }}
      />
    </>
  );
}

// ───────────────────────── one weekday's slots ─────────────────────────

function DaySection({
  dayLabel,
  slots,
  onAdd,
  onEdit,
  onRemove,
}: {
  dayLabel: string;
  slots: TemplateSlot[];
  onAdd: () => void;
  onEdit: (slot: TemplateSlot) => void;
  onRemove: (slot: TemplateSlot) => void;
}) {
  const { t, tt } = useAdminLang();
  return (
    <div className="rounded-2xl border border-line bg-surface-2 px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-head text-[15px] font-semibold text-ink">{dayLabel}</span>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-3 py-1.5 font-body text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-cream-2"
        >
          <PlusSmall />
          {t("add_slot")}
        </button>
      </div>

      {slots.length === 0 ? (
        <p className="rounded-xl bg-cream-2 px-3 py-3 text-center font-body text-[12.5px] text-muted">
          {t("template_empty_day")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {slots.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5"
            >
              <span className="w-11 shrink-0 font-head text-[14.5px] font-bold text-ink tabular-nums">
                {s.time}
              </span>
              <Dot type={s.type} size={8} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-[13.5px] font-semibold text-ink">
                  {s.name || tt(s.typeMeta.label)}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-body text-[11.5px] text-muted tabular-nums">
                  <span>
                    {s.durationMin}
                    {t("min")}
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {s.capacity} {t("people")}
                  </span>
                  <span aria-hidden>·</span>
                  <span className={s.instructor ? "" : "italic"}>
                    {s.instructor ? tt(s.instructor.name) : t("instructor_any")}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEdit(s)}
                  aria-label={`${t("edit_slot")} ${s.time}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:bg-cream-2"
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(s)}
                  aria-label={`${t("remove_slot")} ${s.time}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[#a56a52] transition-colors hover:bg-rose/10"
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── add / edit slot form ─────────────────────────

function SlotFormDrawer({
  state,
  onClose,
  onSaved,
}: {
  state: FormState | null;
  onClose: () => void;
  onSaved: (toastKey: StrKey) => void;
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isEdit = state?.mode === "edit";
  const slot = state?.slot;

  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [type, setType] = useState<ClassType>("group");
  const [name, setName] = useState<string>("");
  const [time, setTime] = useState<string>("07:00");
  const [durationMin, setDurationMin] = useState<number>(60);
  const [capacity, setCapacity] = useState<number>(CAPACITY.group);
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  // Prefill from the target slot (edit) or the chosen day (new) when (re)opening.
  useEffect(() => {
    if (!state) return;
    setDayOfWeek(state.dayOfWeek);
    setType(slot?.type ?? "group");
    setName(slot?.name ?? "");
    setTime(slot?.time ?? "07:00");
    setDurationMin(slot?.durationMin ?? 60);
    setCapacity(slot?.capacity ?? CAPACITY.group);
    setInstructorId(slot?.instructorId ?? null);
    setErrorKey(null);
  }, [state, slot]);

  const maxCap = CAPACITY[type];

  function pickType(next: ClassType) {
    setType(next);
    setCapacity((c) => Math.min(c, CAPACITY[next])); // clamp to the new type's cap
  }

  function save() {
    setErrorKey(null);
    startTransition(async () => {
      const cap = Math.min(capacity, maxCap);
      const res = isEdit
        ? await updateTemplateSlot({ id: slot!.id, time, type, durationMin, capacity: cap, instructorId, name: name.trim() || null })
        : await createTemplateSlot({ dayOfWeek, time, type, durationMin, capacity: cap, instructorId, name: name.trim() || null });
      if (res.ok) {
        onSaved(isEdit ? "toast_template_updated" : "toast_template_added");
        router.refresh();
      } else {
        setErrorKey(templateErrorKey(res.code));
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
      title={t(isEdit ? "edit_slot_title" : "add_slot_title")}
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

      {/* day — only for a new slot (edit keeps its day) */}
      {!isEdit && (
        <Field label={t("slot_day")}>
          <Select
            value={String(dayOfWeek)}
            onChange={(v) => setDayOfWeek(Number(v))}
            options={DAY_KEYS.map(({ dow, key }) => ({ value: String(dow), label: t(key) }))}
          />
        </Field>
      )}

      {/* type */}
      <Field label={t("slot_type")}>
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
                <span className="font-body text-[13.5px] font-semibold text-ink">
                  {t(`type_${k}` as StrKey)}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={`${t("class_name_label")} (${t("instructor_optional")})`}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("class_name_ph")}
          maxLength={60}
          className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 font-body text-sm text-ink placeholder:text-muted"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3.5">
        <Field label={t("slot_time")}>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm font-medium text-ink tabular-nums"
          />
        </Field>
        <Field label={t("slot_duration")}>
          <Select
            value={String(durationMin)}
            onChange={(v) => setDurationMin(Number(v))}
            options={DURATIONS.map((d) => ({ value: String(d), label: `${d} ${t("min")}` }))}
          />
        </Field>
      </div>

      {/* instructor */}
      <Field label={t("slot_instructor")}>
        <div className="flex flex-wrap gap-2">
          <InstrPill
            label={t("instructor_any")}
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
      <Field label={t("slot_capacity")}>
        <div className="flex items-center gap-3.5">
          <div className="flex items-center overflow-hidden rounded-xl border border-line-strong">
            <Stepper sign="-" disabled={capacity <= 1} onClick={() => setCapacity((v) => Math.max(1, v - 1))} />
            <span className="w-12 text-center font-head text-lg font-bold text-ink tabular-nums">
              {capacity}
            </span>
            <Stepper sign="+" disabled={capacity >= maxCap} onClick={() => setCapacity((v) => Math.min(maxCap, v + 1))} />
          </div>
          <span className="font-body text-[13px] text-muted">{t("people_max_reformers")}</span>
        </div>
      </Field>
    </Drawer>
  );
}

// ───────────────────────── remove confirmation ─────────────────────────

function RemoveSlotDrawer({
  slot,
  onClose,
  onRemoved,
}: {
  slot: TemplateSlot | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  useEffect(() => {
    if (slot) setErrorKey(null);
  }, [slot]);

  function confirm() {
    if (!slot) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await deleteTemplateSlot({ id: slot.id });
      if (res.ok) {
        onRemoved();
        router.refresh();
      } else {
        setErrorKey(templateErrorKey(res.code));
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
        className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#a56a52] px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        <TrashIcon />
        {t("remove_slot")}
      </button>
    </>
  );

  return (
    <Drawer open={slot !== null} onClose={onClose} title={t("remove_slot")} footer={footer}>
      {slot && (
        <div className="flex flex-col gap-4">
          <p className="font-body text-[14px] leading-relaxed text-ink">
            {t("remove_slot_confirm")
              .replace("{time}", slot.time)
              .replace("{type}", tt(slot.typeMeta.label))}
          </p>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-2 block font-body text-xs font-semibold tracking-wide text-ink-soft">
        {label}
      </label>
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

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
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

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
