"use client";

// Settings → Studio info editor. A flat bilingual form over the single
// `studio_settings` row. Conventions mirror visibility-view.tsx / the terms editor:
// useTransition + router.refresh() after the write, a transient keyed toast, and a
// failure-code → StrKey mapper so no server error is swallowed.
//
// The map link is validated server-side as an http(s) URL before it is stored — the
// client-side check here is only for instant feedback (CLAUDE.md §8).

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import {
  updateStudioInfo,
  type UpdateStudioInfoFailureCode,
} from "@/app/actions/admin-settings";
import type { StudioInfo } from "@/lib/settings/studio";
import type { StrKey } from "@/lib/i18n";

function saveErrorKey(code: UpdateStudioInfoFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_settings_unauthorized";
    case "INVALID_INPUT":
      return "err_studio_invalid";
    case "MOCK_NO_DB":
      return "err_settings_mock_no_db";
    default:
      return "err_studio_save";
  }
}

export function StudioInfoView({ info }: { info: StudioInfo }) {
  const { t } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [nameEn, setNameEn] = useState(info.name.en);
  const [nameTh, setNameTh] = useState(info.name.th);
  const [addressEn, setAddressEn] = useState(info.address.en);
  const [addressTh, setAddressTh] = useState(info.address.th);
  const [phone, setPhone] = useState(info.phone);
  const [mapUrl, setMapUrl] = useState(info.mapUrl ?? "");
  const [hoursEn, setHoursEn] = useState(info.hours.en);
  const [hoursTh, setHoursTh] = useState(info.hours.th);

  const [toast, setToast] = useState<StrKey | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  // Mirrors the server's gate: a name in both languages, and a map link that is
  // either empty or an http(s) URL.
  const mapUrlOk = mapUrl.trim() === "" || /^https?:\/\/\S+$/i.test(mapUrl.trim());
  const valid = nameEn.trim().length > 0 && nameTh.trim().length > 0 && mapUrlOk;

  function flash(key: StrKey) {
    setToast(key);
    window.setTimeout(() => setToast(null), 3200);
  }

  function onSave() {
    setErrorKey(null);
    if (!valid) {
      setErrorKey("err_studio_invalid");
      return;
    }
    startTransition(async () => {
      try {
        const res = await updateStudioInfo({
          nameEn: nameEn.trim(),
          nameTh: nameTh.trim(),
          addressEn: addressEn.trim(),
          addressTh: addressTh.trim(),
          phone: phone.trim(),
          mapUrl: mapUrl.trim(),
          hoursEn: hoursEn.trim(),
          hoursTh: hoursTh.trim(),
        });
        if (res.ok) {
          flash("studio_saved");
          router.refresh();
        } else {
          setErrorKey(saveErrorKey(res.code));
        }
      } catch {
        setErrorKey("err_studio_save");
      }
    });
  }

  return (
    <div>
      <div className="mb-5 max-w-2xl">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("settings_studio_title")}
        </h1>
        <p className="mt-1 font-body text-[13.5px] leading-relaxed text-muted">
          {t("settings_studio_desc")}
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

      <div className="flex max-w-2xl flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("studio_name_en")} value={nameEn} onChange={setNameEn} disabled={pending} />
          <Field label={t("studio_name_th")} value={nameTh} onChange={setNameTh} disabled={pending} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("studio_address_en")}
            value={addressEn}
            onChange={setAddressEn}
            disabled={pending}
            multiline
          />
          <Field
            label={t("studio_address_th")}
            value={addressTh}
            onChange={setAddressTh}
            disabled={pending}
            multiline
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("studio_phone")}
            value={phone}
            onChange={setPhone}
            disabled={pending}
            inputMode="tel"
          />
          <Field
            label={t("studio_map_url")}
            value={mapUrl}
            onChange={setMapUrl}
            disabled={pending}
            hint={t("studio_map_url_hint")}
            invalid={!mapUrlOk}
            inputMode="url"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("studio_hours_en")} value={hoursEn} onChange={setHoursEn} disabled={pending} />
          <Field label={t("studio_hours_th")} value={hoursTh} onChange={setHoursTh} disabled={pending} />
        </div>

        {errorKey && (
          <p role="alert" className="m-0 font-body text-[12.5px] text-rose">
            {t(errorKey)}
          </p>
        )}

        <div>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !valid}
            className="h-11 rounded-xl bg-ink px-5 font-body text-[14px] font-semibold text-cream transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted"
          >
            {t("studio_save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  hint,
  invalid,
  multiline,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  hint?: string;
  invalid?: boolean;
  multiline?: boolean;
  inputMode?: "tel" | "url";
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const cls = `w-full rounded-xl border bg-surface px-3.5 py-2.5 font-body text-[13.5px] text-ink outline-none focus:border-taupe disabled:opacity-60 ${
    invalid ? "border-rose" : "border-line"
  }`;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-body text-[12px] font-semibold uppercase tracking-[0.08em] text-muted"
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={invalid || undefined}
          className={cls}
        />
      ) : (
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={invalid || undefined}
          className={cls}
        />
      )}
      {hint && (
        <p id={hintId} className="mt-1 font-body text-[11.5px] leading-snug text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
