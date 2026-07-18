// No-DB unit tests for the live LINE integration primitives: the customer session
// cookie, Thai phone normalization, LIFF ID-token verification (mocked fetch), and
// the live Messaging client (mocked fetch). The full LIFF handshake is browser-only
// and verified on-device; these cover the server-side logic a bad input must not slip.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signCustomerSession,
  verifyCustomerSession,
} from "@/lib/auth/customer-session";
import { normalizeThaiPhone } from "@/lib/util/phone";
import { verifyLiffIdToken } from "@/lib/auth/line-verify";
import { LiveLineClient } from "@/lib/line/live";

describe("customer session cookie (HMAC)", () => {
  const secret = "line-channel-secret-abc123";
  const now = 1_800_000_000;

  it("round-trips a valid token", () => {
    const token = signCustomerSession({ uid: "u1", exp: now + 100 }, secret);
    expect(verifyCustomerSession(token, secret, now)).toEqual({ uid: "u1", exp: now + 100 });
  });
  it("rejects expired / wrong-secret / tampered", () => {
    const token = signCustomerSession({ uid: "u1", exp: now + 100 }, secret);
    expect(verifyCustomerSession(token, secret, now + 200)).toBeNull(); // expired
    expect(verifyCustomerSession(token, "other-secret-xyz", now)).toBeNull(); // wrong key
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "attacker", exp: now + 100 })).toString("base64url");
    expect(verifyCustomerSession(`${forged}.${sig}`, secret, now)).toBeNull();
    expect(verifyCustomerSession("garbage", secret, now)).toBeNull();
  });
});

describe("normalizeThaiPhone", () => {
  it("keeps a canonical 10-digit mobile", () => {
    expect(normalizeThaiPhone("0812345678")).toBe("0812345678");
  });
  it("strips spaces / dashes", () => {
    expect(normalizeThaiPhone("081-234-5678")).toBe("0812345678");
    expect(normalizeThaiPhone(" 081 234 5678 ")).toBe("0812345678");
  });
  it("accepts +66 / 66 international prefixes", () => {
    expect(normalizeThaiPhone("+66812345678")).toBe("0812345678");
    expect(normalizeThaiPhone("66812345678")).toBe("0812345678");
  });
  it("rejects invalid numbers", () => {
    expect(normalizeThaiPhone("123")).toBeNull();
    expect(normalizeThaiPhone("0812345")).toBeNull();
    expect(normalizeThaiPhone("1812345678")).toBeNull(); // must start with 0
    expect(normalizeThaiPhone("")).toBeNull();
  });
});

describe("verifyLiffIdToken (mocked fetch)", () => {
  const ORIGINAL = process.env.LINE_LOGIN_CHANNEL_ID;
  beforeEach(() => {
    process.env.LINE_LOGIN_CHANNEL_ID = "2010746679";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL === undefined) delete process.env.LINE_LOGIN_CHANNEL_ID;
    else process.env.LINE_LOGIN_CHANNEL_ID = ORIGINAL;
  });

  function stubFetch(status: number, json: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
        text: async () => "",
      })),
    );
  }

  it("returns identity for a valid token with matching aud", async () => {
    stubFetch(200, { sub: "Uabc", name: "Pim", aud: "2010746679" });
    expect(await verifyLiffIdToken("tok")).toEqual({ lineUserId: "Uabc", displayName: "Pim" });
  });
  it("rejects an aud that isn't our channel", async () => {
    stubFetch(200, { sub: "Uabc", name: "Pim", aud: "9999" });
    expect(await verifyLiffIdToken("tok")).toBeNull();
  });
  it("rejects a non-2xx response and a missing sub", async () => {
    stubFetch(400, { error: "invalid" });
    expect(await verifyLiffIdToken("tok")).toBeNull();
    stubFetch(200, { name: "Pim" });
    expect(await verifyLiffIdToken("tok")).toBeNull();
  });
});

describe("LiveLineClient (mocked fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws when constructed without a token", () => {
    expect(() => new LiveLineClient("")).toThrow(/LINE_CHANNEL_ACCESS_TOKEN/);
  });

  it("pushes a text message to the right endpoint with the bearer token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => "" };
      }),
    );
    await new LiveLineClient("tok123").push("Uabc", "hello");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.line.me/v2/bot/message/push");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok123");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      to: "Uabc",
      messages: [{ type: "text", text: "hello" }],
    });
  });

  it("throws on a non-2xx LINE response (so the bus logs it, best-effort)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "invalid token" })),
    );
    await expect(new LiveLineClient("tok").broadcast("hi")).rejects.toThrow(/401/);
  });
});
