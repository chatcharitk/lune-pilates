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
   * Persist a slip image and return an OPAQUE key the caller stores on the slip row.
   * The mock writes nothing of its own — it returns the chargeId as the key, and the
   * data-URL is persisted on the payment_slips row by the caller (see uploadPaymentSlip).
   */
  put(params: PutSlipParams): Promise<{ storageKey: string }>;
  /** Resolve a stored slip by its opaque key, or null when absent. */
  get(storageKey: string): Promise<StoredSlip | null>;
}
