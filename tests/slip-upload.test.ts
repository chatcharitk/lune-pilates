// No-DB unit tests for the customer slip-upload path (Feature 3):
//   - the SERVER-SIDE file validator (lib/payments/slip.ts) — the single place the
//     mime-sniff + 5 MB cap live: it must reject a non-image (INVALID_FILE) and an
//     oversized image (TOO_LARGE), and accept a real JPEG/PNG/WebP by MAGIC BYTES
//     (not the declared data-URL prefix);
//   - uploadPaymentSlip's FORBIDDEN guard — a non-owner can never upload a slip for
//     someone else's charge — proven with the DB + session mocked so no database is
//     needed (the actual UPSERT/idempotency is exercised by the integration suite).
//
// The atomic credit is NOT in this path (money is granted only on admin approve), so
// there is nothing money-critical to pin here beyond ownership + validation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SLIP_BYTES,
  validateSlipDataUrl,
} from "@/lib/payments/slip";

// ───────────────────────── data-URL fixtures ─────────────────────────

/** A real 1x1 PNG (magic 89 50 4E 47 …). */
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** A minimal JPEG header (FF D8 FF …) — enough bytes to sniff. */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const JPEG_DATA_URL = `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`;

/** A minimal WebP container (RIFF …. WEBP). */
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const WEBP_DATA_URL = `data:image/webp;base64,${WEBP_BYTES.toString("base64")}`;

describe("validateSlipDataUrl (pure, server-side — CLAUDE.md §8)", () => {
  it("accepts a real PNG/JPEG/WebP by magic bytes and returns the SNIFFED mime", () => {
    const png = validateSlipDataUrl(PNG_DATA_URL);
    expect(png.ok && png.mimeType).toBe("image/png");
    const jpeg = validateSlipDataUrl(JPEG_DATA_URL);
    expect(jpeg.ok && jpeg.mimeType).toBe("image/jpeg");
    const webp = validateSlipDataUrl(WEBP_DATA_URL);
    expect(webp.ok && webp.mimeType).toBe("image/webp");
  });

  it("INVALID_FILE: a non-image payload (text bytes) is rejected even with an image mime prefix", () => {
    // "hello world" base64'd, but DECLARED as image/png — the sniff must reject it.
    const lying = `data:image/png;base64,${Buffer.from("hello world, not an image").toString("base64")}`;
    const res = validateSlipDataUrl(lying);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_FILE");
  });

  it("INVALID_FILE: a non-data-URL string is rejected", () => {
    expect(validateSlipDataUrl("https://evil.example/slip.png").ok).toBe(false);
    expect(validateSlipDataUrl("").ok).toBe(false);
    expect(validateSlipDataUrl("data:image/png;base64,").ok).toBe(false);
  });

  it("TOO_LARGE: a >5 MB decoded image is rejected (pre-decode length guard too)", () => {
    // Build a valid PNG header followed by enough padding to exceed 5 MB decoded.
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const big = Buffer.concat([Buffer.from(header), Buffer.alloc(MAX_SLIP_BYTES + 1024)]);
    const res = validateSlipDataUrl(`data:image/png;base64,${big.toString("base64")}`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("TOO_LARGE");
  });

  it("accepts an image exactly at the 5 MB cap", () => {
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const atCap = Buffer.concat([
      Buffer.from(header),
      Buffer.alloc(MAX_SLIP_BYTES - header.length),
    ]);
    expect(atCap.length).toBe(MAX_SLIP_BYTES);
    const res = validateSlipDataUrl(`data:image/png;base64,${atCap.toString("base64")}`);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sizeBytes).toBe(MAX_SLIP_BYTES);
  });
});

// ───────────────────────── uploadPaymentSlip ownership guard ─────────────────────────
// Mock the DB + session so the action's FORBIDDEN branch is reachable without a real
// database: the charge is owned by SOMEONE ELSE, but the session viewer is the mock
// member — the owner check must reject before any file work or write.

const MOCK_VIEWER = { id: "viewer-self", name: "V", tier: "member" as const, householdId: null, houseNumber: null };

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => MOCK_VIEWER),
}));

const selectChain = {
  from: () => selectChain,
  where: () => selectChain,
  limit: async () => mockChargeRows,
};
let mockChargeRows: Array<{ chargeId: string; userId: string; amount: number; status: string; rejectionReason: string | null }> = [];

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => selectChain,
    insert: () => {
      throw new Error("insert must not run when ownership is rejected");
    },
    update: () => {
      throw new Error("update must not run when ownership is rejected");
    },
  }),
}));

import { uploadPaymentSlip } from "@/app/actions/purchase";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
beforeEach(() => {
  process.env.DATABASE_URL = "postgres://mock"; // force the DB path (it's mocked)
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  mockChargeRows = [];
});

describe("uploadPaymentSlip — ownership", () => {
  it("FORBIDDEN: a viewer cannot upload a slip for a charge they do not own", async () => {
    mockChargeRows = [
      { chargeId: "c1", userId: "someone-else", amount: 5500, status: "pending", rejectionReason: null },
    ];
    const res = await uploadPaymentSlip({ chargeId: "c1", slipDataUrl: PNG_DATA_URL });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("UNKNOWN_CHARGE: no charge bound to this id", async () => {
    mockChargeRows = [];
    const res = await uploadPaymentSlip({ chargeId: "missing", slipDataUrl: PNG_DATA_URL });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNKNOWN_CHARGE");
  });

  it("INVALID_INPUT: empty chargeId / data-URL", async () => {
    const a = await uploadPaymentSlip({ chargeId: "", slipDataUrl: PNG_DATA_URL });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe("INVALID_INPUT");
    const b = await uploadPaymentSlip({ chargeId: "c1", slipDataUrl: "" });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe("INVALID_INPUT");
  });

  it("ALREADY_PAID: an already-credited charge takes no further slips", async () => {
    mockChargeRows = [
      { chargeId: "c1", userId: MOCK_VIEWER.id, amount: 5500, status: "paid", rejectionReason: null },
    ];
    const res = await uploadPaymentSlip({ chargeId: "c1", slipDataUrl: PNG_DATA_URL });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ALREADY_PAID");
  });

  it("INVALID_FILE: an owned, pending charge with a non-image payload is rejected (no write)", async () => {
    mockChargeRows = [
      { chargeId: "c1", userId: MOCK_VIEWER.id, amount: 5500, status: "pending", rejectionReason: null },
    ];
    const lying = `data:image/png;base64,${Buffer.from("definitely not an image").toString("base64")}`;
    const res = await uploadPaymentSlip({ chargeId: "c1", slipDataUrl: lying });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_FILE");
  });

  it("TOO_LARGE: an owned, pending charge with a >5 MB image is rejected (no write)", async () => {
    mockChargeRows = [
      { chargeId: "c1", userId: MOCK_VIEWER.id, amount: 5500, status: "pending", rejectionReason: null },
    ];
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const big = Buffer.concat([Buffer.from(header), Buffer.alloc(MAX_SLIP_BYTES + 1024)]);
    const res = await uploadPaymentSlip({
      chargeId: "c1",
      slipDataUrl: `data:image/png;base64,${big.toString("base64")}`,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("TOO_LARGE");
  });
});
