import type { SlipStorage } from "./types";
import { MockSlipStorage } from "./mock";
import { VercelBlobStorage } from "./blob";

let _storage: SlipStorage | null = null;

/**
 * Resolve the slip-image store by `STORAGE_MODE` (CLAUDE.md §2 — integrations behind a
 * clean interface).
 *
 * Fails CLOSED (mirroring the payments/LINE factories): an UNKNOWN mode must NOT
 * silently degrade to the mock (which stuffs bank-slip PII into the DB). Only the two
 * wired stores are accepted; anything else throws at construction.
 *
 *   - unset / "mock" → the dev mock (the data-URL is persisted in the DB column).
 *   - "blob"         → Vercel Blob (bytes in Blob, resolved server-side; needs
 *                      BLOB_READ_WRITE_TOKEN — checked here so a misconfig fails on
 *                      first construction, not on the first upload).
 *   - any other value → throw.
 */
export function getSlipStorage(): SlipStorage {
  if (!_storage) {
    const mode = process.env.STORAGE_MODE ?? "mock";
    if (mode === "mock") {
      _storage = new MockSlipStorage();
    } else if (mode === "blob") {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new Error(
          "STORAGE_MODE=blob but BLOB_READ_WRITE_TOKEN is missing. " +
            "Create a Vercel Blob store (the token is auto-injected on Vercel) or set it locally.",
        );
      }
      _storage = new VercelBlobStorage();
    } else {
      throw new Error(
        `STORAGE_MODE=${mode} is not a known slip store. ` +
          `Use "mock" (dev) or "blob" (Vercel Blob), or wire a new store in lib/storage/index.ts.`,
      );
    }
  }
  return _storage;
}

export type { SlipStorage, PutSlipParams, StoredSlip } from "./types";
