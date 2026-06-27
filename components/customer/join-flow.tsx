"use client";

// Client driver for the household-invite landing (/join/<token>, Feature 2:
// เชิญคนในบ้าน). Calls the acceptInvite(token) server action behind an EXPLICIT
// "Join household" button — never a blind on-mount side-effect — so accepting is a
// deliberate act. Identity is server-resolved inside the action; this component
// only passes the opaque token from the link.
//
// On success it shows "Welcome to House {house}" (the new shared pool) with a CTA
// to /home, and calls router.refresh() so the now-dynamic Profile/Home re-fetch and
// the joiner instantly reads the shared balance (and appears in the inviter's
// "Shared with"). Each failure code maps to a friendly, keyed message.
//
// Bilingual via useCustomerLang(); the shared customer Header is rendered by the
// (customer) layout, so this owns only the screen body.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  acceptInvite,
  type AcceptInviteFailureCode,
} from "@/app/actions/household";
import type { StrKey } from "@/lib/i18n";
import { useCustomerLang } from "./customer-context";
import { Check, Info, Users } from "./icons";

type Phase = "idle" | "accepting" | "done" | "error";

/** Map an accept-invite failure code to friendly, keyed copy. */
function acceptErrorKey(code: AcceptInviteFailureCode): StrKey {
  switch (code) {
    case "INVITE_EXPIRED":
      return "invite_err_expired";
    case "INVITE_ALREADY_USED":
      return "invite_err_used";
    case "INVITE_REVOKED":
      return "invite_err_revoked";
    case "INVITE_NOT_FOUND":
    case "INVALID_INPUT":
      return "invite_err_not_found";
    case "ALREADY_IN_THIS_HOUSEHOLD":
      return "invite_err_already_this_household";
    case "ALREADY_IN_ANOTHER_HOUSEHOLD":
      return "invite_err_already_other_household";
    case "CANNOT_INVITE_SELF":
      return "invite_err_self";
    default:
      return "invite_err_not_found";
  }
}

export function JoinFlow({ token }: { token: string }) {
  const { t } = useCustomerLang();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [houseNumber, setHouseNumber] = useState("");
  const [failCode, setFailCode] = useState<AcceptInviteFailureCode | null>(null);

  async function accept() {
    setPhase("accepting");
    setFailCode(null);
    const res = await acceptInvite({ token });
    if (res.ok) {
      setHouseNumber(res.houseNumber);
      setPhase("done");
      // Profile/Home are force-dynamic — refresh so the new member instantly reads
      // the shared pool and appears in the inviter's "Shared with".
      router.refresh();
    } else {
      setFailCode(res.code);
      setPhase("error");
    }
  }

  // ── success ──
  if (phase === "done") {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center px-[22px] py-8 text-center" aria-live="polite">
        <div
          className="mb-[18px] grid h-[76px] w-[76px] place-items-center rounded-full bg-sage text-white"
          style={{ boxShadow: "0 10px 30px rgba(140,154,126,0.4)" }}
        >
          <Check size={34} strokeWidth={2} />
        </div>
        <h1 className="mb-2 font-head text-[28px] font-semibold text-ink">
          {t("join_success_title").replace("{house}", houseNumber || "—")}
        </h1>
        <p className="mx-auto mb-[26px] max-w-[300px] font-body text-[14px] leading-[1.55] text-ink-soft">
          {t("join_success_body")}
        </p>
        <Link
          href="/home"
          className="flex h-14 w-full max-w-[360px] items-center justify-center rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985]"
        >
          {t("join_cta_home")}
        </Link>
      </div>
    );
  }

  // ── error ──
  if (phase === "error" && failCode) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center px-[22px] py-8 text-center" aria-live="polite">
        <div
          className="mb-[18px] grid h-[76px] w-[76px] place-items-center rounded-full bg-rose text-white"
          style={{ boxShadow: "0 10px 30px rgba(196,154,134,0.4)" }}
        >
          <Info size={34} />
        </div>
        <h1 className="mb-2 font-head text-[28px] font-semibold text-ink">
          {t("join_error_title")}
        </h1>
        <p className="mx-auto mb-[26px] max-w-[300px] font-body text-[14px] leading-[1.55] text-ink-soft">
          {t(acceptErrorKey(failCode))}
        </p>
        <Link
          href="/home"
          className="flex h-14 w-full max-w-[360px] items-center justify-center rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985]"
        >
          {t("join_cta_home")}
        </Link>
      </div>
    );
  }

  // ── idle / accepting — the invitation + explicit accept button ──
  const accepting = phase === "accepting";
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-[22px] py-8 text-center">
      <div className="mb-5 grid h-[72px] w-[72px] place-items-center rounded-full bg-cream-2 text-taupe-deep">
        <Users size={32} />
      </div>
      <h1 className="mb-2.5 font-head text-[28px] font-semibold tracking-[0.01em] text-ink">
        {t("join_title")}
      </h1>
      <p className="mx-auto mb-[28px] max-w-[320px] font-body text-[14px] leading-[1.6] text-ink-soft">
        {t("join_intro")}
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={accepting}
        className="flex h-14 w-full max-w-[360px] items-center justify-center rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none"
      >
        {accepting ? t("join_accepting") : t("join_cta_accept")}
      </button>
    </div>
  );
}
