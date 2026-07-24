import { randomUUID } from "node:crypto";
import type { ChargeStatus, PaymentProvider, PromptPayCharge } from "./types";
import { assertValidPromptPayId, buildPromptPayPayload } from "./promptpay";

/**
 * Real (data-only) PromptPay provider: generates an authentic, scannable EMVCo
 * QR against the studio's own PromptPay account (`PROMPTPAY_ID`). This needs no
 * bank/gateway integration — a PromptPay QR is an offline-computable standard,
 * not an API call (see lib/payments/promptpay.ts).
 *
 * `getStatus()` intentionally always resolves "paid". THIS IS A DELIBERATE,
 * DOCUMENTED TRADE-OFF, not an oversight or a regression of the mock's behaviour:
 *
 *   - LUNE has no payment-gateway or bank-API integration (CLAUDE.md §2 — v1
 *     ships PromptPay mocked/manual; a real gateway like Omise/2C2P/a bank
 *     merchant API is a materially bigger integration — merchant onboarding,
 *     KYC, per-transaction fees — explicitly out of v1 scope). There is
 *     therefore no way to ask "has this actually been paid?" programmatically.
 *   - The ONLY caller of `getStatus()` is `posConfirmPayment`
 *     (app/actions/admin-pos.ts) — an owner-gated action the FRONT DESK presses
 *     only after visually confirming the transfer landed in the studio's own
 *     banking app. That human check is the real verification step; it is the
 *     same trust level as the existing cash-sale path (also credited on the
 *     front desk's word, with no independent verification) — this is not a
 *     new or weaker trust boundary, just the same one extended to PromptPay.
 *   - The CUSTOMER self-checkout flow does NOT use this at all: Feature 3 (slip
 *     upload + admin photo review, app/actions/purchase.ts + admin-payments.ts)
 *     is its money gate, and never calls `getStatus()`.
 *
 * If a real payment gateway is integrated later, replace `getStatus()` with a
 * genuine webhook/API check — do not assume this class's behaviour extends to
 * that case.
 */
export class RealPromptPayProvider implements PaymentProvider {
  private readonly promptPayId: string;

  constructor() {
    const id = process.env.PROMPTPAY_ID?.trim();
    if (!id) {
      throw new Error(
        "PAYMENTS_MODE=live requires PROMPTPAY_ID (the studio's PromptPay mobile " +
          "number, national/tax ID, or e-Wallet ID) to be set.",
      );
    }
    // Validate eagerly so a malformed id fails at startup, not on first checkout.
    assertValidPromptPayId(id);
    this.promptPayId = id;
  }

  async createPromptPayCharge(params: {
    amount: number;
    reference: string;
  }): Promise<PromptPayCharge> {
    const chargeId = `pp_${randomUUID()}`;
    const qrPayload = buildPromptPayPayload(this.promptPayId, params.amount);
    return { chargeId, qrPayload, amount: params.amount, reference: params.reference };
  }

  async getStatus(_chargeId: string): Promise<ChargeStatus> {
    return "paid";
  }
}
