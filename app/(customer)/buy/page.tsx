// Customer Buy-credits / packages screen (CLAUDE.md §4–§6, spec §1 pricing).
// Server component: it fetches the canonical purchasable catalog from the backend
// (listPackageCatalog) and the viewer's tier/household + pool balance server-side,
// then hands them to the client BuyView, which renders the chrome + balance recap
// and the CheckoutPanel (selection + PromptPay checkout). The active language is
// read from the CustomerLangProvider inside BuyView.
//
// Money is never computed here: prices, per-hour, hours and validity come from the
// catalog contract; the new balance after purchase comes from the confirmPayment
// outcome inside the panel. The balance *recap* is a display read of the current
// server-resolved pool (invariant 2), mirroring app/(customer)/home/page.tsx.

import { listPackageCatalog } from "@/lib/catalog/packages";
import { getCurrentUser } from "@/lib/auth/session";
import { getCreditOverview } from "@/lib/credits/selectPackage";
import { BuyView } from "@/components/customer/buy-view";

// Reads the live per-user pool for the recap — never static.
export const dynamic = "force-dynamic";

export default async function BuyCreditsPage() {
  const catalog = await listPackageCatalog();
  const viewer = await getCurrentUser();
  // Recap reads the real summed household pool + nearest expiry (invariant 2);
  // member/household status gates the sharing perk.
  const overview = await getCreditOverview(viewer);
  const isMember = viewer.tier === "member" && viewer.householdId !== null;

  return (
    <BuyView
      catalog={catalog}
      hours={overview.hours}
      nearestExpiryIso={overview.nearestExpiry ? overview.nearestExpiry.toISOString() : null}
      isMember={isMember}
      house={viewer.houseNumber ?? ""}
    />
  );
}
