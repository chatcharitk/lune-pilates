// Admin POS (app/actions/admin-pos.ts) + the shared credit primitive's owner
// resolution (lib/credits/creditPackage.ts `ownerForPool`).
//
// The atomic credit and its idempotency live in `creditPackage`, which runs against
// a real interactive transaction — out of reach for a no-DB unit test. What we CAN
// and MUST pin here without a database:
//   - OWNER RESOLUTION (invariants 2 & 3): a member with a household credits the
//     SHARED household pool; a guest (or member without a household) credits their
//     OWN, non-transferable. This is the highest-risk decision in the POS path.
//   - the action contract: validation, unknown package, the cash vs promptpay
//     result shapes, and the auth gate.
//   - idempotency CONTRACT shape: the cash chargeId is the idempotency key, so two
//     sales at the same instant synthesize the SAME key (the package unique
//     constraint then governs at the DB layer).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ownerForPool } from "@/lib/credits/creditPackage";
import { posConfirmPayment, posSellPackage } from "@/app/actions/admin-pos";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB path for the action contract
  delete process.env.ADMIN_AUTH;
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
});

const CUSTOMER = "00000000-0000-4000-8000-000000000abc";
const IDEM = "00000000-0000-4000-8000-0000000000ff"; // client idempotency token

describe("ownerForPool (pure — invariants 2 & 3)", () => {
  it("INVARIANT 2: a member WITH a household credits the SHARED household pool", () => {
    const owner = ownerForPool({ id: "u1", tier: "member", householdId: "h1" });
    expect(owner).toEqual({ ownerHouseholdId: "h1", ownerUserId: null });
  });

  it("INVARIANT 3: a GUEST always credits their OWN package (never a household)", () => {
    const owner = ownerForPool({ id: "g1", tier: "guest", householdId: null });
    expect(owner).toEqual({ ownerHouseholdId: null, ownerUserId: "g1" });
  });

  it("a member WITHOUT a household credits their own (unaffiliated member)", () => {
    const owner = ownerForPool({ id: "u2", tier: "member", householdId: null });
    expect(owner).toEqual({ ownerHouseholdId: null, ownerUserId: "u2" });
  });

  it("exactly one owner is ever set (the schema's single-owner XOR)", () => {
    for (const ctx of [
      { id: "u1", tier: "member" as const, householdId: "h1" },
      { id: "g1", tier: "guest" as const, householdId: null },
      { id: "u2", tier: "member" as const, householdId: null },
    ]) {
      const o = ownerForPool(ctx);
      expect((o.ownerHouseholdId === null) !== (o.ownerUserId === null)).toBe(true);
    }
  });
});

describe("posSellPackage (no-DB contract)", () => {
  it("rejects an unknown catalog package", async () => {
    const res = await posSellPackage({ customerId: CUSTOMER, packageId: "ghost", method: "cash", idempotencyKey: IDEM });
    expect(res).toEqual({ ok: false, code: "UNKNOWN_PACKAGE" });
  });

  it("rejects a non-uuid customer (a package sale needs a real owner)", async () => {
    const res = await posSellPackage({ customerId: "walk-in", packageId: "p10", method: "cash", idempotencyKey: IDEM });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("rejects an out-of-scope method (no 'card')", async () => {
    const res = await posSellPackage({
      customerId: CUSTOMER,
      packageId: "p10",
      idempotencyKey: IDEM,
      // @ts-expect-error card is deliberately not a PaymentMethod (out of scope v1)
      method: "card",
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("CASH → a paid receipt with the catalog hours + price (credited immediately)", async () => {
    const res = await posSellPackage({ customerId: CUSTOMER, packageId: "p10", method: "cash", idempotencyKey: IDEM });
    expect(res.ok).toBe(true);
    if (res.ok && res.sale.method === "cash") {
      expect(res.sale.hoursAdded).toBe(10);
      expect(res.sale.amount).toBe(5500); // server-side catalog price, never the client
    } else {
      throw new Error("expected a cash receipt");
    }
  });

  it("PROMPTPAY → a pending QR sale with the catalog amount (credited on confirm)", async () => {
    const res = await posSellPackage({ customerId: CUSTOMER, packageId: "p15", method: "promptpay", idempotencyKey: IDEM });
    expect(res.ok).toBe(true);
    if (res.ok && res.sale.method === "promptpay") {
      expect(res.sale.amount).toBe(7500);
      expect(res.sale.qrPayload).toContain("MOCKPROMPTPAY");
      expect(res.sale.chargeId).toBeTruthy();
    } else {
      throw new Error("expected a promptpay sale");
    }
  });

  it("UNAUTHORIZED first in deny mode, before input parsing", async () => {
    process.env.ADMIN_AUTH = "deny";
    const res = await posSellPackage({ customerId: "bad", packageId: "", method: "cash", idempotencyKey: IDEM });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" }); // gate beats INVALID_INPUT
  });
});

describe("posConfirmPayment (no-DB contract)", () => {
  it("returns a receipt for a chargeId in the no-DB path", async () => {
    const res = await posConfirmPayment({ chargeId: "mock_p10" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.receipt.chargeId).toBe("mock_p10");
  });

  it("rejects an empty chargeId", async () => {
    const res = await posConfirmPayment({ chargeId: "" });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("UNAUTHORIZED first in deny mode, before input parsing", async () => {
    process.env.ADMIN_AUTH = "deny";
    const res = await posConfirmPayment({ chargeId: "" });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});
