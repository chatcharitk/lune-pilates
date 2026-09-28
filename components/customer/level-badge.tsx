"use client";

// The difficulty badge a customer sees when choosing a class (owner, 2026-09-21).
//
// Renders NOTHING for a class with no level. Every class created before this
// existed has none, and an unlabelled class must not read as "basic" — sending a
// first-timer into an advanced room is the failure this feature exists to prevent,
// and a confident wrong label would cause it rather than avoid it.
//
// The three levels are distinguished by COLOUR AND TEXT, never colour alone: the
// palette's sage/taupe/rose are close in luminance, so colour on its own would be
// invisible to a colour-blind reader (and in a grey LINE screenshot).

import type { ClassLevel } from "@/lib/domain/types";
import { useCustomerLang } from "./customer-context";
import type { StrKey } from "@/lib/i18n";

const LEVEL_KEY: Record<ClassLevel, StrKey> = {
  basic: "level_basic",
  intermediate: "level_intermediate",
  advance: "level_advance",
};

/** Tone per level: calm → warm → strong, easiest to hardest. */
const LEVEL_STYLE: Record<ClassLevel, string> = {
  basic: "bg-sage/15 text-sage-deep",
  intermediate: "bg-[rgba(193,160,121,0.2)] text-[#8a6b3f]",
  advance: "bg-rose/15 text-[#a56a52]",
};

/** The level's colour as a solid dot — for the pill that sits on a photo. */
const LEVEL_DOT: Record<ClassLevel, string> = {
  basic: "#6E7C60",
  intermediate: "#B08A52",
  advance: "#A56A52",
};

export function LevelBadge({ level, size = "sm" }: { level: ClassLevel | null; size?: "sm" | "md" }) {
  const { t } = useCustomerLang();
  if (!level) return null;

  // The class screen puts this over the hero PHOTO. A see-through tint vanished
  // against it (owner, 2026-09-28), so there it is a solid pill matching the format
  // pill beside it: opaque surface, border, shadow, dark text, the level's colour
  // carried by a dot. The tinted version stays for the schedule list, whose cards
  // are a plain cream background.
  if (size === "md") {
    return (
      <span className="inline-flex shrink-0 items-center gap-[7px] rounded-full border border-line bg-surface-2 px-[13px] py-1.5 shadow-soft">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: LEVEL_DOT[level] }}
          aria-hidden="true"
        />
        <span className="font-body text-[12px] font-semibold tracking-[0.03em] text-ink">
          {t(LEVEL_KEY[level])}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-[3px] font-body text-[10.5px] font-semibold ${LEVEL_STYLE[level]}`}
    >
      {t(LEVEL_KEY[level])}
    </span>
  );
}
