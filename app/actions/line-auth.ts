"use server";

// Customer LINE-login server actions (LINE_MODE=live). The LIFF client verifies who
// the LINE user is (an ID token), sends it here, and we resolve them to a users row
// and mint the customer session cookie (lib/auth/customer-session).
//
// Onboarding = MATCH BY PHONE (decided with the owner): a first-time LINE identity
// with no linked users row is asked for their phone; if the front desk already
// created that member/household record, we LINK the LINE id onto it (so their shared
// household credits appear); otherwise we create a fresh guest. Identity is only ever
// derived from the verified ID token — never from client-supplied fields (§8).

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyLiffIdToken } from "@/lib/auth/line-verify";
import { normalizeThaiPhone } from "@/lib/util/phone";
import {
  CUSTOMER_COOKIE,
  CUSTOMER_SESSION_TTL_SECONDS,
  customerSessionSecret,
  signCustomerSession,
} from "@/lib/auth/customer-session";

function isLive(): boolean {
  return process.env.LINE_MODE === "live";
}

/** Mint + set the signed customer session cookie for `uid`. */
async function setCustomerSession(uid: string): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = signCustomerSession(
    { uid, exp: nowSeconds + CUSTOMER_SESSION_TTL_SECONDS },
    customerSessionSecret(),
  );
  const store = await cookies();
  store.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CUSTOMER_SESSION_TTL_SECONDS,
  });
}

const idTokenInput = z.object({ idToken: z.string().min(1).max(4096) });

export type EstablishLineSessionResult =
  | { ok: true; status: "signed_in" | "needs_phone" }
  | { ok: false; code: "NOT_LIVE" | "INVALID_TOKEN" };

/**
 * Verify the LIFF ID token and, if this LINE id is already linked to a customer,
 * sign them in. If not, return "needs_phone" so the client collects a phone to link.
 */
export async function establishLineSession(raw: unknown): Promise<EstablishLineSessionResult> {
  if (!isLive()) return { ok: false, code: "NOT_LIVE" };
  const parsed = idTokenInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_TOKEN" };

  const identity = await verifyLiffIdToken(parsed.data.idToken);
  if (!identity) return { ok: false, code: "INVALID_TOKEN" };

  const db = getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.lineUserId, identity.lineUserId))
    .limit(1);

  if (existing) {
    // Refresh their LINE photo on each sign-in.
    await db.update(users).set({ linePictureUrl: identity.pictureUrl }).where(eq(users.id, existing.id));
    await setCustomerSession(existing.id);
    return { ok: true, status: "signed_in" };
  }
  return { ok: true, status: "needs_phone" };
}

const linkInput = z.object({
  idToken: z.string().min(1).max(4096),
  phone: z.string().min(1).max(40),
});

export type LinkLineByPhoneResult =
  | { ok: true }
  | { ok: false; code: "NOT_LIVE" | "INVALID_TOKEN" | "INVALID_PHONE" | "PHONE_TAKEN" };

/**
 * Link (or create) a customer for this LINE identity by phone. Re-verifies the ID
 * token (stateless — no trust carried from establishLineSession), then:
 *   - phone matches a record with NO LINE link yet → link the LINE id onto it;
 *   - phone matches a record already linked to THIS LINE id → sign in (idempotent);
 *   - phone matches a record linked to a DIFFERENT LINE id → PHONE_TAKEN;
 *   - no match → create a new guest with this phone + LINE id.
 */
export async function linkLineByPhone(raw: unknown): Promise<LinkLineByPhoneResult> {
  if (!isLive()) return { ok: false, code: "NOT_LIVE" };
  const parsed = linkInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_TOKEN" };

  const identity = await verifyLiffIdToken(parsed.data.idToken);
  if (!identity) return { ok: false, code: "INVALID_TOKEN" };

  const phone = normalizeThaiPhone(parsed.data.phone);
  if (!phone) return { ok: false, code: "INVALID_PHONE" };

  const db = getDb();

  // Race/idempotency: this LINE id may already be linked (double submit) — sign in.
  const [alreadyLinked] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.lineUserId, identity.lineUserId))
    .limit(1);
  if (alreadyLinked) {
    await db.update(users).set({ linePictureUrl: identity.pictureUrl }).where(eq(users.id, alreadyLinked.id));
    await setCustomerSession(alreadyLinked.id);
    return { ok: true };
  }

  const [byPhone] = await db
    .select({ id: users.id, lineUserId: users.lineUserId })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);

  if (byPhone) {
    if (byPhone.lineUserId && byPhone.lineUserId !== identity.lineUserId) {
      return { ok: false, code: "PHONE_TAKEN" };
    }
    // Unlinked (or already ours) → link the LINE id + photo onto the existing record.
    await db
      .update(users)
      .set({ lineUserId: identity.lineUserId, linePictureUrl: identity.pictureUrl })
      .where(eq(users.id, byPhone.id));
    await setCustomerSession(byPhone.id);
    return { ok: true };
  }

  // No record for this phone → create a fresh guest.
  try {
    const [created] = await db
      .insert(users)
      .values({
        phone,
        name: identity.displayName.trim() || phone,
        tier: "guest",
        lineUserId: identity.lineUserId,
        linePictureUrl: identity.pictureUrl,
      })
      .returning({ id: users.id });
    await setCustomerSession(created!.id);
    return { ok: true };
  } catch {
    // Lost a create race on the same phone — re-read and sign in.
    const [row] = await db
      .select({ id: users.id, lineUserId: users.lineUserId })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    if (row && (!row.lineUserId || row.lineUserId === identity.lineUserId)) {
      if (!row.lineUserId) {
        await db.update(users).set({ lineUserId: identity.lineUserId }).where(eq(users.id, row.id));
      }
      await setCustomerSession(row.id);
      return { ok: true };
    }
    return { ok: false, code: "PHONE_TAKEN" };
  }
}

/** Clear the customer session (sign out). */
export async function logoutLine(): Promise<void> {
  const store = await cookies();
  store.delete(CUSTOMER_COOKIE);
}
