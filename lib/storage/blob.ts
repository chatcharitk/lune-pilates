// Real slip storage backed by Vercel Blob. Bank-transfer slips are PII (account
// numbers, names), so this adapter keeps the bytes OUT of the DB and resolves them
// only server-side:
//   - put() uploads the decoded image to Blob and returns the blob URL as the opaque
//     storageKey. addRandomSuffix makes that URL UNGUESSABLE — without the row's
//     storageKey nobody can enumerate slips. dataUrlToPersist is null: the DB column
//     stays empty; the bytes live in Blob.
//   - get() fetches the blob URL SERVER-SIDE and hands back a data-URL. The public
//     blob URL is NEVER returned to a caller, so getSlip (owner-gated) stays the only
//     access path — exactly as with the mock.

import { put } from "@vercel/blob";
import type { PutSlipParams, SlipStorage, StoredSlip } from "./types";

/** Pull the raw base64 payload out of a `data:<mime>;base64,<payload>` URL. */
function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  const payload = comma === -1 ? "" : dataUrl.slice(comma + 1);
  return Buffer.from(payload, "base64");
}

export class VercelBlobStorage implements SlipStorage {
  async put(
    params: PutSlipParams,
  ): Promise<{ storageKey: string; dataUrlToPersist: string | null }> {
    const bytes = decodeDataUrl(params.dataUrl);
    const { url } = await put(`slips/${params.chargeId}`, bytes, {
      access: "public",
      contentType: params.mimeType,
      // Unguessable URL — the slip is PII; only the row's storageKey can resolve it.
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    // Bytes live in Blob, not the DB — the caller persists NO data-URL on the row.
    return { storageKey: url, dataUrlToPersist: null };
  }

  /** storageKey is the blob URL. Fetch it server-side and return a renderable data-URL. */
  async get(storageKey: string): Promise<StoredSlip | null> {
    const res = await fetch(storageKey);
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    return { dataUrl: `data:${mimeType};base64,${b64}`, mimeType };
  }
}
