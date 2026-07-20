// LUNE brand mark for PWA icons — the studio's real logo mark
// (public/brand/logo-mark.png, cropped + transparency-keyed) centered on a cream
// field. Rendered by next/og ImageResponse from app/icon.tsx, app/apple-icon.tsx
// and the fixed-path /icon-*.png routes. The mark is read + base64-embedded at
// module load (ImageResponse/satori can only take a data URI or absolute URL, not
// a public path), and its intrinsic aspect ratio is parsed from the PNG header so
// swapping the file needs no code change.
//
// Falls back to a drawn crescent + sparkle if the asset is ever missing, so icon
// generation never hard-fails. Cream field per the design tokens (CLAUDE.md §4).

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CREAM = "#F1E9E0";
const TAUPE = "#8C7A63";

/** Load the mark once: data URI + intrinsic size (from the PNG IHDR). */
function loadMark(): { uri: string; w: number; h: number } | null {
  try {
    const buf = readFileSync(join(process.cwd(), "public/brand/logo-mark.png"));
    // PNG signature (8) + IHDR length (4) + "IHDR" (4) → width @16, height @20.
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (!w || !h) return null;
    return { uri: `data:image/png;base64,${buf.toString("base64")}`, w, h };
  } catch {
    return null;
  }
}

const MARK = loadMark();

/** 4-point sparkle: concave quadratic star centered at (cx, cy), radius r. */
function sparklePath(cx: number, cy: number, r: number): string {
  const w = r * 0.16;
  return [
    `M ${cx} ${cy - r}`,
    `Q ${cx + w} ${cy - w} ${cx + r} ${cy}`,
    `Q ${cx + w} ${cy + w} ${cx} ${cy + r}`,
    `Q ${cx - w} ${cy + w} ${cx - r} ${cy}`,
    `Q ${cx - w} ${cy - w} ${cx} ${cy - r}`,
    "Z",
  ].join(" ");
}

export function BrandIcon({
  size,
  safeZone = false,
}: {
  /** Output pixel size (icons are square). */
  size: number;
  /** Maskable variant: shrink artwork into the ~80% safe zone so any mask shape keeps it whole. */
  safeZone?: boolean;
}) {
  // Fraction of the canvas the mark spans (maskable stays inside the safe zone).
  const frac = safeZone ? 0.58 : 0.72;

  let art: React.ReactNode;
  if (MARK) {
    const h = Math.round(size * frac);
    const w = Math.round(h * (MARK.w / MARK.h));
    // eslint-disable-next-line @next/next/no-img-element -- ImageResponse (satori), not the DOM
    art = <img src={MARK.uri} width={w} height={h} alt="" />;
  } else {
    const a = Math.round(size * (safeZone ? 0.62 : 0.8));
    art = (
      <svg width={a} height={a} viewBox="0 0 100 100">
        <circle cx="44" cy="56" r="29" fill={TAUPE} />
        <circle cx="58" cy="42" r="26" fill={CREAM} />
        <path d={sparklePath(74, 23, 13)} fill={TAUPE} />
        <path d={sparklePath(90, 42, 6)} fill={TAUPE} />
      </svg>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: CREAM,
      }}
    >
      {art}
    </div>
  );
}
