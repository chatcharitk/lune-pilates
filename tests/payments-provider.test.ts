// No-DB unit tests for RealPromptPayProvider's own behaviour (lib/payments/real.ts)
// — the charge shape it returns and its documented getStatus trade-off. Mode
// SELECTION (mock vs live, fail-closed on a missing/malformed PROMPTPAY_ID) is
// covered centrally alongside LINE in tests/adapters.test.ts; this file only
// covers what's specific to the PromptPay provider itself.

import { describe, expect, it } from "vitest";
import { RealPromptPayProvider } from "@/lib/payments/real";

describe("RealPromptPayProvider", () => {
  it("constructor throws when PROMPTPAY_ID is malformed", () => {
    const original = process.env.PROMPTPAY_ID;
    process.env.PROMPTPAY_ID = "not-a-valid-id";
    try {
      expect(() => new RealPromptPayProvider()).toThrow();
    } finally {
      if (original === undefined) delete process.env.PROMPTPAY_ID;
      else process.env.PROMPTPAY_ID = original;
    }
  });

  it("createPromptPayCharge returns a real, decodable QR payload for the configured id", async () => {
    const original = process.env.PROMPTPAY_ID;
    process.env.PROMPTPAY_ID = "0800000000";
    try {
      const provider = new RealPromptPayProvider();
      const charge = await provider.createPromptPayCharge({ amount: 5500, reference: "ref-1" });
      expect(charge.amount).toBe(5500);
      expect(charge.reference).toBe("ref-1");
      expect(charge.chargeId).toMatch(/^pp_/);
      expect(charge.qrPayload).toContain("5500.00");
      expect(charge.qrPayload).not.toContain("MOCKPROMPTPAY");
    } finally {
      if (original === undefined) delete process.env.PROMPTPAY_ID;
      else process.env.PROMPTPAY_ID = original;
    }
  });

  it("getStatus always resolves paid (the documented manual-confirmation trade-off)", async () => {
    const original = process.env.PROMPTPAY_ID;
    process.env.PROMPTPAY_ID = "0800000000";
    try {
      const provider = new RealPromptPayProvider();
      await expect(provider.getStatus("anything")).resolves.toBe("paid");
    } finally {
      if (original === undefined) delete process.env.PROMPTPAY_ID;
      else process.env.PROMPTPAY_ID = original;
    }
  });
});
