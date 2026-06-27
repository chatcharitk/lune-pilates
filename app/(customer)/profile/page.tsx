// Customer Profile screen (completeness findings C1/C2/H1; mirrors lune-extra.jsx
// `ProfileScreen`). Server component: fetch the server-resolved ProfileOverview
// (identity, shared-pool balance, housemates, package purchase history) via
// getProfileOverview — all single-sourced server-side (CLAUDE.md §5/§8) — then
// hand it to the client ProfileView, which reads the active language from the
// CustomerLangProvider. No identity, balance or price is trusted from the client.

import { getProfileOverview } from "@/lib/customer/profile";
import { ProfileView } from "@/components/customer/profile-view";

// Reads the live per-user pool + household + history per request — never static.
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const overview = await getProfileOverview();
  return <ProfileView overview={overview} />;
}
