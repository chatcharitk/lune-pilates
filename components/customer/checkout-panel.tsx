"use client";

// The interactive Buy-credits surface: category tabs, package cards (radio
// selection), the Trial promo, the member-sharing perk, the sticky total + Pay
// CTA, and the PromptPay checkout sheet (QR step → success step).
//
// It renders price/per-hour/validity/hours straight from the backend catalog
// (CatalogCategory[]) and the new balance straight from the confirmPayment
// outcome — it never computes money or balances itself (CLAUDE.md §8). The two
// server actions are the only source of the QR payload, the charged amount, and
// the post-purchase balance.
//
// Accessibility: cards are real radios in a radiogroup; the sheet is a focus-
// trapped dialog that moves focus to each step's heading, closes on Escape, and
// the QR carries a text alternative (amount + reference).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CatalogCategory,
  CatalogItem,
  CatalogTag,
} from "@/lib/catalog/packages";
import type { PackageCategory } from "@/lib/domain/types";
import { useRouter } from "next/navigation";
import {
  createCheckout,
  uploadPaymentSlip,
  confirmPayment,
  type CheckoutSession,
  type UploadPaymentSlipFailureCode,
} from "@/app/actions/purchase";
import { makeT, thb, type Lang, type Bilingual } from "@/lib/i18n";
import type { StrKey } from "@/lib/i18n/strings";
import { useCustomerLang } from "./customer-context";
import {
  ArrowRight,
  Check,
  Clock,
  Info,
  Qr,
  Share,
  Sparkle,
  Pin,
  Upload,
  ImageIcon,
} from "./icons";
import { PromptPayQr, QrDownloadButton } from "./promptpay-qr";

// Client-side pre-validation mirrors the SERVER gate (lib/payments/slip.ts) so a
// bad file is caught instantly — but the server is the real authority (CLAUDE.md §8).
const SLIP_ACCEPT = "image/png,image/jpeg,image/webp";
const SLIP_MAX_BYTES = 5 * 1024 * 1024;
const SLIP_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Validity copy comes from the server-derived `sublabel` on the item (structured
// validity, 2026-07-23) — no client-side enum → label mapping.

// Promo tag enum → the keyed UI label on the card pill.
const TAG_KEY: Record<CatalogTag, StrKey> = {
  popular: "popular",
  best_value: "best_value",
};

// Category id → the segmented-control tab label key.
const CAT_TAB_KEY: Record<PackageCategory, StrKey> = {
  group: "cat_group",
  private: "cat_private",
  rental: "cat_rental",
};

// Lets a step component label the dialog via the sheet's generated id.
const SheetTitleContext = createContext<string>("");

// Feature 3 flow: idle → loading (QR prep) → pay (QR + "attach slip") → uploading
// (pick + preview + submit) → submitted (under review). From "submitted" the sheet
// POLLS confirmPayment — the admin approve/reject is the money gate — and resolves to
// either "paid" (credited; success screen) or "rejected" (shows the admin's reason and
// lets the customer re-upload). No credit is ever granted on the client path itself.
type Phase = "idle" | "loading" | "pay" | "uploading" | "submitted" | "paid" | "rejected";

/** Map a createCheckout failure code to friendly, keyed copy. */
function checkoutErrorKey(code: string): StrKey {
  switch (code) {
    case "UNKNOWN_PACKAGE":
      return "err_unknown_package";
    default:
      return "err_checkout";
  }
}

/** Map an uploadPaymentSlip failure code to friendly, keyed copy. */
function slipErrorKey(code: UploadPaymentSlipFailureCode): StrKey {
  switch (code) {
    case "INVALID_FILE":
      return "err_invalid_file";
    case "TOO_LARGE":
      return "err_too_large";
    case "ALREADY_PAID":
      return "err_already_paid";
    case "FORBIDDEN":
      return "err_forbidden";
    case "UNKNOWN_CHARGE":
      return "err_checkout";
    default:
      return "err_checkout";
  }
}

/** Read a File into a `data:<mime>;base64,…` URL (the upload contract's input). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// Downscale thresholds: real phone slips are 3–8MP photos, far bigger than a QR
// receipt needs. Anything over ~800KB or wider/taller than 1600px is redrawn to a
// ≤1600px JPEG (q0.82) before upload, keeping the action body small and fast on
// mobile data. Below both thresholds the original file is uploaded untouched.
const SLIP_DOWNSCALE_BYTES = 800 * 1024;
const SLIP_MAX_DIMENSION = 1600;
const SLIP_JPEG_QUALITY = 0.82;

/** Decode an image file into a drawable bitmap (throws when undecodable). */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> decoder — some engines reject formats here
      // that an <img> element can still decode.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert a chosen slip to the upload data-URL, downscaling large images via
 * canvas first. On ANY decode/canvas failure (e.g. an iPhone HEIC the browser
 * can't rasterize) it falls back to the raw file — the server accepts up to the
 * contract limit (action body raised to 8mb) — rather than blocking the payment.
 */
async function slipToUploadDataUrl(file: File): Promise<string> {
  try {
    const bitmap = await decodeImage(file);
    // ImageBitmap exposes intrinsic size as width/height; a detached <img> is
    // authoritative via naturalWidth/naturalHeight.
    const width = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
    const height = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
    const oversized =
      file.size > SLIP_DOWNSCALE_BYTES || Math.max(width, height) > SLIP_MAX_DIMENSION;
    if (!oversized || width <= 0 || height <= 0) {
      if ("close" in bitmap) bitmap.close();
      return await fileToDataUrl(file);
    }
    const scale = Math.min(1, SLIP_MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if ("close" in bitmap) bitmap.close();
      return await fileToDataUrl(file);
    }
    // White backing so transparent PNG regions don't turn black in the JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if ("close" in bitmap) bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", SLIP_JPEG_QUALITY);
    // A canvas poisoned/failed export yields a stub — fall back to the raw file.
    if (!dataUrl.startsWith("data:image/jpeg")) return await fileToDataUrl(file);
    return dataUrl;
  } catch {
    return fileToDataUrl(file);
  }
}

interface CheckoutPanelProps {
  catalog: CatalogCategory[];
  /** Whether the viewer is a member with household sharing (display only). */
  isMember: boolean;
  /** The member's house number, for the perk badge (display only). */
  house: string | null;
}

export function CheckoutPanel({ catalog, isMember, house }: CheckoutPanelProps) {
  const { t, tt, lang } = useCustomerLang();
  const router = useRouter();

  const [catId, setCatId] = useState<PackageCategory>(catalog[0]?.id ?? "group");
  const activeCat = useMemo(
    () => catalog.find((c) => c.id === catId) ?? catalog[0],
    [catalog, catId],
  );

  // Default selection per category mirrors the prototype: the popular pack in
  // Group, the first item otherwise.
  const defaultIdFor = useCallback((cat: CatalogCategory | undefined): string => {
    if (!cat) return "";
    const popular = cat.items.find((i) => i.tag === "popular");
    return (popular ?? cat.items[0])?.id ?? "";
  }, []);

  const [selectedId, setSelectedId] = useState<string>(() => defaultIdFor(activeCat));

  const selected: CatalogItem | undefined = useMemo(
    () => activeCat?.items.find((i) => i.id === selectedId) ?? activeCat?.items[0],
    [activeCat, selectedId],
  );

  function pickCategory(id: PackageCategory) {
    setCatId(id);
    setSelectedId(defaultIdFor(catalog.find((c) => c.id === id)));
  }

  // Stable ids tying each category tab to the package radiogroup it controls
  // (aria-controls / aria-labelledby), matching the admin Segmented pattern (A2).
  const baseId = useId();
  const catTabId = (id: PackageCategory) => `${baseId}-cat-${id}`;
  const panelId = `${baseId}-packages`;

  // Roving arrow-key navigation across the category tabs (WAI-ARIA tablist).
  function onCatKeyDown(e: React.KeyboardEvent) {
    const idx = catalog.findIndex((c) => c.id === catId);
    if (idx < 0) return;
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % catalog.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (idx - 1 + catalog.length) % catalog.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = catalog.length - 1;
    else return;
    e.preventDefault();
    pickCategory(catalog[next]!.id);
  }

  // ───────── checkout flow state ─────────
  const [phase, setPhase] = useState<Phase>("idle");
  const [checkout, setCheckout] = useState<CheckoutSession | null>(null);
  const [errorKey, setErrorKey] = useState<StrKey | null>(null);
  // Whether the slip submit is in flight (disables the CTA, shows progress).
  const [submitting, setSubmitting] = useState(false);
  // A session-scoped record of a slip submitted this visit, so an under-review note
  // persists on the Buy screen after the sheet closes (Feature 3, deliverable #2).
  // There is no customer charge-status read model in the backend contract yet, so
  // this is intentionally session-local — see the report's flagged gap.
  const [submittedLabel, setSubmittedLabel] = useState<Bilingual | null>(null);
  // The admin's rejection reason (from confirmPayment) shown on the rejected screen.
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const sheetOpen =
    phase === "loading" ||
    phase === "pay" ||
    phase === "uploading" ||
    phase === "submitted" ||
    phase === "paid" ||
    phase === "rejected";

  async function startCheckout() {
    if (!selected) return;
    setErrorKey(null);
    setPhase("loading");
    try {
      const res = await createCheckout({ packageId: selected.id });
      if (res.ok) {
        setCheckout(res.checkout);
        setPhase("pay");
      } else {
        setErrorKey(checkoutErrorKey(res.code));
        setPhase("idle");
      }
    } catch {
      // A thrown server action (network / unexpected) must surface, not hang.
      setErrorKey("err_checkout");
      setPhase("idle");
    }
  }

  /** Advance from the QR step to the slip-attach step. */
  function goToUpload() {
    setErrorKey(null);
    setPhase("uploading");
  }

  /**
   * Submit a chosen slip (already converted to a data-URL) for verification. The
   * SERVER is the real validation gate; on ok we move to the under-review screen —
   * credit is NOT granted here (it lands only on admin approval).
   */
  async function submitSlip(slipDataUrl: string) {
    if (!checkout) return;
    setErrorKey(null);
    setSubmitting(true);
    try {
      const res = await uploadPaymentSlip({ chargeId: checkout.chargeId, slipDataUrl });
      if (res.ok) {
        setRejectionReason(null);
        setSubmittedLabel(checkout.item.label);
        setPhase("submitted");
      } else if (res.code === "ALREADY_PAID") {
        // The studio already approved this charge (e.g. a fast desk approve): there is
        // nothing to re-upload — advance to review and let the poll surface "paid".
        setRejectionReason(null);
        setSubmittedLabel(checkout.item.label);
        setPhase("submitted");
      } else {
        setErrorKey(slipErrorKey(res.code));
      }
    } catch {
      setErrorKey("err_checkout");
    } finally {
      setSubmitting(false);
    }
  }

  // While a slip is under review, poll the charge's lifecycle (confirmPayment never
  // credits — the admin approve/reject is the money gate, CLAUDE.md §5). On "paid" we
  // show the credited success screen; on "rejected" we surface the reason and let the
  // customer re-upload. Other states keep polling; the effect tears down on close.
  useEffect(() => {
    if (phase !== "submitted" || !checkout) return;
    const chargeId = checkout.chargeId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await confirmPayment({ chargeId });
        if (cancelled) return;
        if (res.ok && res.status === "paid") {
          setSubmittedLabel(null); // purchase complete — drop the under-review banner
          setPhase("paid");
          router.refresh(); // re-fetch server data (e.g. the home credit balance)
          return;
        }
        if (res.ok && res.status === "rejected") {
          setRejectionReason(res.rejectionReason);
          setPhase("rejected");
          return;
        }
      } catch {
        // Transient (network) — keep polling.
      }
      if (!cancelled) timer = setTimeout(poll, 3500);
    }

    // A short initial delay so the "Slip received" screen is seen before the first poll.
    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, checkout, router]);

  function closeSheet() {
    setPhase("idle");
    setCheckout(null);
    setErrorKey(null);
    setSubmitting(false);
  }

  function finishSubmitted() {
    setPhase("idle");
    setCheckout(null);
    setSubmitting(false);
    // Stay on the Buy screen: the under-review banner (below) persists this session
    // so the customer sees their slip is being verified and can buy/re-submit again.
  }

  /** Credited "paid" success → clear the flow and go home to see the new balance. */
  function finishPaid() {
    setPhase("idle");
    setCheckout(null);
    setSubmittedLabel(null);
    router.push("/home");
  }

  /** From the rejected screen: re-pick a slip for the SAME (still-valid) charge. */
  function reupload() {
    setErrorKey(null);
    setRejectionReason(null);
    setPhase("uploading");
  }

  return (
    <>
      <div className="px-[18px] pb-[150px]">
        {/* under-review banner — a slip submitted this session is awaiting verification.
            Session-scoped (no customer charge-status read model exists yet). */}
        {submittedLabel && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2.5 rounded-lune-sm border border-line bg-surface-2 px-4 py-3 shadow-soft"
          >
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cream-2 text-taupe-deep">
              <Clock size={15} />
            </span>
            <div className="min-w-0">
              <p className="m-0 font-body text-[13px] font-semibold text-ink">
                {t("slip_under_review")}
              </p>
              <p className="m-0 mt-0.5 truncate font-body text-[12px] text-muted">
                {tt(submittedLabel)} · {t("status_in_review")}
              </p>
            </div>
          </div>
        )}

        {/* category segmented control */}
        <div
          role="tablist"
          aria-label={t("packages")}
          onKeyDown={onCatKeyDown}
          className="mb-4 flex gap-1.5 rounded-[14px] bg-cream-2 p-1"
        >
          {catalog.map((c) => {
            const on = c.id === catId;
            return (
              <button
                key={c.id}
                id={catTabId(c.id)}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={panelId}
                tabIndex={on ? 0 : -1}
                onClick={() => pickCategory(c.id)}
                className={`flex-1 rounded-[10px] px-1 py-[9px] font-body text-[13px] font-semibold transition-all ${
                  on
                    ? "bg-surface-2 text-ink shadow-soft"
                    : "bg-transparent text-ink-soft"
                }`}
              >
                {t(CAT_TAB_KEY[c.id])}
              </button>
            );
          })}
        </div>

        {/* category panel: note + the package cards for the active category */}
        <div role="tabpanel" id={panelId} aria-labelledby={catTabId(catId)}>
          {/* category note */}
          {activeCat && (
            <div className="mx-0.5 mb-3.5 flex items-center gap-[7px] font-body text-[12.5px] text-muted">
              <Sparkle size={13} className="shrink-0 text-taupe" />
              <span>{tt(activeCat.note)}</span>
            </div>
          )}

          {/* package cards */}
          <div role="radiogroup" aria-label={t("choose_package")} className="flex flex-col gap-3">
            {activeCat?.items.map((p) => (
              <PackageCard
                key={p.id}
                item={p}
                lang={lang}
                selected={selectedId === p.id}
                onSelect={() => setSelectedId(p.id)}
              />
            ))}
          </div>
        </div>

        {/* trial promo — group only */}
        {catId === "group" && (
          <div className="relative mt-4 flex items-center gap-3.5 overflow-hidden rounded-lune bg-ink px-[18px] py-4">
            <Sparkle
              size={84}
              className="absolute -right-3 -top-4"
              style={{ color: "rgba(201,184,158,0.12)" }}
            />
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
              style={{ background: "rgba(201,184,158,0.16)" }}
            >
              <Sparkle size={22} style={{ color: "#C9B89E" }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-head text-[17px] font-semibold" style={{ color: "#F3ECE2" }}>
                {t("trial_title")}
              </div>
              <p
                className="m-0 mt-[3px] font-body text-[12.5px] leading-[1.5]"
                style={{ color: "rgba(243,236,226,0.7)" }}
              >
                {t("trial_body")}
              </p>
            </div>
          </div>
        )}

        {/* shared non-transferable note */}
        <div className="mt-3.5 flex items-center gap-[7px] px-1 font-body text-[12px] text-muted">
          <Info size={13} className="shrink-0" />
          <span>{t("non_transfer_note")}</span>
        </div>

        {/* member sharing perk */}
        <div
          className="relative mt-4 overflow-hidden rounded-lune border border-line px-[18px] py-[18px]"
          style={{ background: "linear-gradient(150deg, var(--color-cream-2), var(--color-surface))" }}
        >
          <Sparkle
            size={90}
            className="absolute -bottom-5 -right-4"
            style={{ color: "rgba(140,122,99,0.06)" }}
          />
          <div className="mb-2 flex items-center gap-2">
            <Share size={18} className="text-taupe-deep" />
            <span className="font-head text-[17px] font-semibold text-ink">
              {t("member_perk_title")}
            </span>
          </div>
          <p className="m-0 font-body text-[13px] leading-[1.58] text-ink-soft">
            {t("member_perk_body")}
          </p>
          {isMember && house && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5">
              <Pin size={14} className="text-taupe" />
              <span className="font-body text-[12px] font-semibold text-ink-soft">
                {t("house_label")} {house}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* sticky checkout bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[440px] border-t border-line bg-surface-2 px-[18px] pb-[calc(22px+env(safe-area-inset-bottom))] pt-3"
        style={{ boxShadow: "0 -10px 30px rgba(72,58,40,0.06)" }}
      >
        <div className="flex items-center gap-3.5">
          <div className="shrink-0">
            <div className="font-body text-[11px] text-muted">{t("total")}</div>
            <div className="font-head text-xl font-semibold leading-[1.1] text-ink">
              {selected ? thb(selected.price) : "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={startCheckout}
            disabled={!selected || phase !== "idle"}
            className="flex h-12 flex-1 items-center justify-center gap-2.5 rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none"
          >
            {t("pay_promptpay")}
            <Qr size={19} />
          </button>
        </div>
        {errorKey && phase === "idle" && (
          <p role="alert" className="mt-2 text-center font-body text-[12.5px] text-rose">
            {t(errorKey)}
          </p>
        )}
      </div>

      {/* checkout sheet */}
      <CheckoutSheet open={sheetOpen} onClose={phase === "submitted" ? finishSubmitted : closeSheet}>
        {phase === "paid" ? (
          <PaymentPaidStep lang={lang} item={checkout?.item} onDone={finishPaid} />
        ) : phase === "rejected" ? (
          <SlipRejectedStep
            lang={lang}
            reason={rejectionReason}
            onRetry={reupload}
            onClose={closeSheet}
          />
        ) : phase === "submitted" ? (
          <SlipSubmittedStep lang={lang} item={checkout?.item} onDone={finishSubmitted} />
        ) : phase === "uploading" ? (
          <SlipUploadStep
            lang={lang}
            submitting={submitting}
            errorKey={errorKey}
            onSubmit={submitSlip}
            onClearError={() => setErrorKey(null)}
          />
        ) : (
          <PromptPayStep
            lang={lang}
            phase={phase}
            checkout={checkout}
            errorKey={errorKey}
            onAttach={goToUpload}
          />
        )}
      </CheckoutSheet>
    </>
  );
}

// ───────────────────────── package card ─────────────────────────

function PackageCard({
  item,
  lang,
  selected,
  onSelect,
}: {
  item: CatalogItem;
  lang: Lang;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, tt } = makeT(lang);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`relative flex w-full items-center gap-3 rounded-lune border-[1.5px] px-4 py-3.5 text-left transition-all ${
        selected
          ? "border-taupe bg-surface-2 shadow-lift"
          : "border-line bg-surface shadow-soft"
      }`}
    >
      {/* radio dot */}
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] transition-all ${
          selected ? "border-taupe bg-taupe text-white" : "border-line-strong text-transparent"
        }`}
      >
        {selected && <Check size={15} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="whitespace-nowrap font-head text-[19px] font-semibold leading-[1.3] text-ink">
            {tt(item.label)}
          </span>
          {item.tag && (
            <span
              className={`rounded-full px-2.5 py-[3px] font-body text-[10px] font-bold uppercase tracking-[0.05em] ${
                item.tag === "best_value"
                  ? "bg-taupe text-white"
                  : "bg-cream-2 text-taupe-deep"
              }`}
            >
              {t(TAG_KEY[item.tag])}
            </span>
          )}
        </div>
        <div className="mt-[7px] flex items-center gap-2 whitespace-nowrap font-body text-[12.5px] leading-[1.5] text-muted">
          <span>{tt(item.sublabel)}</span>
          <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-line-strong" />
          <span>
            {thb(item.perHour)}
            {t("per_hour")}
          </span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-head text-[20px] font-semibold text-ink">{thb(item.price)}</div>
      </div>
    </button>
  );
}

// ───────────────────────── checkout sheet (focus-trapped dialog) ─────────────────────────

function CheckoutSheet({
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

  // Enter/exit animation, mirroring the prototype's Sheet timing.
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

  // Restore focus to the trigger when the sheet fully closes.
  useEffect(() => {
    if (!render && prevFocus.current) {
      prevFocus.current.focus?.();
      prevFocus.current = null;
    }
  }, [render]);

  // Escape to close + a simple focus trap within the panel.
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
    <div className="absolute inset-0 z-[200] mx-auto flex max-w-[440px] flex-col justify-end">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default transition-opacity duration-300"
        style={{ background: "rgba(40,32,24,0.34)", opacity: show ? 1 : 0, backdropFilter: "blur(2px)" }}
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
        <div className="overflow-y-auto px-[18px] pb-[30px] pt-2">
          {/* The step heading uses titleId so the dialog is labelled by it. */}
          <SheetTitleContext.Provider value={titleId}>{children}</SheetTitleContext.Provider>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── PromptPay (QR) step ─────────────────────────

function PromptPayStep({
  lang,
  phase,
  checkout,
  errorKey,
  onAttach,
}: {
  lang: Lang;
  phase: Phase;
  checkout: CheckoutSession | null;
  errorKey: StrKey | null;
  onAttach: () => void;
}) {
  const { t, tt } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the step heading when the QR step lands.
  useEffect(() => {
    if (phase === "pay") headingRef.current?.focus();
  }, [phase]);

  const loading = phase === "loading" || !checkout;
  const item = checkout?.item;
  const qrAlt =
    checkout != null
      ? t("qr_alt")
          .replace("{amount}", thb(checkout.amount))
          .replace("{reference}", checkout.reference)
      : "";

  return (
    <div className="text-center">
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-4 mt-1.5 font-head text-[26px] font-semibold tracking-[0.01em] text-ink outline-none"
      >
        {t("scan_to_pay")}
      </h2>

      <span
        className="mb-[18px] inline-flex items-center gap-[7px] rounded-full px-3.5 py-1.5 font-body text-[12.5px] font-bold tracking-[0.02em] text-white"
        style={{ background: "#1A3A6B" }}
      >
        PromptPay
      </span>

      {loading ? (
        <div
          className="mx-auto flex h-[230px] w-[230px] items-center justify-center rounded-lune border border-line bg-surface-2 shadow-lift"
          aria-live="polite"
        >
          <span className="font-body text-[13px] text-muted">{t("preparing_qr")}</span>
        </div>
      ) : (
        <div className="mx-auto w-fit rounded-lune border border-line bg-surface-2 p-[22px] shadow-lift">
          <PromptPayQr payload={checkout.qrPayload} alt={qrAlt} size={186} />
        </div>
      )}

      <p className="mx-auto mt-3.5 max-w-[260px] font-body text-[13px] leading-[1.5] text-muted">
        {t("scan_hint")}
      </p>

      {/* save the QR to the gallery, then scan it from the bank app (same-phone flow) */}
      {checkout && (
        <div className="mt-3.5">
          <QrDownloadButton
            payload={checkout.qrPayload}
            filename={`lune-promptpay-${checkout.amount}.png`}
            label={t("download_qr")}
            ariaLabel={t("download_qr_aria")}
            amountLabel={`PromptPay ${thb(checkout.amount)}`}
          />
        </div>
      )}

      {/* receipt: package line + amount */}
      {item && (
        <div className="mt-4 overflow-hidden rounded-lune-sm border border-line">
          <ReceiptLine label={tt(item.label)} value={tt(item.sublabel)} />
          <ReceiptLine label={t("amount")} value={thb(checkout.amount)} last />
        </div>
      )}

      {errorKey && (
        <p role="alert" className="mt-3 font-body text-[12.5px] leading-snug text-rose">
          {t(errorKey)}
        </p>
      )}

      <button
        type="button"
        onClick={onAttach}
        disabled={loading}
        className="mt-[18px] flex h-12 w-full items-center justify-center gap-2.5 rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none"
      >
        {t("slip_attach")}
        <Upload size={19} />
      </button>
    </div>
  );
}

// ───────────────────────── slip upload step ─────────────────────────

function SlipUploadStep({
  lang,
  submitting,
  errorKey,
  onSubmit,
  onClearError,
}: {
  lang: Lang;
  submitting: boolean;
  errorKey: StrKey | null;
  onSubmit: (slipDataUrl: string) => void;
  onClearError: () => void;
}) {
  const { t } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputId = useId();

  // The chosen file as a data-URL (preview + submit payload) + its display name.
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  // A client-side pre-validation error key (mirrors the server gate); the server is
  // still the real authority. Separate from the action error so both can show.
  const [localErrorKey, setLocalErrorKey] = useState<StrKey | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    onClearError();
    setLocalErrorKey(null);
    const file = e.target.files?.[0];
    if (!file) return;
    // Pre-validate type + size for instant feedback; the server re-checks (sniffs
    // magic bytes + decoded size) and is the real gate (CLAUDE.md §8).
    if (!SLIP_ALLOWED_TYPES.includes(file.type)) {
      setLocalErrorKey("err_invalid_file");
      setDataUrl(null);
      setFileName("");
      return;
    }
    if (file.size > SLIP_MAX_BYTES) {
      setLocalErrorKey("err_too_large");
      setDataUrl(null);
      setFileName("");
      return;
    }
    try {
      // Downscale big photos client-side (canvas → ≤1600px JPEG) so the upload
      // stays small; undecodable files (HEIC) fall back to the raw data-URL.
      const url = await slipToUploadDataUrl(file);
      setDataUrl(url);
      setFileName(file.name);
    } catch {
      setLocalErrorKey("err_invalid_file");
    }
  }

  const shownError = localErrorKey ?? errorKey;

  return (
    <div className="pt-1">
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-1.5 mt-1.5 text-center font-head text-[26px] font-semibold tracking-[0.01em] text-ink outline-none"
      >
        {t("slip_choose_image")}
      </h2>
      <p className="mx-auto mb-5 max-w-[300px] text-center font-body text-[13px] leading-[1.55] text-muted">
        {t("slip_upload_hint")}
      </p>

      {/* dropzone label wrapping a hidden file input (keyed so re-picking resets) */}
      <label
        htmlFor={inputId}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-lune border-[1.5px] border-dashed px-5 py-7 text-center transition-colors ${
          dataUrl ? "border-taupe bg-surface-2" : "border-line-strong bg-surface-2 hover:border-taupe"
        }`}
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-cream-2 text-taupe-deep">
          {dataUrl ? <ImageIcon size={24} /> : <Upload size={24} />}
        </span>
        <span className="font-body text-[14px] font-semibold text-ink">
          {dataUrl ? t("slip_change_image") : t("slip_choose_image")}
        </span>
        <input
          id={inputId}
          type="file"
          accept={SLIP_ACCEPT}
          onChange={onPick}
          className="sr-only"
        />
      </label>

      {/* thumbnail preview of the chosen slip */}
      {dataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={fileName || t("slip_choose_image")}
          className="mx-auto mt-4 max-h-[260px] w-auto rounded-lune-sm border border-line object-contain shadow-soft"
        />
      )}

      {shownError && (
        <p role="alert" className="mt-3 text-center font-body text-[12.5px] leading-snug text-rose">
          {t(shownError)}
        </p>
      )}

      <button
        type="button"
        onClick={() => dataUrl && onSubmit(dataUrl)}
        disabled={!dataUrl || submitting}
        className="mt-[18px] flex h-12 w-full items-center justify-center gap-2.5 rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985] disabled:bg-cream-2 disabled:text-muted disabled:shadow-none"
      >
        {submitting ? `${t("slip_submit")}…` : t("slip_submit")}
        {!submitting && <Check size={19} />}
      </button>
    </div>
  );
}

// ───────────────────────── slip submitted (under review) step ─────────────────────────

function SlipSubmittedStep({
  lang,
  item,
  onDone,
}: {
  lang: Lang;
  item: CheckoutSession["item"] | undefined;
  onDone: () => void;
}) {
  const { t, tt } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="pt-2 text-center" aria-live="polite">
      <div
        className="mx-auto mb-[18px] mt-1 grid h-[76px] w-[76px] place-items-center rounded-full bg-taupe text-white"
        style={{ boxShadow: "0 10px 30px rgba(140,122,99,0.4)" }}
      >
        <Check size={36} strokeWidth={2} />
      </div>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 font-head text-[28px] font-semibold text-ink outline-none"
      >
        {t("slip_submitted_title")}
      </h2>
      <p className="mx-auto mb-5 max-w-[290px] font-body text-[14px] leading-[1.55] text-ink-soft">
        {t("slip_submitted_sub")}
      </p>

      {/* the package awaiting credit (no balance — credit is granted on approval) */}
      {item && (
        <div className="mb-3 flex items-center justify-center gap-2 rounded-lune-sm bg-cream-2 px-4 py-3.5">
          <Sparkle size={16} className="text-taupe" />
          <span className="font-head text-[18px] font-semibold text-ink">{tt(item.label)}</span>
          <span className="font-body text-[13px] text-muted">
            +{item.hours} {item.hours === 1 ? t("hour") : t("hours")}
          </span>
        </div>
      )}

      {/* live polling indicator — the sheet checks confirmPayment until approve/reject */}
      <div className="mb-[18px] flex items-center justify-center gap-2 font-body text-[12.5px] text-muted">
        <Spinner size={14} />
        <span>{t("slip_checking")}</span>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985]"
      >
        {t("done")}
        <ArrowRight size={18} />
      </button>
    </div>
  );
}

// ───────────────────────── credited "paid" step ─────────────────────────

/**
 * The success screen reached when polling sees the charge credited (the admin
 * approved the slip). It celebrates the granted hours; "Done" goes home so the
 * customer sees their updated balance. (No balance figure is shown here — the
 * authoritative balance lives on Home, recomputed server-side.)
 */
function PaymentPaidStep({
  lang,
  item,
  onDone,
}: {
  lang: Lang;
  item: CheckoutSession["item"] | undefined;
  onDone: () => void;
}) {
  const { t } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="pt-2 text-center" aria-live="polite">
      <div
        className="mx-auto mb-[18px] mt-1 grid h-[76px] w-[76px] place-items-center rounded-full bg-sage text-white"
        style={{ boxShadow: "0 10px 30px rgba(140,154,126,0.4)" }}
      >
        <Check size={36} strokeWidth={2} />
      </div>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 font-head text-[30px] font-semibold text-ink outline-none"
      >
        {t("payment_done")}
      </h2>
      <p className="mx-auto mb-5 max-w-[280px] font-body text-[14px] leading-[1.55] text-ink-soft">
        {t("payment_sub")}
      </p>

      {/* credits added (from the catalog item — the granted hours) */}
      {item && (
        <div className="mb-[18px] flex items-center justify-center gap-2 rounded-lune-sm bg-cream-2 px-4 py-3.5">
          <Sparkle size={16} className="text-taupe" />
          <span className="font-head text-[20px] font-semibold text-ink">
            +{item.hours} {item.hours === 1 ? t("hour") : t("hours")}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985]"
      >
        {t("done")}
        <ArrowRight size={18} />
      </button>
    </div>
  );
}

// ───────────────────────── rejected step ─────────────────────────

/**
 * Reached when polling sees the slip rejected. Surfaces the admin's reason (if any)
 * and lets the customer re-upload a new slip for the SAME charge (the server UPSERTs
 * the slip back to awaiting_review — CLAUDE.md §5).
 */
function SlipRejectedStep({
  lang,
  reason,
  onRetry,
  onClose,
}: {
  lang: Lang;
  reason: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = makeT(lang);
  const titleId = useContext(SheetTitleContext);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="pt-2 text-center" aria-live="polite">
      <div
        className="mx-auto mb-[18px] mt-1 grid h-[76px] w-[76px] place-items-center rounded-full bg-rose text-white"
        style={{ boxShadow: "0 10px 30px rgba(196,154,134,0.4)" }}
      >
        <RejectMark size={34} />
      </div>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 font-head text-[28px] font-semibold text-ink outline-none"
      >
        {t("slip_rejected_title")}
      </h2>
      <p className="mx-auto mb-4 max-w-[290px] font-body text-[14px] leading-[1.55] text-ink-soft">
        {t("slip_rejected_sub")}
      </p>

      {/* the admin's reason, when one was given */}
      {reason && (
        <div className="mb-[18px] rounded-lune-sm border border-line bg-surface-2 px-4 py-3 text-left">
          <div className="mb-0.5 font-body text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
            {t("slip_reject_reason")}
          </div>
          <p className="m-0 font-body text-[13.5px] leading-[1.5] text-ink">{reason}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onRetry}
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lune-sm bg-ink font-body text-base font-semibold text-cream shadow-lift transition-transform active:scale-[0.985]"
      >
        {t("slip_upload_again")}
        <Upload size={19} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-2.5 h-11 w-full font-body text-[13.5px] font-semibold text-muted"
      >
        {t("aria_close")}
      </button>
    </div>
  );
}

// A spinning ring used as the under-review polling indicator.
function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-line border-t-taupe"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

// An "✕" mark for the rejected screen's status badge (no icon needed in icons.tsx).
function RejectMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ReceiptLine({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between bg-surface-2 px-4 py-[13px] ${
        last ? "" : "border-b border-line"
      }`}
    >
      <span className="font-body text-[13.5px] text-ink-soft">{label}</span>
      <span className="font-body text-[14.5px] font-semibold text-ink">{value}</span>
    </div>
  );
}

