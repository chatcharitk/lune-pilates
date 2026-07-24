// Gating + fail-closed behaviour of the mockable integration adapters
// (lib/payments/index.ts, lib/line/index.ts) — security finding S1.
//
// The factories read PAYMENTS_MODE / LINE_MODE and FAIL CLOSED: unset/"mock"
// returns the mock impl (v1 dev); "live" constructs the real adapter and throws
// at construction if its required config is missing/invalid; any OTHER value
// throws unconditionally — production can never silently run on the always-paid
// PromptPay mock / log-only LINE mock because of a typo'd env var. No DB needed.
//
// Each case resets the module registry so the factory's memoised singleton is
// re-evaluated against the env we set (the mode is read on first construction).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_PAYMENTS_MODE = process.env.PAYMENTS_MODE;
const ORIGINAL_PROMPTPAY_ID = process.env.PROMPTPAY_ID;
const ORIGINAL_LINE_MODE = process.env.LINE_MODE;
const ORIGINAL_LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

beforeEach(() => {
  vi.resetModules(); // fresh singleton per case
});
afterEach(() => {
  if (ORIGINAL_PAYMENTS_MODE === undefined) delete process.env.PAYMENTS_MODE;
  else process.env.PAYMENTS_MODE = ORIGINAL_PAYMENTS_MODE;
  if (ORIGINAL_PROMPTPAY_ID === undefined) delete process.env.PROMPTPAY_ID;
  else process.env.PROMPTPAY_ID = ORIGINAL_PROMPTPAY_ID;
  if (ORIGINAL_LINE_MODE === undefined) delete process.env.LINE_MODE;
  else process.env.LINE_MODE = ORIGINAL_LINE_MODE;
  if (ORIGINAL_LINE_TOKEN === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  else process.env.LINE_CHANNEL_ACCESS_TOKEN = ORIGINAL_LINE_TOKEN;
});

describe("getPaymentProvider — mode gating (fail closed)", () => {
  it("returns a provider when PAYMENTS_MODE is unset (default mock)", async () => {
    delete process.env.PAYMENTS_MODE;
    const { getPaymentProvider } = await import("@/lib/payments");
    const provider = getPaymentProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.getStatus).toBe("function");
    expect(typeof provider.createPromptPayCharge).toBe("function");
  });

  it("returns a provider when PAYMENTS_MODE=mock", async () => {
    process.env.PAYMENTS_MODE = "mock";
    const { getPaymentProvider } = await import("@/lib/payments");
    expect(getPaymentProvider()).toBeDefined();
  });

  it("PAYMENTS_MODE=live constructs the real provider — fails closed WITHOUT PROMPTPAY_ID", async () => {
    process.env.PAYMENTS_MODE = "live";
    delete process.env.PROMPTPAY_ID;
    const { getPaymentProvider } = await import("@/lib/payments");
    expect(() => getPaymentProvider()).toThrow(/PROMPTPAY_ID/);
  });

  it("PAYMENTS_MODE=live returns the real provider when PROMPTPAY_ID is set", async () => {
    process.env.PAYMENTS_MODE = "live";
    process.env.PROMPTPAY_ID = "0800000000";
    const { getPaymentProvider } = await import("@/lib/payments");
    const { RealPromptPayProvider } = await import("@/lib/payments/real");
    expect(getPaymentProvider()).toBeInstanceOf(RealPromptPayProvider);
  });

  it("THROWS on any unrecognised PAYMENTS_MODE (fail closed, not silent mock)", async () => {
    process.env.PAYMENTS_MODE = "production";
    const { getPaymentProvider } = await import("@/lib/payments");
    expect(() => getPaymentProvider()).toThrow();
  });
});

describe("getLineClient — mode gating (fail closed)", () => {
  it("returns a client when LINE_MODE is unset (default mock)", async () => {
    delete process.env.LINE_MODE;
    const { getLineClient } = await import("@/lib/line");
    const client = getLineClient();
    expect(client).toBeDefined();
    expect(typeof client.push).toBe("function");
    expect(typeof client.broadcast).toBe("function");
  });

  it("returns a client when LINE_MODE=mock", async () => {
    process.env.LINE_MODE = "mock";
    const { getLineClient } = await import("@/lib/line");
    expect(getLineClient()).toBeDefined();
  });

  it("LINE_MODE=live constructs the live client — fails closed WITHOUT a token", async () => {
    process.env.LINE_MODE = "live";
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const { getLineClient } = await import("@/lib/line");
    expect(() => getLineClient()).toThrow(/LINE_CHANNEL_ACCESS_TOKEN/);
  });

  it("LINE_MODE=live returns the live client when a token is set", async () => {
    process.env.LINE_MODE = "live";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok123";
    const { getLineClient } = await import("@/lib/line");
    const client = getLineClient();
    expect(typeof client.push).toBe("function");
    expect(typeof client.broadcast).toBe("function");
  });

  it("THROWS on any unrecognised LINE_MODE (fail closed)", async () => {
    process.env.LINE_MODE = "real";
    const { getLineClient } = await import("@/lib/line");
    expect(() => getLineClient()).toThrow(/not a known mode/);
  });
});
