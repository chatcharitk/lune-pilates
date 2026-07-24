// Real (data-only) Thai PromptPay / EMVCo "merchant presented QR" payload
// generator. Pure, offline, synchronous — a PromptPay QR is a standardised text
// string any Thai banking app already knows how to parse; computing one needs
// only a PromptPay proxy id (mobile / national ID / e-Wallet) and, for a
// dynamic (amount-locked) QR, the THB amount. No merchant account, gateway API
// key, or bank integration is involved (CLAUDE.md §2 — the parts of PromptPay
// that DO need a real integration, i.e. payment STATUS, stay mocked/manual; see
// lib/payments/real.ts).
//
// Verified against a real bank-issued (SCB) static QR: decoding it with a plain
// TLV parser and re-deriving its CRC-16 here reproduces the bank's own checksum
// byte-for-byte (see tests/promptpay-payload.test.ts) — strong evidence this
// implementation is spec-correct, not just internally self-consistent.

/** TLV field: 2-digit id + 2-digit zero-padded length + value. */
function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — EMVCo tag 63. */
function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Normalise + encode a PromptPay proxy id into its EMVCo merchant-account
 * sub-field (tag 29, sub-tags 01/02/03). Throws on anything that isn't a
 * recognised proxy shape:
 *   - 10-digit mobile number (leading 0)  → sub-tag 01, country code 66 + the
 *     national number with the leading 0 dropped (the EMVCo PromptPay convention).
 *   - 13-digit national ID / tax ID       → sub-tag 02, verbatim.
 *   - 15-digit e-Wallet ID                → sub-tag 03, verbatim.
 */
function proxyField(rawId: string): string {
  const digits = rawId.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) {
    return tlv("01", "0066" + digits.slice(1));
  }
  if (digits.length === 13) return tlv("02", digits);
  if (digits.length === 15) return tlv("03", digits);
  throw new Error(
    `Invalid PromptPay id "${rawId}": expected a 10-digit mobile number (starting ` +
      `with 0), a 13-digit national/tax ID, or a 15-digit e-Wallet ID.`,
  );
}

/**
 * Throws if `id` is not a shape `buildPromptPayPayload` can encode. Call this
 * eagerly at provider construction so a misconfigured `PROMPTPAY_ID` fails at
 * startup, not on a customer's first checkout.
 */
export function assertValidPromptPayId(id: string): void {
  proxyField(id);
}

/**
 * Build a PromptPay EMVCo QR payload for `promptPayId`.
 *
 * Passing `amount` produces a DYNAMIC (one-time, amount-locked) QR — the
 * customer's banking app shows the exact THB amount and cannot edit it, so a
 * wrong-amount transfer is structurally impossible. Omitting it produces a
 * STATIC (reusable, any-amount) QR. LUNE always knows the price up front, so
 * every QR this app generates is dynamic in practice.
 *
 * `amount` must be a positive number; THB has no meaningful sub-satang unit in
 * this app (CLAUDE.md §8 — money is integer THB), but the EMVCo amount field
 * itself is always written with two decimal places, matching every other
 * PromptPay generator.
 */
export function buildPromptPayPayload(promptPayId: string, amount?: number): string {
  const dynamic = amount !== undefined && amount !== null;
  if (dynamic && !(Number.isFinite(amount) && amount > 0)) {
    throw new Error(`Invalid PromptPay amount: ${amount}`);
  }
  const merchantAccountInfo = tlv("00", "A000000677010111") + proxyField(promptPayId);
  let payload =
    tlv("00", "01") + // payload format indicator
    tlv("01", dynamic ? "12" : "11") + // point of initiation: 12 dynamic, 11 static
    tlv("29", merchantAccountInfo) + // PromptPay merchant account info
    tlv("53", "764") + // transaction currency: 764 = THB
    (dynamic ? tlv("54", amount.toFixed(2)) : "") + // transaction amount
    tlv("58", "TH"); // country code
  payload += "6304"; // CRC tag + length; the checksum covers this prefix
  return payload + crc16(payload);
}
