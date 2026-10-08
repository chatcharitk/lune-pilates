"use client";

// The front desk attaches a transfer slip for a customer and approves it in one
// step (2026-10-08) — used on the counter sale's QR step and on an unpaid sale's
// detail drawer. Picking a file only previews it; the button sends it to
// attachSlipAndApprove, which stores it like a customer upload and credits the
// package through the normal approve path.

import { useId, useState, useTransition } from "react";
import { useAdminLang } from "./admin-context";
import {
  attachSlipAndApprove,
  type AttachSlipFailureCode,
  type ApproveSlipReceipt,
} from "@/app/actions/admin-payments";
import { SLIP_ACCEPT, SLIP_ALLOWED_TYPES, SLIP_MAX_BYTES, slipToUploadDataUrl } from "@/lib/payments/slip-file";
import type { StrKey } from "@/lib/i18n";

function errorKeyFor(code: AttachSlipFailureCode): StrKey {
  switch (code) {
    case "INVALID_FILE":
      return "err_invalid_file";
    case "TOO_LARGE":
      return "err_too_large";
    case "NOT_PAYABLE":
      return "err_not_payable";
    default:
      return "err_generic";
  }
}

export function SlipAttach({
  chargeId,
  onApproved,
}: {
  chargeId: string;
  onApproved: (receipt: ApproveSlipReceipt) => void;
}) {
  const { t } = useAdminLang();
  const inputId = useId();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  const [pending, startTransition] = useTransition();

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setErrorKey(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // re-picking the same file still fires change
    if (!file) return;
    // Instant feedback only; the server re-checks the real bytes.
    if (!SLIP_ALLOWED_TYPES.includes(file.type)) return setErrorKey("err_invalid_file");
    if (file.size > SLIP_MAX_BYTES) return setErrorKey("err_too_large");
    try {
      setDataUrl(await slipToUploadDataUrl(file));
    } catch {
      setErrorKey("err_invalid_file");
    }
  }

  function submit() {
    if (!dataUrl || pending) return;
    setErrorKey(null);
    startTransition(async () => {
      const res = await attachSlipAndApprove({ chargeId, slipDataUrl: dataUrl });
      if (res.ok) onApproved(res.receipt);
      else setErrorKey(errorKeyFor(res.code));
    });
  }

  return (
    <div className="w-full rounded-2xl border border-line bg-surface-2 p-4 text-left">
      <p className="font-body text-sm font-semibold text-ink">{t("slip_attach_title")}</p>
      <p className="mt-1 font-body text-[12.5px] leading-relaxed text-muted">{t("slip_attach_hint")}</p>

      <label
        htmlFor={inputId}
        className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-line-strong bg-surface px-4 py-3 font-body text-[13.5px] font-semibold text-ink-soft transition-colors hover:border-taupe"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
        </svg>
        {dataUrl ? t("slip_attach_change") : t("slip_attach_choose")}
        <input id={inputId} type="file" accept={SLIP_ACCEPT} onChange={onPick} className="sr-only" />
      </label>

      {dataUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a local data URL preview
        <img
          src={dataUrl}
          alt={t("payment_slip")}
          className="mx-auto mt-3 max-h-[260px] w-auto rounded-xl border border-line bg-white object-contain"
        />
      )}

      {errorKey && (
        <p role="alert" className="mt-3 rounded-xl bg-rose/15 px-3.5 py-2.5 font-body text-[13px] font-medium text-[#a56a52]">
          {t(errorKey)}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!dataUrl || pending}
        className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-ink px-4 font-body text-sm font-semibold text-cream disabled:opacity-40"
      >
        {pending ? t("loading") : t("slip_attach_confirm")}
      </button>
    </div>
  );
}
