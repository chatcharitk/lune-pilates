// v1 mock slip storage — the data-URL itself is persisted on the payment_slips row
// by the caller (uploadPaymentSlip), so the mock's job is only to (a) hand back the
// opaque storage key the row records, and (b) resolve a key back to the stored image
// by reading that row. There is no separate blob store in v1; the DB column IS the
// store. A real Vercel Blob / S3 impl swaps in at getSlipStorage() with no change to
// the upload/verify logic (the storageKey simply becomes a real object key/URL).

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { paymentSlips } from "@/lib/db/schema";
import type { PutSlipParams, SlipStorage, StoredSlip } from "./types";

export class MockSlipStorage implements SlipStorage {
  /**
   * The opaque key is the chargeId: the slip row is unique per charge, so the charge
   * id resolves the persisted image deterministically. (The actual data-URL is
   * written to the row by uploadPaymentSlip in the same UPSERT that records this key,
   * so there is no second write here.)
   */
  async put(
    params: PutSlipParams,
  ): Promise<{ storageKey: string; dataUrlToPersist: string | null }> {
    // The mock has no store of its own: the payment_slips.data_url column IS the store,
    // so hand the data-URL back for the caller to persist on the row in the same UPSERT.
    return { storageKey: params.chargeId, dataUrlToPersist: params.dataUrl };
  }

  /** Read the persisted data-URL + mime type back from the slip row keyed by chargeId. */
  async get(storageKey: string): Promise<StoredSlip | null> {
    const db = getDb();
    const [row] = await db
      .select({ dataUrl: paymentSlips.dataUrl, mimeType: paymentSlips.mimeType })
      .from(paymentSlips)
      .where(eq(paymentSlips.storageKey, storageKey))
      .limit(1);
    // data_url is now nullable (a real store leaves it null); for the mock a null here
    // means the image is absent — treat it as not found rather than returning a bad URL.
    if (!row || row.dataUrl === null) return null;
    return { dataUrl: row.dataUrl, mimeType: row.mimeType };
  }
}
