import type { SlipStorage } from "./types";
import { MockSlipStorage } from "./mock";

let _storage: SlipStorage | null = null;

/**
 * Resolve the slip-image store by `STORAGE_MODE` (CLAUDE.md §2 — integrations are
 * mocked in v1 behind a clean interface).
 *
 * Fails CLOSED (mirroring the payments/LINE factories): the mock persists the image
 * as a base64 data-URL in the DB — correct for v1 dev, but a production operator who
 * flips `STORAGE_MODE` to a real value (e.g. "blob") must NOT silently keep stuffing
 * bank-slip images into the DB. There is no real object store wired yet, so any
 * non-"mock" value throws at construction rather than degrading to the mock.
 *
 *   - unset / "mock" → the v1 mock (default for dev).
 *   - any other value → throw; wire the real store (Vercel Blob / S3) here.
 */
export function getSlipStorage(): SlipStorage {
  if (!_storage) {
    const mode = process.env.STORAGE_MODE ?? "mock";
    if (mode !== "mock") {
      // When a real object store is wired, construct it for "blob"/"s3" here.
      throw new Error(
        `STORAGE_MODE=${mode} but no live slip store is configured. ` +
          `Set STORAGE_MODE=mock for v1, or wire a real store in lib/storage/index.ts.`,
      );
    }
    _storage = new MockSlipStorage();
  }
  return _storage;
}

export type { SlipStorage, PutSlipParams, StoredSlip } from "./types";
