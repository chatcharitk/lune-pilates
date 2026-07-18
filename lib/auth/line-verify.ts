// Server-side verification of a LIFF ID token. The customer LIFF client obtains an
// ID token (liff.getIDToken()) and sends it here; we verify it against LINE's
// endpoint — which checks the signature, expiry, and audience — so we can trust the
// LINE user id it yields. The client NEVER tells us who it is; this does.
//
// aud = the LINE Login channel id the LIFF app belongs to (LINE_LOGIN_CHANNEL_ID).

export interface LineIdentity {
  /** The stable LINE user id (JWT `sub`) — stored as users.line_user_id. */
  lineUserId: string;
  /** The member's LINE display name (JWT `name`), best-effort ("" if absent). */
  displayName: string;
}

/** POST the id token to LINE's verify endpoint. Returns null on any failure so a
 *  bad/expired token can only ever DENY, never impersonate. */
export async function verifyLiffIdToken(idToken: string): Promise<LineIdentity | null> {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId) {
    throw new Error("LINE_LOGIN_CHANNEL_ID is missing — required to verify LIFF ID tokens.");
  }
  if (!idToken || typeof idToken !== "string") return null;

  let res: Response;
  try {
    res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const obj = data as { sub?: unknown; name?: unknown; aud?: unknown };
  // Defensive: the endpoint already checks aud, but confirm it matches our channel.
  if (typeof obj?.sub !== "string" || (typeof obj.aud === "string" && obj.aud !== clientId)) {
    return null;
  }
  return {
    lineUserId: obj.sub,
    displayName: typeof obj.name === "string" ? obj.name : "",
  };
}
