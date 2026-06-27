// Class detail + booking (CLAUDE.md §4–§6, §5 invariant 7). Server component:
// resolve the viewer, fetch the class via getClassDetail (visibility enforced
// server-side), and resolve the truthful per-type cost + usable pre-booking
// balance, then hand them to the client ClassDetailView, which reads the active
// language from the CustomerLangProvider and renders the screen + booking flow.

import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getClassDetail, getUsableBalance } from "@/lib/schedule/queries";
import { creditCostForClassType } from "@/lib/credits/cost";
import { ClassDetailView } from "@/components/customer/class-detail-view";

// Only multi-seat reformer classes (Group/Duo/Trio/Rental) get a seat picker —
// the user chooses which of several physical positions to take. A Private is
// capacity 1: there is exactly one reformer, nothing to pick, so we render no
// picker. Gate on the real capacity, not positions.length (the backend reports a
// single "middle" position for cap-1 classes too).
function classUsesPositions(capacity: number): boolean {
  return capacity > 1;
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  const detail = await getClassDetail(id, { tier: viewer.tier });
  if (!detail) notFound();

  // Truthful cost + pre-booking balance, both recomputed server-side. The cost
  // is the per-type credit cost (1 group / 1.5 private·duo·trio / 1 rental) the
  // debit actually charges. The balance is the SINGLE package the debit will
  // actually draw from (cost-aware selection) — NOT the whole-pool sum — so the
  // CTA, the "remaining after" estimate, and the real debit always agree.
  // getUsableBalance returns null when no single package can cover the cost, so the
  // panel hides the estimate and surfaces the no-credits state instead of promising
  // a booking the debit would then reject.
  const cost = creditCostForClassType(detail.type);
  const balanceBefore = await getUsableBalance(viewer, detail.type, new Date(), cost);

  return (
    <ClassDetailView
      detail={detail}
      cost={cost}
      balanceBefore={balanceBefore}
      usesPositions={classUsesPositions(detail.capacity)}
    />
  );
}
