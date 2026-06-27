"use client";

// Pure SVG / CSS chart primitives for the admin Business Dashboard — NO charting
// library, exactly as the prototype (LUNE Admin Analytics.html donut/gauge/bar
// scripts + admin-mobile-analytics.jsx ASpark). Every chart is decorative for the
// pointer but carries role="img" + an aria-label data summary; the *visible*
// numeric legend / value table lives beside each chart in dashboard-view.tsx, so
// the data is never locked inside an image.

// ───────────────────────── compact ฿ helper ─────────────────────────

/**
 * Compact Baht label for tight chart centres (e.g. "฿342k"). Helper-formatted
 * (never ad-hoc in JSX) so the donut centre matches the prototype's "฿342k".
 */
export function thbCompact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return "฿" + (Math.round(k * 10) / 10).toLocaleString("en-US") + "k";
  }
  return "฿" + n.toLocaleString("en-US");
}

// ───────────────────────── 14-day sparkline (CSS bars) ─────────────────────────

/**
 * CSS flex-bar sparkline. Bars are sized as a % of the series max; the last bar
 * is accented (the prototype's `.bar.last`). `dark` renders the on-dark variant
 * used inside the hero sales card.
 */
export function Sparkline({
  data,
  ariaLabel,
  dark,
}: {
  data: number[];
  ariaLabel: string;
  dark?: boolean;
}) {
  const max = Math.max(1, ...data);
  const n = data.length;
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="flex items-end gap-[3px]"
      style={{ height: dark ? 56 : 96 }}
    >
      {data.map((v, i) => {
        const last = i === n - 1;
        const height = `${Math.max((v / max) * 100, 4)}%`;
        return (
          <span
            key={i}
            aria-hidden
            className="flex-1 rounded-t-[3px] transition-[opacity]"
            style={{
              height,
              minHeight: 4,
              background: dark
                ? last
                  ? "#F6EFE6"
                  : "rgba(201,184,158,0.55)"
                : last
                  ? "var(--color-admin-ink)"
                  : "var(--color-taupe)",
              opacity: dark ? 1 : last ? 1 : 0.55,
            }}
          />
        );
      })}
    </div>
  );
}

// ───────────────────────── revenue-mix donut (SVG dasharray) ─────────────────────────

/**
 * SVG donut built with stroke-dasharray on a r=15.9155 circle (circumference =
 * 100), the exact technique the prototype's donut script uses. Segments are drawn
 * by decrementing the dashoffset, with a centre total label.
 */
export function Donut({
  segments,
  centerTop,
  centerBottom,
  ariaLabel,
  size = 118,
}: {
  segments: { pct: number; color: string }[];
  centerTop: string;
  centerBottom: string;
  ariaLabel: string;
  size?: number;
}) {
  let offset = 25; // start at 12 o'clock, same as the prototype
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 42 42"
      role="img"
      aria-label={ariaLabel}
      className="shrink-0"
    >
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--color-cream-2)" strokeWidth="5.4" />
      {segments.map((s, i) => {
        const el = (
          <circle
            key={i}
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            stroke={s.color}
            strokeWidth="5.4"
            strokeDasharray={`${s.pct} ${100 - s.pct}`}
            strokeDashoffset={offset}
            strokeLinecap="butt"
          />
        );
        offset -= s.pct;
        return el;
      })}
      <text
        x="21"
        y="20.5"
        textAnchor="middle"
        fontFamily="Schibsted Grotesk, sans-serif"
        fontWeight="700"
        fontSize="6.6"
        fill="var(--color-ink)"
      >
        {centerTop}
      </text>
      <text
        x="21"
        y="25.6"
        textAnchor="middle"
        fontFamily="Hanken Grotesk, sans-serif"
        fontSize="2.9"
        fill="var(--color-muted)"
      >
        {centerBottom}
      </text>
    </svg>
  );
}

// ───────────────────────── trial-conversion gauge (SVG arc) ─────────────────────────

/**
 * SVG ring gauge: a sage arc whose dasharray length is the pct, with a check
 * glyph in the centre — mirrors the prototype's gauge script.
 */
export function Gauge({ pct, ariaLabel, size = 86 }: { pct: number; ariaLabel: string; size?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 42 42"
      role="img"
      aria-label={ariaLabel}
      className="shrink-0"
    >
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--color-cream-2)" strokeWidth="4.2" />
      <circle
        cx="21"
        cy="21"
        r="15.9155"
        fill="none"
        stroke="var(--color-sage-deep)"
        strokeWidth="4.2"
        strokeDasharray={`${clamped} ${100 - clamped}`}
        strokeDashoffset="25"
        strokeLinecap="round"
      />
      <path
        d="M17 21.3l2.6 2.6 5-5.2"
        fill="none"
        stroke="var(--color-sage-deep)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ───────────────────────── progress track (CSS) ─────────────────────────

/**
 * A single CSS progress track (fill-rate rows, per-instructor bars, house usage).
 * Purely visual — the numeric value always sits in a sibling label, so this is
 * aria-hidden.
 */
export function ProgressTrack({
  value,
  color,
  height = 8,
}: {
  value: number;
  color: string;
  height?: number;
}) {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-full bg-cream-2"
      style={{ height }}
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}
