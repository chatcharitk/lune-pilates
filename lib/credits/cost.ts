// Credit cost per booking, by class type (CLAUDE.md §5 invariant 1). Pure and
// unit-testable — the single place this mapping lives.
//
// Costs are whole integer credits (decided 2026-06: credits are integers): shared
// group classes and studio rentals cost 1; the 1:1-format classes (private, duo,
// trio) each cost 2.

import type { ClassType } from "@/lib/domain/types";

export function creditCostForClassType(type: ClassType): number {
  switch (type) {
    case "group":
      return 1;
    case "private":
    case "duo":
    case "trio":
      return 2;
    case "rental":
      return 1;
  }
}
