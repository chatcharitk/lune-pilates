import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";

let _payments: PaymentProvider | null = null;

/**
 * Resolve the payment provider by `PAYMENTS_MODE` (CLAUDE.md §2 — PromptPay is
 * mocked in v1 behind a clean interface).
 *
 * Fails CLOSED (security finding S1): the mock's `getStatus()` reports "paid"
 * unconditionally — correct for v1 dev, but a production operator who flips
 * `PAYMENTS_MODE=live` must NOT silently keep running on the always-paid mock and
 * grant credits for unpaid PromptPay. There is no real provider wired yet, so any
 * non-"mock" value throws at construction rather than degrading to the mock.
 *
 *   - unset / "mock" → the v1 mock (default for dev).
 *   - "live" (or any other value) → throw; wire the real PromptPay provider here.
 */
export function getPaymentProvider(): PaymentProvider {
  if (!_payments) {
    const mode = process.env.PAYMENTS_MODE ?? "mock";
    if (mode !== "mock") {
      // When a real PromptPay provider is wired, construct it for "live" here.
      throw new Error(
        `PAYMENTS_MODE=${mode} but no live PromptPay provider is configured. ` +
          `Set PAYMENTS_MODE=mock for v1, or wire a real provider in lib/payments/index.ts.`,
      );
    }
    _payments = new MockPaymentProvider();
  }
  return _payments;
}

export type { PaymentProvider, PromptPayCharge, ChargeStatus } from "./types";
