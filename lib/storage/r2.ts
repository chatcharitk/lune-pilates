// Real slip storage backed by Cloudflare R2 (S3-compatible object storage). Like
// the Vercel Blob adapter, bank-transfer slips are PII (account numbers, names), so
// the bytes stay OUT of the DB and never behind a public URL:
//   - put() uploads the decoded image to a PRIVATE R2 object under an unguessable
//     key and returns that key as the opaque storageKey. R2 objects are private by
//     default (no public access unless a bucket is explicitly published), so the
//     key is only ever resolvable with our credentials. dataUrlToPersist is null —
//     the DB column stays empty; the bytes live in R2.
//   - get() fetches the object SERVER-SIDE with a signed request and returns a
//     data-URL. Nothing R2-facing (endpoint, key, credentials) crosses the storage
//     boundary, so getSlip (owner-gated) stays the only access path.
//
// Auth is an R2 "S3 API" token → Access Key ID + Secret. Signing uses aws4fetch
// (a ~5KB SigV4 signer that works on Vercel serverless without the AWS SDK).

import { AwsClient } from "aws4fetch";
import { randomUUID } from "node:crypto";
import type { PutSlipParams, SlipStorage, StoredSlip } from "./types";

/** Decode the base64 payload of a `data:<mime>;base64,<payload>` URL into a plain
 *  ArrayBuffer (an unambiguous BlobPart for the fetch body — Node Buffer / the
 *  generic Uint8Array<ArrayBufferLike> both trip the DOM fetch/Blob types). */
function decodeDataUrl(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",");
  const payload = comma === -1 ? "" : dataUrl.slice(comma + 1);
  const bin = Buffer.from(payload, "base64");
  const ab = new ArrayBuffer(bin.byteLength);
  new Uint8Array(ab).set(bin);
  return ab;
}

/** The four env vars an R2 store needs; validated once at construction (fail closed). */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Read + validate the R2 env vars. Throws with a precise message if any is missing. */
export function r2ConfigFromEnv(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const missing = [
    ["R2_ACCOUNT_ID", accountId],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
    ["R2_BUCKET", bucket],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `STORAGE_MODE=r2 but these R2 env vars are missing: ${missing.join(", ")}. ` +
        "Create an R2 bucket + an S3-API token in the Cloudflare dashboard and set them.",
    );
  }
  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
  };
}

export class R2SlipStorage implements SlipStorage {
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(config: R2Config = r2ConfigFromEnv()) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    // R2's S3 endpoint: https://<account>.r2.cloudflarestorage.com/<bucket>
    this.base = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  }

  /** Full URL for an object key within the bucket. */
  private url(key: string): string {
    return `${this.base}/${key}`;
  }

  async put(
    params: PutSlipParams,
  ): Promise<{ storageKey: string; dataUrlToPersist: string | null }> {
    const ab = decodeDataUrl(params.dataUrl);
    // Unguessable key: even though objects are private, the DB never stores a
    // predictable path (defense-in-depth mirroring the Blob adapter's random suffix).
    const key = `slips/${params.chargeId}-${randomUUID()}`;
    // A Blob is an unambiguous BodyInit; aws4fetch reads it to compute the SigV4
    // payload hash before signing the PUT.
    const body = new Blob([ab], { type: params.mimeType });
    const res = await this.client.fetch(this.url(key), {
      method: "PUT",
      body,
      headers: { "content-type": params.mimeType },
    });
    if (!res.ok) {
      throw new Error(`R2 put failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
    // Bytes live in R2, not the DB — the caller persists NO data-URL on the row.
    return { storageKey: key, dataUrlToPersist: null };
  }

  /** storageKey is the R2 object key. Fetch it (signed) server-side → renderable data-URL. */
  async get(storageKey: string): Promise<StoredSlip | null> {
    const res = await this.client.fetch(this.url(storageKey), { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    return { dataUrl: `data:${mimeType};base64,${b64}`, mimeType };
  }
}
