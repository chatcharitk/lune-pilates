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
