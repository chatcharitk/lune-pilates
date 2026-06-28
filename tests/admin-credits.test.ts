// No-DB contract tests for the admin "Adjust credits" actions (Group D #8).
// The atomic ledger write + idempotency live in a real transaction (covered by
// tests/integration/credit-adjustment.integration.test.ts). Here we pin, without a
// DB: the OWNER-ONLY gate (before input parsing), input validation, the no-DB mock
// success/receipt shape, and the NEGATIVE_BALANCE / UNKNOWN_* contract.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adjustCredits, getAdjustablePackages } from "@/app/actions/admin-credits";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB path for the action contract
  delete process.env.ADMIN_AUTH; // default mock owner
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
});

// Mock customer #1 + its mock package id (mirrors admin-credits.ts mid()/mockPkgId()).
const CUSTOMER = "00000000-0000-4000-8000-000000000001";
const PACKAGE = "00000000-0000-4000-9000-000000000001";
const IDEM = "00000000-0000-4000-8000-0000000000ad";

describe("getAdjustablePackages (no-DB contract)", () => {
  it("OWNER-ONLY: an instructor/unauth is UNAUTHORIZED (gate first)", async () => {
    process.env.ADMIN_AUTH = "deny";
    const res = await getAdjustablePackages(CUSTOMER);
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("rejects a non-uuid customer", async () => {
    const res = await getAdjustablePackages("not-a-uuid");
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("returns the mock customer's packages", async () => {
    const res = await getAdjustablePackages(CUSTOMER);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.packages.length).toBeGreaterThan(0);
      expect(res.packages[0]!.id).toBe(PACKAGE);
    }
  });

  it("UNKNOWN_CUSTOMER for an unknown id", async () => {
    const res = await getAdjustablePackages("00000000-0000-4000-8000-0000000000ee");
    expect(res).toEqual({ ok: false, code: "UNKNOWN_CUSTOMER" });
  });
});

describe("adjustCredits (no-DB contract)", () => {
  const valid = { customerId: CUSTOMER, packageId: PACKAGE, deltaHours: 2, note: "comp", idempotencyKey: IDEM };

  it("OWNER-ONLY first — deny beats even malformed input", async () => {
    process.env.ADMIN_AUTH = "deny";
    const res = await adjustCredits({ ...valid, customerId: "bad", deltaHours: 0, note: "" });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("INVALID_INPUT: zero delta", async () => {
    expect(await adjustCredits({ ...valid, deltaHours: 0 })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it("INVALID_INPUT: non-integer delta", async () => {
    expect(await adjustCredits({ ...valid, deltaHours: 1.5 })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it("INVALID_INPUT: empty note", async () => {
    expect(await adjustCredits({ ...valid, note: "" })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it("INVALID_INPUT: bad uuid", async () => {
    expect(await adjustCredits({ ...valid, customerId: "nope" })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("applies a positive delta (no-DB receipt)", async () => {
    const res = await adjustCredits({ ...valid, deltaHours: 2 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.outcome.deltaHours).toBe(2);
      expect(res.outcome.hoursLeft).toBe(7); // mock customer #1 starts at 5
    }
  });

  it("NEGATIVE_BALANCE: a subtraction past zero is rejected", async () => {
    const res = await adjustCredits({ ...valid, deltaHours: -10 });
    expect(res).toEqual({ ok: false, code: "NEGATIVE_BALANCE" });
  });

  it("UNKNOWN_PACKAGE: a package not in the customer's pool", async () => {
    const res = await adjustCredits({ ...valid, packageId: "00000000-0000-4000-9000-000000000099" });
    expect(res).toEqual({ ok: false, code: "UNKNOWN_PACKAGE" });
  });
});
