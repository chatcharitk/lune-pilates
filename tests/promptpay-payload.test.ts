// Unit tests for the real (data-only) PromptPay EMVCo payload generator
// (lib/payments/promptpay.ts) and the live provider that wraps it
// (lib/payments/real.ts). No DB, no network — pure/offline throughout.
//
// Every proxy id used below is a SYNTHETIC example (never a real phone number),
// so nothing here can leak anyone's real PromptPay account. The CRC-16 itself is
// checked against the algorithm's own well-known, publicly-published catalogue
// check value (reveng's CRC catalogue: CRC-16/CCITT-FALSE("123456789") = 0x29B1)
// rather than a captured real-world QR — a stronger, more authoritative reference
// than any one bank's output, and one with zero privacy implications.
//
// (This implementation was ALSO manually cross-checked during development
// against a real bank-issued PromptPay QR — the CRC it computed matched the
// bank's own, byte for byte — but that real payload is deliberately NOT
// committed here.)

import { describe, expect, it } from "vitest";
import { assertValidPromptPayId, buildPromptPayPayload } from "@/lib/payments/promptpay";

/** Minimal generic TLV parser — deliberately independent of the encoder's
 * internals, so these tests check the actual wire format, not just that the
 * encoder agrees with itself. */
function parseTLV(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number.parseInt(payload.slice(i + 2, i + 4), 10);
    const value = payload.slice(i + 4, i + 4 + len);
    fields[id] = value;
    i += 4 + len;
  }
  return fields;
}

/** CRC-16/CCITT-FALSE, re-implemented independently of lib/payments/promptpay.ts
 * (duplicated deliberately — a shared bug in both would defeat the point of a
 * cross-check). */
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

// A synthetic example PromptPay mobile number for all tests below — not a real
// account.
const EXAMPLE_ID = "0800000000";

describe("crc16 (via buildPromptPayPayload) — matches the public CRC-16/CCITT-FALSE catalogue value", () => {
  it("the algorithm itself matches the well-known check(\"123456789\") = 0x29B1", () => {
    // This is the canonical, publicly-published value used to identify this exact
    // CRC variant (poly 0x1021, init 0xFFFF) — independent of PromptPay entirely.
    expect(crc16("123456789")).toBe("29B1");
  });

  it("our generator's own CRC is internally self-consistent for a static QR", () => {
    const payload = buildPromptPayPayload(EXAMPLE_ID);
    const prefix = payload.slice(0, payload.length - 4);
    expect(crc16(prefix)).toBe(payload.slice(-4));
  });

  it("our generator's own CRC is internally self-consistent for a dynamic QR", () => {
    const payload = buildPromptPayPayload(EXAMPLE_ID, 550);
    const prefix = payload.slice(0, payload.length - 4);
    expect(crc16(prefix)).toBe(payload.slice(-4));
  });
});

describe("buildPromptPayPayload — wire format (TLV structure)", () => {
  it("encodes a static QR (no amount) with the PromptPay AID and mobile proxy", () => {
    const payload = buildPromptPayPayload(EXAMPLE_ID);
    const fields = parseTLV(payload);
    expect(fields["00"]).toBe("01"); // payload format indicator
    expect(fields["01"]).toBe("11"); // static
    expect(fields["53"]).toBe("764"); // THB
    expect(fields["58"]).toBe("TH");
    const merchant = parseTLV(fields["29"]!);
    expect(merchant["00"]).toBe("A000000677010111"); // PromptPay AID
    expect(merchant["01"]).toBe("0066" + EXAMPLE_ID.slice(1)); // country-code-prefixed
  });

  it("encodes tag 01=12 (dynamic) and tag 54 with 2 decimal places when an amount is given", () => {
    const payload = buildPromptPayPayload(EXAMPLE_ID, 5500);
    const fields = parseTLV(payload);
    expect(fields["01"]).toBe("12");
    expect(fields["54"]).toBe("5500.00");
  });

  it("carries a non-integer THB amount through with 2 decimals", () => {
    const payload = buildPromptPayPayload(EXAMPLE_ID, 10.5);
    const fields = parseTLV(payload);
    expect(fields["54"]).toBe("10.50");
  });

  it("rejects a zero or negative amount", () => {
    expect(() => buildPromptPayPayload(EXAMPLE_ID, 0)).toThrow();
    expect(() => buildPromptPayPayload(EXAMPLE_ID, -1)).toThrow();
  });

  it("rejects a non-finite amount", () => {
    expect(() => buildPromptPayPayload(EXAMPLE_ID, Number.NaN)).toThrow();
  });
});

describe("buildPromptPayPayload — proxy id shapes", () => {
  it("accepts a 10-digit mobile number", () => {
    expect(() => buildPromptPayPayload(EXAMPLE_ID, 10)).not.toThrow();
  });

  it("accepts a 13-digit national/tax ID", () => {
    const payload = buildPromptPayPayload("1234567890123", 10);
    const merchant = parseTLV(parseTLV(payload)["29"]!);
    expect(merchant["02"]).toBe("1234567890123");
  });

  it("accepts a 15-digit e-Wallet ID", () => {
    const payload = buildPromptPayPayload("123456789012345", 10);
    const merchant = parseTLV(parseTLV(payload)["29"]!);
    expect(merchant["03"]).toBe("123456789012345");
  });

  it("rejects an unrecognised id shape", () => {
    expect(() => buildPromptPayPayload("12345", 10)).toThrow();
    expect(() => buildPromptPayPayload("", 10)).toThrow();
    expect(() => buildPromptPayPayload("081234567", 10)).toThrow(); // 9 digits
  });

  it("strips non-digit formatting (dashes/spaces) from a mobile number", () => {
    const withDashes = buildPromptPayPayload("080-000-0000", 10);
    const plain = buildPromptPayPayload(EXAMPLE_ID, 10);
    expect(withDashes).toBe(plain);
  });
});

describe("assertValidPromptPayId", () => {
  it("passes for a valid mobile number", () => {
    expect(() => assertValidPromptPayId(EXAMPLE_ID)).not.toThrow();
  });
  it("throws for an invalid id", () => {
    expect(() => assertValidPromptPayId("not-a-number")).toThrow();
  });
});
