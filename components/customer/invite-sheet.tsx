"use client";

// The household-invite sheet (Feature 2: เชิญคนในบ้าน). A focus-trapped,
// Escape-dismissable dialog opened from the Profile "Shared with" tile. On open it
// calls the server action createInvite() (identity is server-resolved — the client
// supplies nothing trust-bearing), then renders the share link in a read-only,
// selectable field with two actions: "Share via LINE" (opens the prebuilt LINE
// share-intent URL) and "Copy link" (clipboard → "Copied" state), plus the 7-day
// expiry note.
//
// Mirrors the customer Sheet chrome in cancel-sheet.tsx / checkout-panel.tsx
// (slide-up, backdrop, Escape-to-close, focus trap, focus restore). It never
// computes the token, link, or policy itself — all surfaces come from the backend.

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  createInvite,
  type CreateInviteFailureCode,
} from "@/app/actions/household";
import { makeT, type Lang } from "@/lib/i18n";
import type { StrKey } from "@/lib/i18n/strings";
import { Check, Copy, Info, Share } from "./icons";

/** The link lifetime in days — shown to the user; kept in sync with the backend TTL. */
const INVITE_TTL_DAYS = 7;

// Lets a step component label the dialog via the sheet's generated id.
const SheetTitleContext = createContext<string>("");

type Phase = "loading" | "ready" | "error";

/** Map a create-invite failure code to friendly, keyed copy. */
function createErrorKey(code: CreateInviteFailureCode): StrKey {
  switch (code) {
    case "NOT_A_MEMBER":
      return "invite_err_not_a_member";
    case "NO_HOUSEHOLD":
      return "invite_err_no_household";
    default:
      return "invite_err_no_household";
  }
}

export function InviteSheet({
  lang,
  houseNumber,
  open,
  onClose,
}: {
  lang: Lang;
  houseNumber: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      {open && <InviteContent lang={lang} houseNumber={houseNumber} />}
    </Sheet>
  );
}

// ───────────────────────── invite content (link + share actions) ─────────────────────────

function InviteContent({
  lang,
  houseNumber,
}: {
  lang: Lang;
  houseNumber: string | null;
}) {
  const { t } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [url, setUrl] = useState("");
  const [lineShareUrl, setLineShareUrl] = useState("");
  const [failCode, setFailCode] = useState<CreateInviteFailureCode | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Generate the link once when the sheet opens. AbortController-style guard so a
  // late resolve after close can't set state on an unmounted tree.
  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setFailCode(null);
    setCopied(false);
    createInvite().then((res) => {
      if (!alive) return;
      if (res.ok) {
        setUrl(res.url);
        setLineShareUrl(res.lineShareUrl);
        setPhase("ready");
      } else {
        setFailCode(res.code);
        setPhase("error");
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions) — the read-only field
      // stays selectable so the user can copy manually.
    }
  }

  const bodyText = t("invite_sheet_body").replace("{house}", houseNumber ?? "—");

  return (
    <div>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 mt-1.5 font-head text-[26px] font-semibold tracking-[0.01em] text-ink outline-none"
      >
        {t("invite_sheet_title")}
      </h2>

      {phase === "error" && failCode ? (
        <div
          role="alert"
          className="mt-2 flex items-start gap-3 rounded-lune-sm border border-rose/40 bg-rose/10 px-4 py-3.5"
        >
          <span className="mt-0.5 shrink-0 text-rose">
            <Info size={18} />
          </span>
          <p className="font-body text-[13.5px] leading-snug text-ink">
            {t(createErrorKey(failCode))}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-4 font-body text-[13.5px] leading-[1.55] text-ink-soft">
            {bodyText}
          </p>

          {/* read-only, selectable link field */}
          <label htmlFor="invite-link" className="sr-only">
            {t("invite_link_label")}
          </label>
          <input
            id="invite-link"
            type="text"
            readOnly
            value={phase === "loading" ? t("invite_generating") : url}
            aria-busy={phase === "loading"}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full select-all truncate rounded-lune-sm border border-line bg-surface-2 px-4 py-3.5 font-body text-[13.5px] text-ink-soft shadow-soft outline-none focus:border-line-strong"
          />

          {/* expiry note */}
          <p className="mt-2.5 flex items-center gap-1.5 font-body text-[12px] text-muted">
            <Info size={14} />
            {t("invite_expires_in").replace("{days}", String(INVITE_TTL_DAYS))}
          </p>

          {/* primary: share via LINE */}
          <button
            type="button"
            onClick={() => window.open(lineShareUrl, "_blank", "noopener,noreferrer")}
            disabled={phase !== "ready"}
            className="mt-[18px] flex h-14 w-full items-center justify-center gap-2 rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none"
          >
            <Share size={18} />
            {t("invite_share_line")}
          </button>

          {/* secondary: copy link */}
          <button
            type="button"
            onClick={copyLink}
            disabled={phase !== "ready"}
            aria-live="polite"
            className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 font-body text-[14.5px] font-bold text-ink transition-colors disabled:text-muted"
          >
            {copied ? (
              <>
                <Check size={17} className="text-sage-deep" />
                <span className="text-sage-deep">{t("invite_copied")}</span>
              </>
            ) : (
              <>
                <Copy size={17} />
                {t("invite_copy_link")}
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

// ───────────────────────── sheet chrome (focus-trapped dialog) ─────────────────────────
// Mirrors the Sheet in cancel-sheet.tsx / checkout-panel.tsx: slide-up animation,
// backdrop, Escape-to-close, focus trap, and focus restore to the trigger on close.

function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement | null;
      setRender(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)));
      return () => cancelAnimationFrame(r);
    }
    setShow(false);
    const tm = setTimeout(() => setRender(false), 300);
    return () => clearTimeout(tm);
  }, [open]);

  useEffect(() => {
    if (!render && prevFocus.current) {
      prevFocus.current.focus?.();
      prevFocus.current = null;
    }
  }, [render]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-[200] mx-auto flex max-w-[440px] flex-col justify-end">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default transition-opacity duration-300"
        style={{
          background: "rgba(40,32,24,0.34)",
          opacity: show ? 1 : 0,
          backdropFilter: "blur(2px)",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[88%] flex-col overflow-hidden bg-surface"
        style={{
          borderRadius: "30px 30px 0 0",
          transform: show ? "translateY(0)" : "translateY(101%)",
          transition: "transform .34s cubic-bezier(.32,.72,0,1)",
          boxShadow: "0 -20px 60px rgba(40,32,24,0.25)",
        }}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-3">
          <span className="h-[5px] w-10 rounded-full bg-line-strong" />
        </div>
        <div className="overflow-y-auto px-[22px] pb-[30px] pt-2">
          <SheetTitleContext.Provider value={titleId}>{children}</SheetTitleContext.Provider>
        </div>
      </div>
    </div>
  );
}
