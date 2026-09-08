// Credit cost per booking, by class type (CLAUDE.md §5 invariant 1). Pure and
// unit-testable — the single place this mapping lives.
//
// ONE CREDIT = ONE CLASS, for every class type (owner's decision, 2026-09-08,
// supersedes the 2026-07-04 split where private/duo/trio cost 2).
//
// WHY IT CHANGED. Credits used to be spoken of as "hours", and a 1:1 class was
// priced at two of them. That made the customer-facing numbers untrue in both
// directions: the "1:1 · 10-hour pack" actually bought five classes, and the three
// ฿1,800–฿2,300 drop-in items granted a single credit — not enough to book the one
// class they were sold for, so a customer could pay and then book nothing. Making a
// credit mean exactly one class removes the discrepancy at its source, and lets the
// whole app say "class" where it used to say "hour".
//
// A package's SIZE is therefore now a class count, set by the owner per item in
// Settings → Packages.
import type { ClassType } from "@/lib/domain/types";

export function creditCostForClassType(_type: ClassType): number {
  return 1;
}
