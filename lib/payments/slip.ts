// Server-side validation of an uploaded PromptPay slip data-URL (Feature 3).
//
// Pure (no I/O) so it is unit-testable without a DB and is the SINGLE place the slip
// file rules live (CLAUDE.md §8 — never trust the client; recompute/verify
// server-side). The customer hands us a `data:<mime>;base64,<payload>` string; we:
//   - parse it and decode the base64 payload to bytes;
//   - GUARD the encoded length before fully decoding (a >5 MB image is ~6.7 MB of
//     base64 — reject early so a huge string can't force a large allocation);
//   - SNIFF the magic bytes of the DECODED image to confirm it is really a
//     JPEG / PNG / WebP — the declared data-URL mime is advisory and not trusted;
//   - enforce the decoded byte length is ≤ 5 MB.
// The returned mime is the SNIFFED one, not the declared prefix.

/** Allowed slip image types (sniffed, not merely declared). */
export const ALLOWED_SLIP_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type SlipMime = (typeof ALLOWED_SLIP_MIME)[number];

/** Max DECODED image size: 5 MB. */
export const MAX_SLIP_BYTES = 5 * 1024 * 1024;

/**
 * Hard upper bound on the base64 PAYLOAD length, checked BEFORE decoding so a
 * pathologically large string never gets fully decoded. base64 encodes 3 bytes as 4
 * chars, so 5 MB decodes from ≈ 6,990,508 chars; we allow a small slack for padding.
 */
const MAX_BASE64_CHARS = Math.ceil((MAX_SLIP_BYTES / 3) * 4) + 8;

export type SlipValidationError = "INVALID_FILE" | "TOO_LARGE";

export type SlipValidationResult =
  | { ok: true; bytes: Buffer; mimeType: SlipMime; sizeBytes: number }
  | { ok: false; code: SlipValidationError };

/** The leading bytes of a buffer formatted for magic-byte comparison. */
function startsWith(buf: Buffer, sig: readonly number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Sniff the real image type from the decoded bytes' magic numbers. Returns the
 * canonical mime, or null when the bytes are not one of the allowed image types.
 *   JPEG → FF D8 FF
 *   PNG  → 89 50 4E 47 0D 0A 1A 0A
 *   WebP → "RIFF" …. "WEBP" (bytes 0–3 = RIFF, bytes 8–11 = WEBP)
 */
function sniffMime(buf: Buffer): SlipMime | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (
    buf.length >= 12 &&
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Validate an uploaded slip data-URL. Returns the decoded bytes + the SNIFFED mime +
 * the decoded size on success, or an error code:
 *   - INVALID_FILE: not a base64 data-URL, undecodable, or not a JPEG/PNG/WebP;
 *   - TOO_LARGE: the decoded image exceeds 5 MB (guarded pre-decode by length too).
 */
export function validateSlipDataUrl(dataUrl: string): SlipValidationResult {
  // Shape: data:<mediatype>;base64,<payload>. We only accept base64 data-URLs.
  const match = /^data:([\w.+/-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return { ok: false, code: "INVALID_FILE" };

  const payload = match[2] ?? "";
  if (payload.length === 0) return { ok: false, code: "INVALID_FILE" };

  // Pre-decode size guard: reject an over-long base64 string before allocating.
  if (payload.length > MAX_BASE64_CHARS) return { ok: false, code: "TOO_LARGE" };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    return { ok: false, code: "INVALID_FILE" };
  }
  // Buffer.from is lenient with junk; require a non-trivial decode.
  if (bytes.length === 0) return { ok: false, code: "INVALID_FILE" };

  // Sniff the REAL type from the decoded bytes — the declared mime is not trusted.
  const mimeType = sniffMime(bytes);
  if (!mimeType) return { ok: false, code: "INVALID_FILE" };

  if (bytes.length > MAX_SLIP_BYTES) return { ok: false, code: "TOO_LARGE" };

  return { ok: true, bytes, mimeType, sizeBytes: bytes.length };
}
