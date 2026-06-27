// Gating + fail-closed behaviour of the mockable integration adapters
// (lib/payments/index.ts, lib/line/index.ts) — security finding S1.
//
// The factories read PAYMENTS_MODE / LINE_MODE and FAIL CLOSED: unset/"mock"
// returns the mock impl (v1 dev), any other value (e.g. "live") THROWS at
// construction so production can never silently run on the always-paid PromptPay
// mock / log-only LINE mock. No DB needed.
//
// Each case resets the module registry so the factory's memoised singleton is
// re-evaluated against the env we set (the mode is read on first construction).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_PAYMENTS_MODE = process.env.PAYMENTS_MODE;
const ORIGINAL_LINE_MODE = process.env.LINE_MODE;

beforeEach(() => {
  vi.resetModules(); // fresh singleton per case
});
afterEach(() => {
  if (ORIGINAL_PAYMENTS_MODE === undefined) delete process.env.PAYMENTS_MODE;
  else process.env.PAYMENTS_MODE = ORIGINAL_PAYMENTS_MODE;
  if (ORIGINAL_LINE_MODE === undefined) delete process.env.LINE_MODE;
  else process.env.LINE_MODE = ORIGINAL_LINE_MODE;
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

  it("THROWS when PAYMENTS_MODE=live (no live provider wired)", async () => {
    process.env.PAYMENTS_MODE = "live";
    const { getPaymentProvider } = await import("@/lib/payments");
    expect(() => getPaymentProvider()).toThrow(/no live PromptPay provider is configured/);
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

  it("THROWS when LINE_MODE=live (no live client wired)", async () => {
    process.env.LINE_MODE = "live";
    const { getLineClient } = await import("@/lib/line");
    expect(() => getLineClient()).toThrow(/no live LINE client is configured/);
  });

  it("THROWS on any unrecognised LINE_MODE (fail closed)", async () => {
    process.env.LINE_MODE = "real";
    const { getLineClient } = await import("@/lib/line");
    expect(() => getLineClient()).toThrow();
  });
});
