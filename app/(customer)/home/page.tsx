import { getCurrentUser } from "@/lib/auth/session";
import { getCreditOverview } from "@/lib/credits/selectPackage";
import { getNextBooking } from "@/lib/bookings/queries";
import { listBookableClasses } from "@/lib/schedule/queries";
import { listMyWaitlist } from "@/lib/waitlist/queries";
import { currentWeekStart } from "@/components/customer/schedule-helpers";
import { HomeView } from "@/components/customer/home-view";

// Reads the live per-user household pool, so it must render per request — never
// statically prerendered with build-time (mock) data.
export const dynamic = "force-dynamic";

// Number of upcoming classes shown in the Home "This week" horizontal strip
// before "See all" takes over (mirrors lune-home.jsx's `.slice(0, 6)`).
const THIS_WEEK_LIMIT = 6;

// Customer Home (CLAUDE.md §4–§6, spec §4). Server component: resolve the viewer,
// the real summed household pool (invariant 2), the viewer's soonest upcoming
// booking, whether a live waitlist offer is outstanding, and the real bookable
// week (the SAME source the Schedule screen uses, so Home and Schedule never
// disagree — finding H2). Then hand them to the client HomeView, which reads the
// active language from the CustomerLangProvider. This view only renders + i18n —
// no business logic, no money math.
export default async function HomePage() {
  const now = new Date();
  const viewer = await getCurrentUser();
  const overview = await getCreditOverview(viewer);
  // The viewer's real soonest upcoming booking (or null → hide the card). Shaped
  // from the same read model as the My Bookings list, so the two never disagree.
  const next = await getNextBooking(viewer, now);
  // Does the viewer hold a LIVE waitlist offer right now? listMyWaitlist lazily
  // downgrades stale offers to `expired` server-side, so an `offered` entry here
  // is genuinely confirmable — surface a banner nudging them to /bookings.
  const hasOffer = (await listMyWaitlist(viewer)).some((w) => w.status === "offered");
  // Real bookable classes this week — same query/visibility the Schedule screen
  // uses (DB path filtered server-side; mock path gated behind DATABASE_URL).
  // Keep only still-upcoming, not-full slots and cap the preview, mirroring the
  // prototype's "upcoming this-week" subset.
  const week = (
    await listBookableClasses({
      viewer: { tier: viewer.tier },
      weekStart: currentWeekStart(now),
      now,
    })
  )
    .filter((c) => new Date(c.startsAt).getTime() > now.getTime() && !c.full)
    .slice(0, THIS_WEEK_LIMIT);

  return (
    <HomeView
      viewer={{ name: viewer.name, tier: viewer.tier, houseNumber: viewer.houseNumber }}
      overview={{
        hours: overview.hours,
        nearestExpiryIso: overview.nearestExpiry ? overview.nearestExpiry.toISOString() : null,
        isHouseholdPool: overview.isHouseholdPool,
      }}
      next={next}
      hasOffer={hasOffer}
      week={week}
    />
  );
}
