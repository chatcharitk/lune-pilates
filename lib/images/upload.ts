// Server-side validation for an image the OWNER uploads to be served by link
// (Settings → Links & images).
//
// These are public-facing artwork — a LINE rich-menu background, a poster — so the
// cap is generous next to an avatar's: LINE itself accepts a rich-menu image up to
// 1 MB, and refusing a file the platform would have taken would be its own kind of
// bug. Everything else (decode, magic bytes, canonical re-encoding of the stored
// string) is the shared rule in ./sniff.

import { validateImageDataUrl, type ImageMime, type ImageValidationResult } from "./sniff";

/**
 * 2 MB of decoded image. Comfortably above LINE's 1 MB rich-menu limit so the owner
 * can upload the file they have and let LINE do the complaining about its own
 * limits, while still far below anything that would strain a database row.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function validateUploadDataUrl(dataUrl: string): ImageValidationResult {
  return validateImageDataUrl(dataUrl, MAX_UPLOAD_BYTES);
}

/**
 * The canonical data URL to STORE: rebuilt from the SNIFFED type and the decoded
 * bytes rather than echoing the caller's string, so a mismatched or decorated
 * header can never be persisted and served straight back to a browser.
 */
export function canonicalUploadDataUrl(result: { bytes: Buffer; mimeType: ImageMime }): string {
  return `data:${result.mimeType};base64,${result.bytes.toString("base64")}`;
}
