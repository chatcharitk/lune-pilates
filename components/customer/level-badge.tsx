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

export function LevelBadge({ level, size = "sm" }: { level: ClassLevel | null; size?: "sm" | "md" }) {
  const { t } = useCustomerLang();
  if (!level) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-body font-semibold ${
        size === "md" ? "px-2.5 py-1 text-[12px]" : "px-2 py-[3px] text-[10.5px]"
      } ${LEVEL_STYLE[level]}`}
    >
      {t(LEVEL_KEY[level])}
    </span>
  );
}
