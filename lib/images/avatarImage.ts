// Server-side validation for an uploaded profile photo (instructor avatars).
//
// Deliberately standalone rather than reusing lib/payments/slip.ts's validator.
// That one guards the MONEY path — a customer's proof of payment — and is tuned for
// it (5 MB cap, slip-specific vocabulary). Avatars want a far tighter cap and have
// nothing to do with payments; sharing the function would couple an admin
// convenience to the payment path and invite a change made for one to affect the
// other.
//
// The decode + magic-byte check now live in ./sniff, shared with the owner's image
// uploads — the same rule, in one place. What stays here is the CAP and the avatar
// vocabulary, which is exactly the part that differs per caller.
//
// The client downscales to a small square before uploading, so anything arriving
// near this cap is either a bypassed client or a bug — either way, refuse it.

import {
  validateImageDataUrl,
  type ImageMime,
  type ImageValidationError,
} from "./sniff";

/** Formats a browser can both produce via canvas and render everywhere. */
export { ALLOWED_IMAGE_MIME as ALLOWED_AVATAR_MIME } from "./sniff";
export type AvatarMime = ImageMime;

/**
 * 400 KB of decoded image. A 256px square JPEG lands around 20–40 KB, so this
 * leaves room for a PNG or a higher-quality re-encode without ever letting a
 * full-size phone photo through into a database row.
 */
export const MAX_AVATAR_BYTES = 400 * 1024;

export type AvatarValidationError = ImageValidationError;

export type AvatarValidationResult =
  | { ok: true; bytes: Buffer; mimeType: AvatarMime; sizeBytes: number }
  | { ok: false; code: AvatarValidationError };

/**
 * Validate a `data:<mime>;base64,…` avatar upload. Never throws.
 *
 * The decode and the magic-byte check live in ./sniff, shared with the owner's
 * image uploads; only the CAP is the avatar's own — an avatar that arrives near
 * this size is a bypassed client or a bug, since the client downscales to a small
 * square before uploading.
 */
export function validateAvatarDataUrl(dataUrl: string): AvatarValidationResult {
  return validateImageDataUrl(dataUrl, MAX_AVATAR_BYTES);
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
