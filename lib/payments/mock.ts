import type { ChargeStatus, PaymentProvider, PromptPayCharge } from "./types";

/** v1 mock — issues a fake QR payload and reports "paid" immediately. */
export class MockPaymentProvider implements PaymentProvider {
  async createPromptPayCharge(params: {
    amount: number;
    reference: string;
  }): Promise<PromptPayCharge> {
    const chargeId = `mock_${Math.random().toString(36).slice(2, 10)}`;
    return {
      chargeId,
      qrPayload: `MOCKPROMPTPAY|${params.amount}|${params.reference}|${chargeId}`,
      amount: params.amount,
      reference: params.reference,
    };
  }

  async getStatus(_chargeId: string): Promise<ChargeStatus> {
    return "paid";
  }
}
