// No-DB unit tests for the slip-store factory (lib/storage). Pins the FAIL-CLOSED
// mode selection: only "mock" and "blob" are valid, "blob" requires its token, and
// anything else throws (a misconfigured prod must never silently degrade to the mock,
// which would stuff bank-slip PII into the DB).
//
// getSlipStorage() memoizes its result, so each case resets the module registry and
// re-imports the factory fresh — the selection runs once per isolated import. The
// expected store classes are pulled from the SAME reset graph so `instanceof` matches
// (vi.resetModules gives each import its own class identity).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_STORAGE_MODE = process.env.STORAGE_MODE;
const ORIGINAL_BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const R2_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;
const ORIGINAL_R2 = Object.fromEntries(R2_KEYS.map((k) => [k, process.env[k]]));

/** Re-import the factory + store classes fresh so identities and the singleton align. */
async function freshStorage() {
  vi.resetModules();
  const [index, mock, blob, r2] = await Promise.all([
    import("@/lib/storage"),
    import("@/lib/storage/mock"),
    import("@/lib/storage/blob"),
    import("@/lib/storage/r2"),
  ]);
  return {
    getSlipStorage: index.getSlipStorage,
    MockSlipStorage: mock.MockSlipStorage,
    VercelBlobStorage: blob.VercelBlobStorage,
    R2SlipStorage: r2.R2SlipStorage,
  };
}

function setR2Env() {
  process.env.R2_ACCOUNT_ID = "acct123";
  process.env.R2_ACCESS_KEY_ID = "ak_dummy";
  process.env.R2_SECRET_ACCESS_KEY = "sk_dummy";
  process.env.R2_BUCKET = "lune-slips";
}

beforeEach(() => {
  delete process.env.STORAGE_MODE;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  for (const k of R2_KEYS) delete process.env[k];
});

afterEach(() => {
  if (ORIGINAL_STORAGE_MODE === undefined) delete process.env.STORAGE_MODE;
  else process.env.STORAGE_MODE = ORIGINAL_STORAGE_MODE;
  if (ORIGINAL_BLOB_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_BLOB_TOKEN;
  for (const k of R2_KEYS) {
    if (ORIGINAL_R2[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_R2[k];
  }
});

describe("getSlipStorage mode selection (fail closed — CLAUDE.md §2)", () => {
  it("unset → MockSlipStorage (dev default)", async () => {
    const { getSlipStorage, MockSlipStorage } = await freshStorage();
    expect(getSlipStorage()).toBeInstanceOf(MockSlipStorage);
  });

  it('"mock" → MockSlipStorage', async () => {
    process.env.STORAGE_MODE = "mock";
    const { getSlipStorage, MockSlipStorage } = await freshStorage();
    expect(getSlipStorage()).toBeInstanceOf(MockSlipStorage);
  });

  it('"blob" with a token → VercelBlobStorage', async () => {
    process.env.STORAGE_MODE = "blob";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_dummy_token";
    const { getSlipStorage, VercelBlobStorage } = await freshStorage();
    expect(getSlipStorage()).toBeInstanceOf(VercelBlobStorage);
  });

  it('"blob" WITHOUT a token → throws (fail closed at construction)', async () => {
    process.env.STORAGE_MODE = "blob";
    const { getSlipStorage } = await freshStorage();
    expect(() => getSlipStorage()).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it('"r2" with all four env vars → R2SlipStorage', async () => {
    process.env.STORAGE_MODE = "r2";
    setR2Env();
    const { getSlipStorage, R2SlipStorage } = await freshStorage();
    expect(getSlipStorage()).toBeInstanceOf(R2SlipStorage);
  });

  it('"r2" MISSING an env var → throws naming the missing var (fail closed)', async () => {
    process.env.STORAGE_MODE = "r2";
    setR2Env();
    delete process.env.R2_SECRET_ACCESS_KEY;
    const { getSlipStorage } = await freshStorage();
    expect(() => getSlipStorage()).toThrow(/R2_SECRET_ACCESS_KEY/);
  });

  it('an unknown mode ("s3") → throws (never degrades to the mock)', async () => {
    process.env.STORAGE_MODE = "s3";
    const { getSlipStorage } = await freshStorage();
    expect(() => getSlipStorage()).toThrow(/not a known slip store/);
  });
});
