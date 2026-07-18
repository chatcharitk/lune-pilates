// Signed session cookie for the CUSTOMER app (the LINE-LIFF surface), the analogue
// of lib/auth/admin-session for staff. After LIFF verifies who the customer is, we
// mint an HMAC-signed cookie carrying only their users.id + expiry; every request
// resolves the customer from it with no LINE round-trip.
//
// Runs only in the Node.js runtime (server components / server actions) — there is
// no customer Edge middleware — so it uses node:crypto directly (simpler than the
// isomorphic Web-Crypto admin variant). The HMAC key is LINE_CHANNEL_SECRET, a
// stable server-only secret already required in live mode (no extra env var).

import { createHmac, timingSafeEqual } from "node:crypto";

export interface CustomerSessionPayload {
  /** users.id of the signed-in customer. */
  uid: string;
  /** expiry, epoch SECONDS. */
  exp: number;
}

export const CUSTOMER_COOKIE = "lune_customer";
/** 30 days — customers should rarely have to re-open the LIFF login. */
export const CUSTOMER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/** HMAC key for the customer cookie. Fails closed if the secret is unset. */
export function customerSessionSecret(): string {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || secret.length < 8) {
    throw new Error(
      "LINE_CHANNEL_SECRET is missing — it signs the customer session cookie. " +
        "Set it (from the Messaging API channel) before enabling LINE_MODE=live.",
    );
  }
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Sign a payload into a `body.sig` token. */
export function signCustomerSession(payload: CustomerSessionPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", secret).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

/**
 * Verify a token's signature + expiry and return its payload, or null when it is
 * malformed, tampered, wrong-secret, or expired. Never throws.
 */
export function verifyCustomerSession(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): CustomerSessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  try {
    const expected = createHmac("sha256", secret).update(body).digest();
    const given = Buffer.from(sigPart, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CustomerSessionPayload;
    if (typeof payload?.uid !== "string" || typeof payload?.exp !== "number" || payload.exp <= nowSeconds) {
      return null;
    }
    return { uid: payload.uid, exp: payload.exp };
  } catch {
    return null;
  }
}
