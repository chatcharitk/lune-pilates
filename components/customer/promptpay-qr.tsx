"use client";

// Renders an EMVCo / PromptPay payload as a scannable QR code, in the LUNE warm
// palette (ink modules on a surface ground). The payload string comes verbatim
// from the backend checkout (createCheckout → qrPayload); this component only
// draws it — it never derives an amount or reference.
//
// Accessibility: the QR is decorative for sighted users but carries a text
// alternative (role="img" + aria-label) describing the amount and reference, so
// a screen-reader user is told exactly what they would be paying.

import { useMemo } from "react";
import QRCode from "qrcode";

/** Convert a data-URL to a Blob (for building the File handed to the share sheet). */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const mime = meta.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bytes = atob(dataUrl.slice(comma + 1));
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

interface PromptPayQrProps {
  /** EMVCo QR payload string from the backend (qrPayload). */
  payload: string;
  /** Accessible description (amount + reference) — the text alternative. */
  alt: string;
  /** Rendered side length in px. */
  size?: number;
}

export function PromptPayQr({ payload, alt, size = 186 }: PromptPayQrProps) {
  // qrcode.create is synchronous and pure — memoise on the payload so we only
  // recompute the module matrix when the charge changes, not on every render.
  const matrix = useMemo(() => {
    const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    const data = qr.modules.data;
    return { count, data };
  }, [payload]);

  const { count, data } = matrix;
  // A 1-module quiet zone keeps scanners happy without ballooning the SVG.
  const quiet = 1;
  const total = count + quiet * 2;
  const cell = size / total;

  // Collect dark modules into a single path for a compact, crisp SVG.
  const rects: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (data[row * count + col]) {
        const x = (col + quiet) * cell;
        const y = (row + quiet) * cell;
        rects.push(`M${x} ${y}h${cell}v${cell}h${-cell}z`);
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={alt}
      className="block"
    >
      <rect width={size} height={size} fill="var(--color-surface-2)" />
      <path d={rects.join("")} fill="var(--color-ink)" shapeRendering="crispEdges" />
    </svg>
  );
}

// ───────────────────────── save / share the QR as an image ─────────────────────────

interface QrDownloadButtonProps {
  /** EMVCo QR payload string from the backend (qrPayload) — same as the rendered QR. */
  payload: string;
  /** Download filename, e.g. lune-promptpay-2900.png */
  filename: string;
  /** Visible button label (already localised by the caller). */
  label: string;
  /** Accessible label; falls back to the visible label. */
  ariaLabel?: string;
  /** Share-sheet title, e.g. "PromptPay ฿2,900". */
  amountLabel?: string;
}

/**
 * "Save QR" button rendered under a PromptPay QR. Generates a PNG (white ground,
 * ink modules — white for maximum bank-scanner compatibility) and, on tap, opens
 * the native share sheet when file-sharing is available (send via LINE / save to
 * gallery — the standard Thai same-phone flow), otherwise falls back to a plain
 * <a download> so desktop and older browsers still get the image.
 */
export function QrDownloadButton({ payload, filename, label, ariaLabel, amountLabel }: QrDownloadButtonProps) {
  const save = async () => {
    // Generated on demand — the PNG is only needed when the user actually saves.
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      width: 640,
      margin: 2,
      color: { dark: "#2E2820", light: "#FFFFFF" },
    });

    try {
      const file = new File([dataUrlToBlob(dataUrl)], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: amountLabel });
        return;
      }
    } catch (err) {
      // User dismissed the share sheet — not an error, and no fallback wanted.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Any other share failure falls through to the plain download below.
    }

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <button
      type="button"
      onClick={() => void save()}
      aria-label={ariaLabel ?? label}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface-2 font-body text-[14px] font-semibold text-ink transition-transform active:scale-[0.985]"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 4v11M7 10l5 5 5-5" />
        <path d="M4 19h16" />
      </svg>
      {label}
    </button>
  );
}
