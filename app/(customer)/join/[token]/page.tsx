// Household-invite landing (/join/<token>) — opened inside LINE LIFF when an
// invitee taps the share link (Feature 2: เชิญคนในบ้าน). The link carries ONLY the
// opaque token; identity is server-resolved inside acceptInvite (the client never
// supplies a userId/tier/household).
//
// Server component: resolves the token route param and hands it to the client
// JoinFlow, which calls acceptInvite(token) behind an explicit "Join household"
// button (never a blind side-effect) and renders the success / per-failure states.

import { JoinFlow } from "@/components/customer/join-flow";

// Next 15: dynamic route params are async.
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <JoinFlow token={token} />;
}
