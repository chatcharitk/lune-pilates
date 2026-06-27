// Payment boundary (PromptPay). v1 ships a mock that simulates a successful
// charge; a real PromptPay provider implements the same interface later.

export interface PromptPayCharge {
  chargeId: string;
  /** EMVCo QR payload string the client renders as a QR code. */
  qrPayload: string;
  amount: number; // THB, integer
  reference: string;
}

export type ChargeStatus = "pending" | "paid" | "expired";

export interface PaymentProvider {
  createPromptPayCharge(params: { amount: number; reference: string }): Promise<PromptPayCharge>;
  getStatus(chargeId: string): Promise<ChargeStatus>;
}
