import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";
import { RealPromptPayProvider } from "./real";

let _payments: PaymentProvider | null = null;

/**
 * Resolve the payment provider by `PAYMENTS_MODE` (CLAUDE.md §2 — the mockable
 * adapter boundary).
 *
 *   - unset / "mock" → the v1 mock: a fake QR payload and an always-"paid" status.
 *   - "live"         → `RealPromptPayProvider` — a REAL, scannable PromptPay QR
 *     against `PROMPTPAY_ID` (no bank/gateway integration; QR generation is an
 *     offline standard, see lib/payments/promptpay.ts). Its `getStatus()` still
 *     always resolves "paid" — a deliberate, documented trade-off (there is no
 *     payment gateway to ask), not a silent gap: see the class-level doc in
 *     lib/payments/real.ts for exactly why that is safe (the only caller is an
 *     owner-gated, front-desk-triggered action; the customer flow's real money
 *     gate is slip upload + admin review and never calls this).
 *   - anything else → throws at construction (fail closed — a typo in the env
 *     var must never silently fall back to the always-paid mock in production).
 */
export function getPaymentProvider(): PaymentProvider {
  if (!_payments) {
    const mode = process.env.PAYMENTS_MODE ?? "mock";
    if (mode === "mock") {
      _payments = new MockPaymentProvider();
    } else if (mode === "live") {
      _payments = new RealPromptPayProvider();
    } else {
      throw new Error(`Unknown PAYMENTS_MODE="${mode}". Use "mock" or "live".`);
    }
  }
  return _payments;
}

export type { PaymentProvider, PromptPayCharge, ChargeStatus } from "./types";
