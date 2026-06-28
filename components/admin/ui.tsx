"use client";

// Reusable admin UI primitives, mirroring admin-shell.jsx (Stat, Badge, Dot,
// Avatar, CapBar, Drawer). Built on the shared warm design tokens; class-type dot
// colours come from admin-data.jsx ATYPES. Shared across admin screens.

import { useEffect, useId, useRef } from "react";
import type { ClassType } from "@/lib/domain/types";
import { useAdminLang } from "./admin-context";

// ───────────────────────── stat tile ─────────────────────────

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface-2 p-3.5 shadow-soft md:p-4">
      <p className="truncate font-body text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">
        {label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className="font-head text-2xl font-bold leading-none md:text-3xl"
          style={{ color: accent ?? "var(--color-ink)" }}
        >
          {value}
        </span>
        {sub && <span className="font-body text-[13px] text-muted">{sub}</span>}
      </p>
    </div>
  );
}

// ───────────────────────── mini stat (drawer) ─────────────────────────

/**
 * Compact stat tile for inside a drawer (admin-more.jsx `MiniStat`) — a smaller
 * sibling of `Stat`. `rose` tone tints the value + sub for the expiring-credits
 * treatment. Shared so the Members detail drawer and future drawers can reuse it.
 */
export function MiniStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "rose";
}) {
  const tinted = tone === "rose";
  return (
    <div className="rounded-2xl border border-line bg-surface px-[15px] py-3.5">
      <p className="font-body text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
        {label}
      </p>
      <p
        className={`mt-1 font-head text-xl font-bold ${tinted ? "text-[#a56a52]" : "text-ink"}`}
      >
        {value}
      </p>
      {sub && (
        <p className={`mt-px font-body text-[11.5px] ${tinted ? "text-[#a56a52]" : "text-muted"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ───────────────────────── sparkle motif ─────────────────────────

/**
 * The 4-point sparkle that sits on the LUNE wordmark's "E" (app/globals.css
 * `.lune-spark`), rendered as a tiny inline SVG so it can mark a member's name in
 * the Members table / drawer (admin-more.jsx `Sparkle`). Decorative by default.
 */
export function Sparkle({
  size = 11,
  color = "var(--color-taupe)",
}: {
  size?: number;
  color?: string;
}) {
  // The same 4-point star as the wordmark's `.lune-spark` clip-path polygon
  // (50% 0, 60% 40, 100% 50, 60% 60, 50% 100, 40% 60, 0 50, 40% 40), on a 0–10 box.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      aria-hidden
      className="shrink-0"
      style={{ color }}
    >
      <path fill="currentColor" d="M5 0 6 4 10 5 6 6 5 10 4 6 0 5 4 4Z" />
    </svg>
  );
}

// ───────────────────────── badge ─────────────────────────

export type BadgeTone = "neutral" | "green" | "amber" | "rose";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-cream-2 text-ink-soft",
  green: "bg-sage/15 text-sage-deep",
  amber: "bg-[rgba(193,160,121,0.18)] text-[#9a7b45]",
  rose: "bg-rose/15 text-[#a56a52]",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-body text-[11.5px] font-semibold ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

// ───────────────────────── class-type dot ─────────────────────────

const TYPE_DOT: Record<ClassType, string> = {
  group: "#a98f71",
  private: "#8e9a82",
  duo: "#c0a079",
  trio: "#b7a48c",
  rental: "#a99b86",
};

export function Dot({ type, size = 8 }: { type: ClassType; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: TYPE_DOT[type] }}
    />
  );
}

// ───────────────────────── avatar ─────────────────────────

const AVATAR_COLORS = ["#8c7a63", "#8e9a82", "#c0a079", "#6e84a3", "#c49a86", "#8c9a7e"];

/** Deterministic colour per person so the same name keeps the same avatar tint. */
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function Avatar({
  name,
  seed,
  size = 34,
  checked,
  initials: initialsProp,
}: {
  name: string;
  /** Stable id used for the colour (falls back to the name). */
  seed?: string;
  size?: number;
  /** When true, overlays a small sage check badge (roster check-in). */
  checked?: boolean;
  /** Override the derived initial (e.g. instructors, where the name is "Kru …"). */
  initials?: string;
}) {
  const initials = (initialsProp ?? name.trim().charAt(0)).toUpperCase() || "?";
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-body font-bold text-white"
        style={{ background: avatarColor(seed ?? name), fontSize: size * 0.4 }}
      >
        {initials}
      </span>
      {checked && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-surface-2 bg-sage"
          style={{ width: 13, height: 13 }}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      )}
    </span>
  );
}

// ───────────────────────── capacity bar ─────────────────────────

export function CapBar({ booked, cap }: { booked: number; cap: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: cap }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full ${i < booked ? "bg-taupe" : "bg-cream-2"}`}
        />
      ))}
    </div>
  );
}

// ───────────────────────── segmented tab control ─────────────────────────

/**
 * Pill segmented control (admin-more.jsx `Segmented`) rendered as an ARIA tablist
 * so the two booking views switch accessibly. The caller owns the active value and
 * wires each option's `panelId`/`tabId` to its panel for `aria-controls`/
 * `aria-labelledby`. Arrow keys move between tabs (roving focus, WAI-ARIA).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; tabId: string; panelId: string }[];
  ariaLabel: string;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (idx - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    else return;
    e.preventDefault();
    onChange(options[next]!.value);
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="inline-flex gap-0.5 rounded-full bg-cream-2 p-1"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            id={o.tabId}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={o.panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-5 py-2 font-body text-[13.5px] font-semibold transition-colors ${
              on ? "bg-surface-2 text-ink shadow-soft" : "text-muted hover:text-ink-soft"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────── drawer (right on desktop, bottom sheet on mobile) ─────────────────────────

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useAdminLang();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The element focused before the drawer opened, so focus returns to the
  // trigger on close (ports the customer Sheet's focus-restore pattern —
  // cancel-sheet.tsx — into the admin Drawer; finding A1).
  const prevFocus = useRef<HTMLElement | null>(null);

  // On open: remember the trigger, then move focus to the close button.
  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
  }, [open]);

  // On close (the open→false transition): restore focus to the trigger.
  useEffect(() => {
    if (open) return;
    if (prevFocus.current) {
      prevFocus.current.focus?.();
      prevFocus.current = null;
    }
  }, [open]);

  // Escape-to-close + a Tab focus trap so Tab/Shift-Tab cycle within the dialog
  // and never escape to the page behind (mirrors the customer Sheet).
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label={t("aria_close")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-[22px] bg-surface shadow-lift md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-none md:w-[420px] md:rounded-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <h3
            id={titleId}
            className="min-w-0 truncate font-head text-xl font-semibold text-ink"
          >
            {title}
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("aria_close")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-soft"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 gap-2.5 border-t border-line bg-surface-2 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
