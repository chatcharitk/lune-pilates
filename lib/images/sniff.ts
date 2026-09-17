// Identify an image's REAL type from its leading bytes.
//
// Shared by every upload path (instructor avatars, the owner's uploaded images)
// because the rule is the same everywhere and must not drift: the mime declared in a
// `data:` URL is caller-controlled, so a `data:image/png` header on some other
// payload must never be stored and later served back as an image. The size caps and
// the error vocabulary stay with each caller — those genuinely differ.

/** Formats a browser can both produce via canvas and render everywhere. */
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

/** The type `buf` actually is, or null when it is not one we accept. */
export function sniffImageMime(buf: Buffer): ImageMime | null {
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

/**
 * Decode and check a `data:<mime>;base64,…` image, never throwing.
 *
 * `maxBytes` is the caller's own cap — an avatar and a rich-menu artwork have
 * nothing in common in size — and is checked BEFORE the buffer is allocated as well
 * as after decoding, so an over-long string cannot be turned into memory first.
 */
export type ImageValidationError = "INVALID_FILE" | "TOO_LARGE";

export type ImageValidationResult =
  | { ok: true; bytes: Buffer; mimeType: ImageMime; sizeBytes: number }
  | { ok: false; code: ImageValidationError };

export function validateImageDataUrl(dataUrl: string, maxBytes: number): ImageValidationResult {
  const match = /^data:([\w.+/-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return { ok: false, code: "INVALID_FILE" };

  const payload = match[2] ?? "";
  if (payload.length === 0) return { ok: false, code: "INVALID_FILE" };
  const maxBase64Chars = Math.ceil((maxBytes / 3) * 4) + 8;
  if (payload.length > maxBase64Chars) return { ok: false, code: "TOO_LARGE" };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, "base64");
  } catch {
    return { ok: false, code: "INVALID_FILE" };
  }
  // Buffer.from is lenient with junk; require a non-trivial decode.
  if (bytes.length === 0) return { ok: false, code: "INVALID_FILE" };

  const mimeType = sniffImageMime(bytes);
  if (!mimeType) return { ok: false, code: "INVALID_FILE" };
  if (bytes.length > maxBytes) return { ok: false, code: "TOO_LARGE" };

  return { ok: true, bytes, mimeType, sizeBytes: bytes.length };
}
