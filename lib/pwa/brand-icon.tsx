// LUNE brand mark for PWA icons, drawn with pure geometry (no text — satori has
// no fonts loaded): cream field, taupe crescent moon, and the 4-point sparkle
// motif the wordmark's "E" carries. Rendered by next/og ImageResponse from
// app/icon.tsx, app/apple-icon.tsx and the fixed-path /icon-*.png routes.
//
// Colors are the design-system tokens (CLAUDE.md §4): --cream #F1E9E0,
// --taupe #8C7A63.

const CREAM = "#F1E9E0";
const TAUPE = "#8C7A63";

/** 4-point sparkle: concave quadratic star centered at (cx, cy), radius r. */
function sparklePath(cx: number, cy: number, r: number): string {
  const w = r * 0.16; // waist half-width — how pinched the points are
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
  // Fraction of the canvas the 100-unit artwork spans. Regular icons breathe a
  // little; maskable stays inside the safe zone (inner 80% circle).
  const art = Math.round(size * (safeZone ? 0.62 : 0.8));
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
      <svg width={art} height={art} viewBox="0 0 100 100">
        {/* Crescent: taupe disc with a cream disc "biting" from the upper right */}
        <circle cx="44" cy="56" r="29" fill={TAUPE} />
        <circle cx="58" cy="42" r="26" fill={CREAM} />
        {/* Sparkle motif (large + small companion), upper right of the moon */}
        <path d={sparklePath(74, 23, 13)} fill={TAUPE} />
        <path d={sparklePath(90, 42, 6)} fill={TAUPE} />
      </svg>
    </div>
  );
}
