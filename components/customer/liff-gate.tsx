"use client";

// Customer login gate for LINE_MODE=live. Rendered full-screen (no app chrome) by
// the customer layout whenever there is no valid session cookie. It drives the LIFF
// handshake entirely client-side (the SDK is browser-only):
//   1. liff.init — if NOT opened inside the LINE app, show the "Open in LINE" screen
//      (owner's decision) and stop.
//   2. in LINE but not logged in → liff.login() (redirects within LINE).
//   3. logged in → send the ID token to establishLineSession:
//        signed_in  → reload; the layout now renders the app.
//        needs_phone → show the phone-match screen → linkLineByPhone → reload.
//
// The ID token is verified SERVER-SIDE; nothing here is trusted for identity.

import { useEffect, useRef, useState } from "react";
import { useCustomerLang } from "./customer-context";
import { establishLineSession, linkLineByPhone } from "@/app/actions/line-auth";
import type { StrKey } from "@/lib/i18n";

type GateState = "loading" | "open_in_line" | "phone" | "error";

export function LiffGate({ liffId }: { liffId: string }) {
  const { t } = useCustomerLang();
  const [state, setState] = useState<GateState>("loading");
  const [phone, setPhone] = useState("");
  const [phoneErr, setPhoneErr] = useState<StrKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });
        if (!alive) return;
        if (!liff.isInClient()) {
          setState("open_in_line");
          return;
        }
        if (!liff.isLoggedIn()) {
          liff.login(); // redirects within LINE, then re-mounts this gate
          return;
        }
        const idToken = liff.getIDToken();
        if (!idToken) {
          setState("error");
          return;
        }
        idTokenRef.current = idToken;
        const res = await establishLineSession({ idToken });
        if (!alive) return;
        if (res.ok && res.status === "signed_in") {
          window.location.reload();
          return;
        }
        if (res.ok && res.status === "needs_phone") {
          setState("phone");
          return;
        }
        setState("error");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [liffId]);

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !idTokenRef.current) return;
    setPhoneErr(null);
    setSubmitting(true);
    const res = await linkLineByPhone({ idToken: idTokenRef.current, phone });
    if (res.ok) {
      window.location.reload();
      return;
    }
    setSubmitting(false);
    setPhoneErr(res.code === "PHONE_TAKEN" ? "liff_phone_taken" : "liff_phone_invalid");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-cream px-6 py-10">
      <div className="w-full max-w-[360px] text-center">
        <span className="font-brand text-4xl font-semibold tracking-[0.18em] text-taupe-deep">
          LUN<span className="lune-spark">E</span>
        </span>

        {state === "loading" && (
          <p className="mt-8 font-body text-sm text-muted">{t("liff_loading")}</p>
        )}

        {state === "open_in_line" && (
          <div className="mt-6">
            <h1 className="font-head text-lg font-semibold text-ink">{t("liff_open_in_line_title")}</h1>
            <p className="mt-2 font-body text-[14px] leading-relaxed text-ink-soft">
              {t("liff_open_in_line_body")}
            </p>
            <a
              href={`https://liff.line.me/${liffId}`}
              className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-[#06C755] px-6 font-body text-[15px] font-semibold text-white"
            >
              {t("liff_open_in_line_button")}
            </a>
          </div>
        )}

        {state === "phone" && (
          <form onSubmit={submitPhone} className="mt-6 text-left">
            <h1 className="text-center font-head text-lg font-semibold text-ink">
              {t("liff_phone_title")}
            </h1>
            <p className="mt-2 text-center font-body text-[13.5px] leading-relaxed text-ink-soft">
              {t("liff_phone_body")}
            </p>
            <label className="mt-5 block">
              <span className="mb-1.5 block font-body text-[13px] font-medium text-ink-soft">
                {t("liff_phone_label")}
              </span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("liff_phone_placeholder")}
                disabled={submitting}
                className="h-12 w-full rounded-xl border border-line-strong bg-surface px-4 font-body text-[16px] tabular-nums text-ink outline-none focus:border-taupe disabled:opacity-60"
              />
            </label>
            {phoneErr && <p className="mt-2 font-body text-[13px] text-rose">{t(phoneErr)}</p>}
            <button
              type="submit"
              disabled={submitting || phone.trim() === ""}
              className="mt-5 h-12 w-full rounded-xl bg-taupe-deep font-body text-[15px] font-semibold text-cream disabled:opacity-50"
            >
              {submitting ? t("liff_loading") : t("liff_phone_submit")}
            </button>
          </form>
        )}

        {state === "error" && (
          <div className="mt-6">
            <p className="font-body text-[14px] text-ink-soft">{t("liff_error")}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex h-11 items-center rounded-xl border border-line-strong bg-surface px-5 font-body text-sm font-semibold text-ink"
            >
              {t("liff_retry")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
