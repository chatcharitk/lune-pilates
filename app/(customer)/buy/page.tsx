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
import { hasEverPurchased } from "@/lib/catalog/eligibility";
import { getCurrentUser } from "@/lib/auth/session";
import { getCreditOverview } from "@/lib/credits/selectPackage";
import { loadActiveTerms } from "@/lib/settings/terms";
import { BuyView } from "@/components/customer/buy-view";

// Reads the live per-user pool for the recap — never static.
export const dynamic = "force-dynamic";

export default async function BuyCreditsPage() {
  const viewer = await getCurrentUser();
  // Trial offers are for first-time buyers only, so an existing customer never sees
  // one on the buy screen. createCheckout enforces the same rule server-side.
  const catalog = await listPackageCatalog({
    hasPurchasedBefore: await hasEverPurchased(viewer.id),
  });
  // Recap reads the real summed household pool + nearest expiry (invariant 2);
  // member/household status gates the sharing perk.
  const overview = await getCreditOverview(viewer);
  const isMember = viewer.tier === "member" && viewer.householdId !== null;
  // The T&C the customer must read + tick before a charge is opened. Fetched here
  // (server-side) so the panel renders the studio's CURRENT terms; createCheckout
  // re-checks the accepted version and refuses a stale one (TERMS_OUTDATED).
  const terms = await loadActiveTerms();

  return (
    <BuyView
      catalog={catalog}
      hours={overview.hours}
      nearestExpiryIso={overview.nearestExpiry ? overview.nearestExpiry.toISOString() : null}
      isMember={isMember}
      house={viewer.houseNumber ?? ""}
      terms={{
        id: terms.id,
        version: terms.version,
        body: { en: terms.bodyEn, th: terms.bodyTh },
      }}
    />
  );
}
