"use client";

// Settings → Terms & Conditions editor. Two textareas (EN + TH) seeded from the
// ACTIVE version, a publish button, and the version history.
//
// Publishing APPENDS a new version — it never edits the one on screen. That is the
// whole point of the model (see the `terms_versions` doc in lib/db/schema.ts): every
// past purchase keeps a pointer to the exact text its customer accepted, so a
// rewrite here cannot retroactively change what anyone agreed to. The note above the
// form says so in the owner's own language, because it is a genuinely surprising
// property of a "save" button.
//
// Conventions mirror visibility-view.tsx: useTransition + router.refresh() after a
// write, a transient keyed toast, and a failure-code → StrKey mapper so no server
// error is ever swallowed.

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAdminLang } from "./admin-context";
import { publishTerms, type PublishTermsFailureCode } from "@/app/actions/admin-settings";
import { formatStudioDate } from "@/lib/time";
import type { StrKey } from "@/lib/i18n";

export interface ActiveTermsProps {
  version: number;
  bodyEn: string;
  bodyTh: string;
  publishedAtIso: string;
}

export interface TermsHistoryEntry {
  id: string;
  version: number;
  publishedAtIso: string;
}

function publishErrorKey(code: PublishTermsFailureCode): StrKey {
  switch (code) {
    case "UNAUTHORIZED":
      return "err_settings_unauthorized";
    case "INVALID_INPUT":
      return "err_terms_empty";
    case "UNCHANGED":
      return "err_terms_unchanged";
    case "MOCK_NO_DB":
      return "err_settings_mock_no_db";
    default:
      return "err_terms_save";
  }
}

export function TermsEditorView({
  active,
  history,
}: {
  active: ActiveTermsProps;
  history: TermsHistoryEntry[];
}) {
  const { t, lang } = useAdminLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [bodyEn, setBodyEn] = useState(active.bodyEn);
  const [bodyTh, setBodyTh] = useState(active.bodyTh);
  const [toast, setToast] = useState<StrKey | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);

  const enId = useId();
  const thId = useId();

  // Nothing to publish until the text actually differs from the active version —
  // the server enforces this too (UNCHANGED), this just avoids a pointless round trip.
  const dirty = bodyEn.trim() !== active.bodyEn.trim() || bodyTh.trim() !== active.bodyTh.trim();
  const filled = bodyEn.trim().length > 0 && bodyTh.trim().length > 0;

  function flash(key: StrKey) {
    setToast(key);
    window.setTimeout(() => setToast(null), 3200);
  }

  function onPublish() {
    setErrorKey(null);
    startTransition(async () => {
      try {
        const res = await publishTerms({ bodyEn: bodyEn.trim(), bodyTh: bodyTh.trim() });
        if (res.ok) {
          flash("terms_published");
          router.refresh();
        } else {
          setErrorKey(publishErrorKey(res.code));
        }
      } catch {
        setErrorKey("err_terms_save");
      }
    });
  }

  return (
    <div>
      <div className="mb-5 max-w-2xl">
        <h1 className="font-head text-2xl font-semibold tracking-tight text-ink">
          {t("settings_terms_title")}
        </h1>
        <p className="mt-1 font-body text-[13.5px] leading-relaxed text-muted">
          {t("settings_terms_desc")}
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

      {/* the append-only guarantee, stated where the owner is about to publish */}
      <div className="mb-5 max-w-2xl rounded-xl border border-line bg-cream-2 px-4 py-3">
        <p className="m-0 font-body text-[12.5px] leading-relaxed text-ink-soft">
          {t("terms_editor_note")}
        </p>
        <p className="m-0 mt-2 font-body text-[12px] text-muted">
          {t("terms_active_version")}: <span className="font-semibold text-ink">v{active.version}</span>{" "}
          · {formatStudioDate(new Date(active.publishedAtIso), lang, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="flex max-w-2xl flex-col gap-4">
        <TermsField
          id={enId}
          label={t("terms_body_en")}
          value={bodyEn}
          onChange={setBodyEn}
          disabled={pending}
        />
        <TermsField
          id={thId}
          label={t("terms_body_th")}
          value={bodyTh}
          onChange={setBodyTh}
          disabled={pending}
        />

        {errorKey && (
          <p role="alert" className="m-0 font-body text-[12.5px] text-rose">
            {t(errorKey)}
          </p>
        )}

        <div>
          <button
            type="button"
            onClick={onPublish}
            disabled={pending || !dirty || !filled}
            className="h-11 rounded-xl bg-ink px-5 font-body text-[14px] font-semibold text-cream transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted"
          >
            {pending ? t("terms_publishing") : t("terms_publish")}
          </button>
        </div>
      </div>

      {/* version history — the audit trail of what customers were bound to */}
      <section className="mt-8 max-w-2xl">
        <h2 className="font-head text-[17px] font-semibold text-ink">{t("terms_history")}</h2>
        {history.length === 0 ? (
          <p className="mt-2 font-body text-[13px] text-muted">{t("terms_history_empty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {history.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3"
              >
                <span className="font-body text-[13.5px] font-semibold text-ink tabular-nums">
                  v{v.version}
                </span>
                <span className="font-body text-[12.5px] text-muted">
                  {formatStudioDate(new Date(v.publishedAtIso), lang, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TermsField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-body text-[12px] font-semibold uppercase tracking-[0.08em] text-muted"
      >
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={14}
        className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 font-body text-[13px] leading-[1.65] text-ink outline-none focus:border-taupe disabled:opacity-60"
      />
    </div>
  );
}
