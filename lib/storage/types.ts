// Slip-image storage boundary. v1 ships a mock that persists the image as a base64
// data-URL in the payment_slips row; a real object store (Vercel Blob / S3)
// implements the same interface later with ZERO change to the upload/verify logic
// (CLAUDE.md §2 — integrations are mocked behind clean interfaces).
//
// The contract is deliberately narrow: callers hand in a decoded-and-validated
// data-URL + its sniffed mime type and get back an OPAQUE storageKey to persist on
// the charge's slip row. Reads return the renderable data-URL + mime type. No bucket
// names, no URLs, no provider details leak across this boundary — so swapping the
// mock for a real store touches exactly this folder.

export interface PutSlipParams {
  /** The full `data:<mime>;base64,<payload>` URL — already validated by the caller. */
  dataUrl: string;
  /** The sniffed mime type (image/jpeg | image/png | image/webp). */
  mimeType: string;
  /** The charge this slip belongs to — the mock uses it as the storage key. */
  chargeId: string;
}

export interface StoredSlip {
  /** The renderable `data:<mime>;base64,…` URL the admin viewer shows. */
  dataUrl: string;
  mimeType: string;
}

export interface SlipStorage {
  /**
   * Persist a slip image and return an OPAQUE key the caller stores on the slip row,
   * plus whether the caller should also persist the data-URL on that row.
   *
   * - The MOCK has no store of its own: the `payment_slips.data_url` column IS its
   *   store, so it returns `dataUrlToPersist = <the data-URL>` for the caller to write
   *   on the row (and reads it back from there in get()).
   * - A REAL object store (Vercel Blob / S3) holds the bytes itself and returns
   *   `dataUrlToPersist = null` — the DB column stays empty and the image is resolved
   *   later via the opaque storageKey (get()).
   *
   * This decouples the caller from STORAGE_MODE: uploadPaymentSlip always writes
   * `dataUrl: dataUrlToPersist` without branching on the active store.
   */
  put(
    params: PutSlipParams,
  ): Promise<{ storageKey: string; dataUrlToPersist: string | null }>;
  /** Resolve a stored slip by its opaque key, or null when absent. */
  get(storageKey: string): Promise<StoredSlip | null>;
}
