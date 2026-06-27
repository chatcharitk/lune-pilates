// Credit cost per booking, by class type (CLAUDE.md §5 invariant 1, decided
// 2026-06-17). Pure and unit-testable — the single place this mapping lives.
//
// Mirrors lune-pilates/project/lune-detail.jsx (`cost = type === 'private' ? 1.5 : 1`)
// extended per the 2026-06-17 decision so every 1:1-format class (private, duo,
// trio) costs the same 1.5 credits, while shared group classes cost 1.0.
//
// Costs are half-hour granular (numeric(4,1) in the DB); never floats beyond .5.

import type { ClassType } from "@/lib/domain/types";

export function creditCostForClassType(type: ClassType): number {
  switch (type) {
    case "group":
      return 1;
    case "private":
    case "duo":
    case "trio":
      return 1.5;
    case "rental":
      // review: rental currently settles 1 credit like group; the rate for
      // studio rentals is not finalised in the spec. Revisit when confirmed.
      return 1;
  }
}
