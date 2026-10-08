// Browser-side handling of a chosen PromptPay slip image, shared by the customer
// checkout and the admin "attach slip" (2026-10-08): pre-validate the file, then
// downscale big phone photos to a small JPEG data-URL for the upload action. The
// SERVER gate (lib/payments/slip.ts) is still the real authority.

// Client-side pre-validation mirrors the SERVER gate (lib/payments/slip.ts) so a
// bad file is caught instantly — but the server is the real authority (CLAUDE.md §8).
export const SLIP_ACCEPT = "image/png,image/jpeg,image/webp";
export const SLIP_MAX_BYTES = 5 * 1024 * 1024;
export const SLIP_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Read a File into a `data:<mime>;base64,…` URL (the upload contract's input). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// Downscale thresholds: real phone slips are 3–8MP photos, far bigger than a QR
// receipt needs. Anything over ~800KB or wider/taller than 1600px is redrawn to a
// ≤1600px JPEG (q0.82) before upload, keeping the action body small and fast on
// mobile data. Below both thresholds the original file is uploaded untouched.
const SLIP_DOWNSCALE_BYTES = 800 * 1024;
const SLIP_MAX_DIMENSION = 1600;
const SLIP_JPEG_QUALITY = 0.82;

/** Decode an image file into a drawable bitmap (throws when undecodable). */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> decoder — some engines reject formats here
      // that an <img> element can still decode.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert a chosen slip to the upload data-URL, downscaling large images via
 * canvas first. On ANY decode/canvas failure (e.g. an iPhone HEIC the browser
 * can't rasterize) it falls back to the raw file — the server accepts up to the
 * contract limit (action body raised to 8mb) — rather than blocking the payment.
 */
export async function slipToUploadDataUrl(file: File): Promise<string> {
  try {
    const bitmap = await decodeImage(file);
    // ImageBitmap exposes intrinsic size as width/height; a detached <img> is
    // authoritative via naturalWidth/naturalHeight.
    const width = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
    const height = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
    const oversized =
      file.size > SLIP_DOWNSCALE_BYTES || Math.max(width, height) > SLIP_MAX_DIMENSION;
    if (!oversized || width <= 0 || height <= 0) {
      if ("close" in bitmap) bitmap.close();
      return await fileToDataUrl(file);
    }
    const scale = Math.min(1, SLIP_MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if ("close" in bitmap) bitmap.close();
      return await fileToDataUrl(file);
    }
    // White backing so transparent PNG regions don't turn black in the JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if ("close" in bitmap) bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", SLIP_JPEG_QUALITY);
    // A canvas poisoned/failed export yields a stub — fall back to the raw file.
    if (!dataUrl.startsWith("data:image/jpeg")) return await fileToDataUrl(file);
    return dataUrl;
  } catch {
    return fileToDataUrl(file);
  }
}
