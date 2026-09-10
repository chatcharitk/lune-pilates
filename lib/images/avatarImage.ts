// Server-side validation for an uploaded profile photo (instructor avatars).
//
// Deliberately standalone rather than reusing lib/payments/slip.ts's validator.
// That one guards the MONEY path — a customer's proof of payment — and is tuned for
// it (5 MB cap, slip-specific vocabulary). Avatars want a far tighter cap and have
// nothing to do with payments; sharing the function would couple an admin
// convenience to the payment path and invite a change made for one to affect the
// other. The magic-byte table is short enough that a copy is the cheaper trade.
//
// The client downscales to a small square before uploading, so anything arriving
// near this cap is either a bypassed client or a bug — either way, refuse it.

/** Formats a browser can both produce via canvas and render everywhere. */
export const ALLOWED_AVATAR_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarMime = (typeof ALLOWED_AVATAR_MIME)[number];

/**
 * 400 KB of decoded image. A 256px square JPEG lands around 20–40 KB, so this
 * leaves room for a PNG or a higher-quality re-encode without ever letting a
 * full-size phone photo through into a database row.
 */
export const MAX_AVATAR_BYTES = 400 * 1024;

const MAX_BASE64_CHARS = Math.ceil((MAX_AVATAR_BYTES / 3) * 4) + 8;

export type AvatarValidationError = "INVALID_FILE" | "TOO_LARGE";

export type AvatarValidationResult =
  | { ok: true; bytes: Buffer; mimeType: AvatarMime; sizeBytes: number }
  | { ok: false; code: AvatarValidationError };

/**
 * Identify the real type from the leading bytes. The declared mime in the data URL
 * is caller-controlled and is never trusted — a `data:image/png` header on some
 * other payload must not be stored and later served back as an image.
 */
function sniffMime(buf: Buffer): AvatarMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Validate a `data:<mime>;base64,…` avatar upload. Never throws. */
export function validateAvatarDataUrl(dataUrl: string): AvatarValidationResult {
  const match = /^data:([\w.+/-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return { ok: false, code: "INVALID_FILE" };

  const payload = match[2] ?? "";
  if (payload.length === 0) return { ok: false, code: "INVALID_FILE" };
  // Reject an over-long string BEFORE allocating a buffer for it.
  if (payload.length > MAX_BASE64_CHARS) return { ok: false, code: "TOO_LARGE" };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    return { ok: false, code: "INVALID_FILE" };
  }
  // Buffer.from is lenient with junk; require a non-trivial decode.
  if (bytes.length === 0) return { ok: false, code: "INVALID_FILE" };

  const mimeType = sniffMime(bytes);
  if (!mimeType) return { ok: false, code: "INVALID_FILE" };
  if (bytes.length > MAX_AVATAR_BYTES) return { ok: false, code: "TOO_LARGE" };

  return { ok: true, bytes, mimeType, sizeBytes: bytes.length };
}

/**
 * The canonical data URL to STORE: rebuilt from the sniffed type and the decoded
 * bytes rather than echoing the caller's string, so a mismatched or decorated
 * header can never be persisted and served back.
 */
export function canonicalAvatarDataUrl(result: {
  bytes: Buffer;
  mimeType: AvatarMime;
}): string {
  return `data:${result.mimeType};base64,${result.bytes.toString("base64")}`;
}
