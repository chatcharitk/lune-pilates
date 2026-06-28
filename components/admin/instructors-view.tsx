"use client";

// Admin "Instructors & availability" (spec §4; prototypes admin-more.jsx
// `InstructorsScreen` + admin-mobile-more.jsx `MInstructors` / `MAvailEditor`).
//
// Two parts:
//   1. A responsive grid of instructor cards. Each card = avatar + name + the
//      "{classes} classes · {attendees} attendees" subline, an Available/Day-off
//      badge, today's availability range chips, today's classes (time · type dot ·
//      short label · booked/cap), and an "Edit availability" button.
//   2. The weekly availability editor in the shared Drawer: 7 day rows (Mon–Sun),
//      each with an on/off toggle and (when on) range chips with a remove × plus a
//      dashed "+ add hours" chip. Save serializes all 7 day keys and calls
//      setInstructorAvailability.
//
// All read state is the server's (lib/admin/instructors.ts). This view imports ONLY
// the availability action + erased contract types — never lib/db/*. The editor keeps
// a local editable copy of the week and mirrors the prototype's toggleDay / addRange
// / removeRange (presets only, no free time entry — faithful to MAvailEditor).

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { Avatar, Badge, Dot, Drawer } from "./ui";
import {
  createInstructor,
  setInstructorActive,
  setInstructorAvailability,
  updateInstructor,
  type InstructorCrudFailureCode,
  type SetInstructorAvailabilityFailureCode,
} from "@/app/actions/instructors";
import {
  WEEKDAYS,
  type AdminInstructor,
  type AvailabilityRange,
  type Weekday,
  type WeekAvailability,
} from "@/lib/admin/instructors";
import type { StrKey } from "@/lib/i18n";

// ───────────────────────── helpers ─────────────────────────

/** i18n key for a weekday's full name (Mon → day_mon …). */
const DAY_KEY: Record<Weekday, StrKey> = {
  Mon: "day_mon",
  Tue: "day_tue",
  Wed: "day_wed",
  Thu: "day_thu",
  Fri: "day_fri",
  Sat: "day_sat",
  Sun: "day_sun",
};

/** Map a save failure code to keyed copy. */
function saveErrorKey(code: SetInstructorAvailabilityFailureCode): StrKey {
  switch (code) {
    case "UNKNOWN_INSTRUCTOR":
      return "err_unknown_instructor";
    case "INVALID_INPUT":
      // The format is preset-guaranteed, so the only reachable INVALID_INPUT is an
      // overlap — surface the actionable message rather than the generic one.
      return "err_avail_overlap";
    default:
      return "err_avail_save";
  }
}

/** Map an instructor CRUD failure code to keyed copy. */
function crudErrorKey(code: InstructorCrudFailureCode): StrKey {
  switch (code) {
    case "ID_TAKEN":
      return "err_instr_id_taken";
    case "INVALID_INPUT":
      return "err_instr_invalid";
    case "UNKNOWN_INSTRUCTOR":
      return "err_unknown_instructor";
    default:
      return "err_instr_save";
  }
}

// The prototype's add-range preset cycle (admin-mobile-more.jsx `presets`).
const PRESETS: AvailabilityRange[] = [
  { start: "07:00", end: "13:00" },
  { start: "17:00", end: "20:00" },
  { start: "09:00", end: "12:00" },
];

/** Toggling a day on seeds this single range (mirrors the prototype). */
const SEED_RANGE: AvailabilityRange = { start: "09:00", end: "12:00" };

/** Minutes since midnight for an "HH:MM" string. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number.parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Two ranges overlap (touching endpoints, end==nextStart, do NOT count). */
function rangesOverlap(a: AvailabilityRange, b: AvailabilityRange): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** A day has overlapping ranges — mirrors the server's daySchema check so the editor
 *  can never construct a week the action would reject. */
function dayHasOverlap(ranges: AvailabilityRange[]): boolean {
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (rangesOverlap(ranges[i]!, ranges[j]!)) return true;
    }
  }
  return false;
}

/** Serialize the editor's week into the action's [start, end] tuple shape (all 7 keys). */
function toActionWeek(week: WeekAvailability): Record<Weekday, [string, string][]> {
  const out = {} as Record<Weekday, [string, string][]>;
  for (const day of WEEKDAYS) {
    out[day] = week[day].map((r) => [r.start, r.end] as [string, string]);
  }
  return out;
}

/** Deep clone of a week so the editor mutates a local copy, never the prop. */
function cloneWeek(week: WeekAvailability): WeekAvailability {
  const out = {} as WeekAvailability;
  for (const day of WEEKDAYS) out[day] = week[day].map((r) => ({ ...r }));
  return out;
}

// ───────────────────────── component ─────────────────────────

export function InstructorsView({ instructors }: { instructors: AdminInstructor[] }) {
  const { t } = useAdminLang();
  const [editId, setEditId] = useState<string | null>(null);
  // The instructor whose name/tag form is open: "new" = the add form, or an id =
  // edit prefilled, or null = closed. (Distinct from editId, which is availability.)
  const [formFor, setFormFor] = useState<"new" | string | null>(null);
  // The instructor pending a remove confirmation, or null.
  const [removing, setRemoving] = useState<AdminInstructor | null>(null);
  const [toast, setToast] = useState<StrKey | null>(null);

  const editing = instructors.find((i) => i.id === editId) ?? null;
  const formInstructor =
    formFor && formFor !== "new" ? (instructors.find((i) => i.id === formFor) ?? null) : null;

  function flash(key: StrKey) {
    setToast(key);
    window.setTimeout(() => setToast(null), 3200);
  }

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
            {t("admin_instructors")}
          </h1>
          <p className="mt-1 font-body text-[13.5px] text-muted">{t("instr_today_long")}</p>
        </div>
        <button
          type="button"
          onClick={() => setFormFor("new")}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 font-body text-[13.5px] font-semibold text-cream"
        >
          <PlusSmall />
          {t("add_instructor")}
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

      {/* responsive card grid (1 col mobile → 2/3 cols wider) */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {instructors.map((ins) => (
          <InstructorCard
            key={ins.id}
            ins={ins}
            onEditAvail={() => setEditId(ins.id)}
            onEditDetails={() => setFormFor(ins.id)}
            onRemove={() => setRemoving(ins)}
          />
        ))}
      </div>

      {/* weekly availability editor */}
      <AvailabilityDrawer
        open={editing !== null}
        instructor={editing}
        onClose={() => setEditId(null)}
      />

      {/* add / edit details form */}
      <InstructorFormDrawer
        open={formFor !== null}
        instructor={formInstructor}
        onClose={() => setFormFor(null)}
        onSaved={(key) => {
          setFormFor(null);
          flash(key);
        }}
      />

      {/* remove confirmation */}
      <RemoveInstructorDrawer
        instructor={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          flash("toast_instructor_removed");
        }}
      />
    </div>
  );
}

// ───────────────────────── instructor card ─────────────────────────

function InstructorCard({
  ins,
  onEditAvail,
  onEditDetails,
  onRemove,
}: {
  ins: AdminInstructor;
  onEditAvail: () => void;
  onEditDetails: () => void;
  onRemove: () => void;
}) {
  const { t, tt } = useAdminLang();

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface-2 p-4 shadow-soft">
      {/* avatar + name + badge */}
      <div className="mb-3.5 flex items-center gap-3">
        <Avatar name={tt(ins.name)} seed={ins.id} initials={ins.initials} size={46} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-head text-[17px] font-semibold text-ink">{tt(ins.name)}</p>
          <p className="mt-0.5 font-body text-[12.5px] text-muted">
            {t("instr_card_sub")
              .replace("{classes}", String(ins.classCount))
              .replace("{attendees}", String(ins.attendees))}
          </p>
        </div>
        {/* edit details + remove (icon controls), then the availability badge */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEditDetails}
            aria-label={t("edit_instructor_a11y").replace("{name}", tt(ins.name))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:bg-cream-2"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={t("remove_instructor_a11y").replace("{name}", tt(ins.name))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[#a56a52] transition-colors hover:bg-rose/10"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* availability badge */}
      <div className="mb-3.5">
        <Badge tone={ins.offToday ? "rose" : "green"}>
          {t(ins.offToday ? "day_off" : "available")}
        </Badge>
      </div>

      {/* today's availability range chips */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="font-body text-[11.5px] font-semibold text-muted">{t("avail_today")}</span>
        {ins.offToday ? (
          <span className="font-body text-[13px] text-muted">— {t("day_off")}</span>
        ) : (
          ins.todayAvailability.map((rg, i) => <RangeChip key={i} range={rg} />)
        )}
      </div>

      {/* today's classes */}
      {ins.todaysClasses.length === 0 ? (
        <div className="rounded-xl bg-cream-2 px-4 py-[18px] text-center font-body text-[13px] text-muted">
          {t("no_classes_today")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {ins.todaysClasses.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5"
            >
              <span className="w-11 shrink-0 font-head text-[14.5px] font-bold text-ink tabular-nums">
                {c.time}
              </span>
              <Dot type={c.type} size={7} />
              <span className="min-w-0 flex-1 truncate font-body text-[13.5px] font-semibold text-ink">
                {tt(c.typeMeta.short)}
              </span>
              <span className="shrink-0 font-body text-[12.5px] text-muted tabular-nums">
                {c.booked}/{c.capacity}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* edit availability */}
      <button
        type="button"
        onClick={onEditAvail}
        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line-strong font-body text-[13.5px] font-semibold text-ink transition-colors hover:bg-cream-2"
      >
        <CalendarIcon />
        {t("edit_avail")}
      </button>
    </div>
  );
}

/** A sage availability range pill with a clock icon (e.g. "07:00–13:00"). */
function RangeChip({ range }: { range: AvailabilityRange }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/15 px-2.5 py-1 font-body text-[12.5px] font-semibold text-sage-deep tabular-nums">
      <ClockIcon />
      {range.start}–{range.end}
    </span>
  );
}

// ───────────────────────── weekly availability editor ─────────────────────────

function AvailabilityDrawer({
  open,
  instructor,
  onClose,
}: {
  open: boolean;
  instructor: AdminInstructor | null;
  onClose: () => void;
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [week, setWeek] = useState<WeekAvailability | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  // Deep-clone the instructor's week into local editable state when the drawer opens
  // (or the target instructor changes). Reset the error each time.
  useEffect(() => {
    if (instructor) {
      setWeek(cloneWeek(instructor.weekAvailability));
      setErrorKey(null);
    }
  }, [instructor]);

  function toggleDay(day: Weekday) {
    setWeek((w) =>
      w ? { ...w, [day]: w[day].length ? [] : [{ ...SEED_RANGE }] } : w,
    );
  }
  function addRange(day: Weekday) {
    setWeek((w) => {
      if (!w) return w;
      const existing = w[day];
      // Start from the prototype's cycle position, but skip presets that would
      // overlap an existing range so an ordinary add can't create an unsaveable day.
      const start = existing.length % PRESETS.length;
      let pick = PRESETS[start]!;
      for (let k = 0; k < PRESETS.length; k++) {
        const cand = PRESETS[(start + k) % PRESETS.length]!;
        if (!existing.some((r) => rangesOverlap(cand, r))) {
          pick = cand;
          break;
        }
      }
      return { ...w, [day]: [...existing, { ...pick }] };
    });
  }
  function removeRange(day: Weekday, idx: number) {
    setWeek((w) => (w ? { ...w, [day]: w[day].filter((_, i) => i !== idx) } : w));
  }

  // Days whose ranges overlap — the editor blocks Save on these (matching the
  // server's own rejection) and names them so the fix is obvious.
  const overlapDays: Weekday[] = week
    ? WEEKDAYS.filter((day) => dayHasOverlap(week[day]))
    : [];

  function save() {
    if (!instructor || !week || overlapDays.length > 0) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await setInstructorAvailability({
        instructorId: instructor.id,
        week: toActionWeek(week),
      });
      if (!res.ok) {
        setErrorKey(saveErrorKey(res.code));
        return;
      }
      onClose();
      router.refresh();
    });
  }

  const footer = (
    <button
      type="button"
      onClick={save}
      disabled={pending || !week || overlapDays.length > 0}
      className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
    >
      <Check />
      {t("save")}
    </button>
  );

  return (
    <Drawer open={open} onClose={onClose} title={t("edit_avail")} footer={footer}>
      {instructor && week && (
        <>
          {/* instructor header */}
          <div className="mb-[18px] flex items-center gap-3">
            <Avatar
              name={tt(instructor.name)}
              seed={instructor.id}
              initials={instructor.initials}
              size={42}
            />
            <div className="min-w-0">
              <p className="truncate font-head text-xl font-semibold text-ink">
                {tt(instructor.name)}
              </p>
              <p className="font-body text-[12.5px] text-muted">{t("edit_avail_sub")}</p>
            </div>
          </div>

          {/* 7 day rows */}
          <div className="flex flex-col gap-2.5">
            {WEEKDAYS.map((day) => {
              const ranges = week[day];
              const off = ranges.length === 0;
              const dayLabel = t(DAY_KEY[day]);
              return (
                <div
                  key={day}
                  className={`rounded-2xl border border-line px-3.5 py-3 ${
                    off ? "bg-transparent" : "bg-surface-2"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-head text-[15px] font-semibold ${
                        off ? "text-muted" : "text-ink"
                      }`}
                    >
                      {dayLabel}
                    </span>
                    <DayToggle
                      on={!off}
                      label={t("day_on_off").replace("{day}", dayLabel)}
                      onToggle={() => toggleDay(day)}
                    />
                  </div>

                  {!off && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {ranges.map((rg, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-full bg-sage/15 py-1.5 pl-3 pr-2 font-body text-[12.5px] font-semibold text-sage-deep tabular-nums"
                        >
                          {rg.start}–{rg.end}
                          <button
                            type="button"
                            onClick={() => removeRange(day, i)}
                            aria-label={t("remove_range")}
                            className="flex items-center text-sage-deep"
                          >
                            <XIcon />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => addRange(day)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-3 py-1.5 font-body text-[12.5px] font-semibold text-ink-soft"
                      >
                        <PlusSmall />
                        {t("add_hours")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* A client-detected overlap takes precedence (Save is blocked on it); the
              named days make the fix obvious. Falls back to the server error code. */}
          {(overlapDays.length > 0 || errorKey) && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]"
            >
              {overlapDays.length > 0
                ? `${t("err_avail_overlap")} ${overlapDays.map((d) => t(DAY_KEY[d])).join(", ")}`
                : t(errorKey!)}
            </p>
          )}
        </>
      )}
    </Drawer>
  );
}

/** Sage on/off switch for a day row (mirrors the prototype's toggle). */
function DayToggle({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-[27px] w-[46px] shrink-0 rounded-full transition-colors ${
        on ? "bg-sage" : "bg-cream-2"
      }`}
    >
      <span
        className="absolute top-[3px] h-[21px] w-[21px] rounded-full bg-white shadow transition-[left]"
        style={{ left: on ? 22 : 3 }}
      />
    </button>
  );
}

// ───────────────────────── add / edit details drawer ─────────────────────────

/** Add a new instructor (instructor === null) or rename an existing one. Shares one
 *  form: name (EN), nameTh (TH), optional tag. On success refreshes + toasts. */
function InstructorFormDrawer({
  open,
  instructor,
  onClose,
  onSaved,
}: {
  open: boolean;
  instructor: AdminInstructor | null;
  onClose: () => void;
  onSaved: (toastKey: StrKey) => void;
}) {
  const { t } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [nameTh, setNameTh] = useState("");
  const [tag, setTag] = useState("");
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  const isEdit = instructor !== null;

  // Prefill from the target instructor's RAW editable fields when (re)opening; clear
  // for the add form. Reset the error each time.
  useEffect(() => {
    if (!open) return;
    setName(instructor?.nameEn ?? "");
    setNameTh(instructor?.nameRawTh ?? "");
    setTag(instructor?.tagRaw ?? "");
    setErrorKey(null);
  }, [open, instructor]);

  const canSave = !pending && name.trim().length > 0 && nameTh.trim().length > 0;

  function save() {
    if (!canSave) return;
    setErrorKey(null);
    const tagValue = tag.trim() ? tag.trim() : undefined;
    startTransition(async () => {
      const res = isEdit
        ? await updateInstructor({ id: instructor!.id, name: name.trim(), nameTh: nameTh.trim(), tag: tagValue })
        : await createInstructor({ name: name.trim(), nameTh: nameTh.trim(), tag: tagValue });
      if (res.ok) {
        onSaved(isEdit ? "toast_instructor_updated" : "toast_instructor_added");
        router.refresh();
      } else {
        setErrorKey(crudErrorKey(res.code));
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
        disabled={!canSave}
        className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-ink px-5 font-body text-sm font-semibold text-cream disabled:opacity-50"
      >
        {t("save_instructor")}
      </button>
    </>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t(isEdit ? "edit_instructor" : "add_instructor_title")}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {errorKey && (
          <div
            role="alert"
            className="rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]"
          >
            {t(errorKey)}
          </div>
        )}

        <Field label={t("instr_name_en")}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("ph_instr_name_en")}
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink placeholder:text-muted"
          />
        </Field>

        <Field label={t("instr_name_th")}>
          <input
            value={nameTh}
            onChange={(e) => setNameTh(e.target.value)}
            placeholder={t("ph_instr_name_th")}
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink placeholder:text-muted"
          />
        </Field>

        <Field label={t("instr_tag")}>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder={t("ph_instr_tag")}
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-body text-sm text-ink placeholder:text-muted"
          />
        </Field>
      </div>
    </Drawer>
  );
}

// ───────────────────────── remove confirmation drawer ─────────────────────────

/** Confirm a SOFT remove (setInstructorActive active=false): the card drops out of
 *  the active list; past classes & availability are kept (server-side). */
function RemoveInstructorDrawer({
  instructor,
  onClose,
  onRemoved,
}: {
  instructor: AdminInstructor | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { t, tt } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  useEffect(() => {
    if (instructor) setErrorKey(null);
  }, [instructor]);

  function confirm() {
    if (!instructor) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await setInstructorActive({ id: instructor.id, active: false });
      if (res.ok) {
        onRemoved();
        router.refresh();
      } else {
        setErrorKey(res.code === "UNKNOWN_INSTRUCTOR" ? "err_unknown_instructor" : "err_instr_remove");
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
        {t("confirm_remove")}
      </button>
    </>
  );

  return (
    <Drawer
      open={instructor !== null}
      onClose={onClose}
      title={t("remove_instructor")}
      footer={footer}
    >
      {instructor && (
        <div className="flex flex-col gap-4">
          <p className="font-body text-[14px] leading-relaxed text-ink">
            {t("remove_instructor_confirm").replace("{name}", tt(instructor.name))}
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

/** A labelled form field wrapper (mirrors members-view.tsx Field). */
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

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
