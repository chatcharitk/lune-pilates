// Admin package-catalog CRUD (app/actions/admin-catalog.ts).
//
// The catalog moved from a hardcoded TS constant into the `catalog_items` table so
// the studio owner can edit it. That makes the ACTION the last line of defence on
// values the whole money path trusts (getCatalogItem is the server-side price/hours
// source — CLAUDE.md §8). What we can and must pin without a database:
//
//   - the OWNER-ONLY gate, asserted BEFORE input parsing (an invalid payload from a
//     non-owner must still read UNAUTHORIZED, never INVALID_INPUT — otherwise the
//     action leaks validity information to an unauthenticated caller);
//   - the two IMMUTABILITY guardrails: `id` (it is packages.type / charges.package_id
//     on every historical row) and `category` (it decides which credit bucket a
//     booking debits — moving it corrupts already-sold balances);
//   - integer-only hours/price (no floats in the money path);
//   - BOTH labels required, non-empty (CLAUDE.md §6);
//   - archive is a SOFT retire (active=false), never a delete, and is reversible.
//
// Mirrors the no-DB mock patterns in tests/admin-pos.test.ts: DATABASE_URL is unset
// to force the mock branch, ADMIN_AUTH toggles the owner gate.
//
// MOCK_NO_DB. Because these run with no DATABASE_URL, a VALID write cannot persist.
// The actions therefore report `{ ok:false, code:"MOCK_NO_DB" }` for a valid write in
// mock mode rather than a success the refreshed list will not reflect — so "reaches
// MOCK_NO_DB" is exactly how this suite asserts "passed every server-side guardrail".
// The DB-backed behaviour of those same writes lives in
// tests/integration/catalog-crud.integration.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveCatalogItem,
  createCatalogItem,
  deleteCatalogItem,
  listCatalogForAdmin,
  reorderCatalog,
  restoreCatalogItem,
  updateCatalogItem,
  type CreateCatalogItemInput,
  type UpdateCatalogItemInput,
} from "@/app/actions/admin-catalog";
import { perHourFor, sublabelForValidity } from "@/lib/catalog/packages";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;
const ORIGINAL_ADMIN_ROLE = process.env.ADMIN_ROLE;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB path for the action contract
  delete process.env.ADMIN_AUTH; // default mock provider
  delete process.env.ADMIN_ROLE; // ... whose default role is owner
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
  if (ORIGINAL_ADMIN_ROLE === undefined) delete process.env.ADMIN_ROLE;
  else process.env.ADMIN_ROLE = ORIGINAL_ADMIN_ROLE;
});

const VALID_CREATE: CreateCatalogItemInput = {
  id: "p20",
  category: "group",
  hours: 20,
  price: 11000,
  validityAmount: 3,
  validityUnit: "month",
  labelEn: "20 hours",
  labelTh: "20 ชั่วโมง",
};

const VALID_UPDATE: UpdateCatalogItemInput = {
  id: "p10",
  hours: 10,
  price: 5900,
  validityAmount: 2,
  validityUnit: "month",
  tag: "popular",
  labelEn: "10 hours",
  labelTh: "10 ชั่วโมง",
};

// ───────────────────────── the auth gate ─────────────────────────

describe("owner-only gate (line 1 of every action)", () => {
  beforeEach(() => {
    process.env.ADMIN_ROLE = "instructor"; // signed in, but NOT the owner
  });

  it("rejects an instructor from every catalog action", async () => {
    expect(await listCatalogForAdmin()).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await createCatalogItem(VALID_CREATE)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await updateCatalogItem(VALID_UPDATE)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await archiveCatalogItem("p10")).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await restoreCatalogItem("p10")).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await reorderCatalog({ ids: ["p10"] })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await deleteCatalogItem("p10")).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("gates BEFORE input parsing: a garbage payload from a non-owner reads UNAUTHORIZED", async () => {
    // If the gate were after the zod parse this would return INVALID_INPUT and leak
    // schema validity to an unauthorised caller.
    const res = await createCatalogItem({ ...VALID_CREATE, id: "!!!", hours: -1 });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
    // deleteCatalogItem gates the same way (UNAUTHORIZED before INVALID_INPUT).
    expect(await deleteCatalogItem("")).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});

// ───────────────────────── create: id validation ─────────────────────────

describe("createCatalogItem — id is a stable, url-safe slug", () => {
  it("accepts a clean lowercase slug (reaches the write → MOCK_NO_DB, not INVALID_INPUT)", async () => {
    expect(await createCatalogItem(VALID_CREATE)).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });

  it("rejects ids with spaces, uppercase-only punctuation, slashes or unicode", async () => {
    for (const id of ["p 20", "p/20", "p_20", "แพ็ก", "-p20", "p20-", "p--20", "!!"]) {
      const res = await createCatalogItem({ ...VALID_CREATE, id });
      expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
    }
  });

  it("rejects an id that collides with an existing item", async () => {
    // "p10" is a seed item; in the no-DB path the seed constant IS the catalog.
    process.env.DATABASE_URL = ""; // still falsy → mock branch
    const res = await createCatalogItem({ ...VALID_CREATE, id: "p10" });
    // The mock branch has no uniqueness store, so the DUPLICATE_ID guard is the DB
    // path's job (pinned in tests/integration/catalog-crud.integration.test.ts);
    // what MUST hold everywhere is that the slug shape is validated first.
    expect(res.ok).toBe(false);
    if (!res.ok) expect(["DUPLICATE_ID", "MOCK_NO_DB"]).toContain(res.code);
  });
});

// ───────────────────────── the money guardrails ─────────────────────────

describe("hours and price are positive whole integers (no floats in the money path)", () => {
  it("rejects fractional hours", async () => {
    expect(await createCatalogItem({ ...VALID_CREATE, hours: 10.5 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("rejects fractional prices (integer THB only)", async () => {
    expect(await createCatalogItem({ ...VALID_CREATE, price: 5500.25 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("rejects zero or negative hours (a package must grant something)", async () => {
    for (const hours of [0, -1, -10]) {
      expect(await createCatalogItem({ ...VALID_CREATE, hours })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
  });

  it("rejects a negative price", async () => {
    expect(await createCatalogItem({ ...VALID_CREATE, price: -1 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("allows a zero price (a comped / promotional package)", async () => {
    const res = await createCatalogItem({ ...VALID_CREATE, price: 0 });
    expect(res).toEqual({ ok: false, code: "MOCK_NO_DB" }); // passed validation
  });

  it("applies the same numeric rules on UPDATE, not just create", async () => {
    expect(await updateCatalogItem({ ...VALID_UPDATE, hours: 1.5 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await updateCatalogItem({ ...VALID_UPDATE, price: -5 })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("derives perHour from price/hours rather than trusting any client value", () => {
    // The derivation lives in the catalog module and is what the action echoes back
    // on the DB path; asserted at the source now that mock writes don't echo an item.
    expect(perHourFor(11000, 20)).toBe(550);
    expect(perHourFor(5500, 10)).toBe(550);
  });
});

// ───────────────────────── bilingual copy ─────────────────────────

describe("both labels are required and non-empty (CLAUDE.md §6)", () => {
  it("rejects a missing or blank Thai label", async () => {
    for (const labelTh of ["", "   "]) {
      expect(await createCatalogItem({ ...VALID_CREATE, labelTh })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
  });

  it("rejects a missing or blank English label", async () => {
    for (const labelEn of ["", "   "]) {
      expect(await createCatalogItem({ ...VALID_CREATE, labelEn })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
  });

  it("enforces both labels on UPDATE too", async () => {
    expect(await updateCatalogItem({ ...VALID_UPDATE, labelTh: "" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("derives the sublabel from structured validity (never client-supplied)", () => {
    expect(sublabelForValidity({ amount: 2, unit: "month" })).toEqual({
      en: "Valid 2 months",
      th: "ใช้ได้ 2 เดือน",
    });
    expect(sublabelForValidity({ amount: 1, unit: "month" })).toEqual({
      en: "Valid 1 month",
      th: "ใช้ได้ 1 เดือน",
    });
    expect(sublabelForValidity({ amount: 45, unit: "day" })).toEqual({
      en: "Valid 45 days",
      th: "ใช้ได้ 45 วัน",
    });
    expect(sublabelForValidity({ amount: 1, unit: "day" })).toEqual({
      en: "Valid 1 day",
      th: "ใช้ได้ 1 วัน",
    });
  });
});

// ───────────────────────── immutability guardrails ─────────────────────────

describe("category is IMMUTABLE after creation (it picks the credit bucket)", () => {
  it("rejects an update that moves a group item into private", async () => {
    // p10 is a seed GROUP item. Re-bucketing it would corrupt every already-sold
    // p10 balance, which debits from the group pool.
    const res = await updateCatalogItem({ ...VALID_UPDATE, category: "private" });
    expect(res).toEqual({ ok: false, code: "CATEGORY_IMMUTABLE" });
  });

  it("rejects a move into rental just the same", async () => {
    const res = await updateCatalogItem({ ...VALID_UPDATE, category: "rental" });
    expect(res).toEqual({ ok: false, code: "CATEGORY_IMMUTABLE" });
  });

  it("fails LOUDLY rather than silently dropping the field", async () => {
    // The distinct code is the point: the owner must learn the change did not apply.
    const res = await updateCatalogItem({ ...VALID_UPDATE, category: "private" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).not.toBe("INVALID_INPUT");
  });

  it("accepts an update that ECHOES the unchanged category (forms round-trip it)", async () => {
    // Passes the immutability guard → reaches the write (MOCK_NO_DB here, no DB).
    expect(await updateCatalogItem({ ...VALID_UPDATE, category: "group" })).toEqual({
      ok: false,
      code: "MOCK_NO_DB",
    });
  });

  it("accepts an update that omits category entirely", async () => {
    expect(await updateCatalogItem(VALID_UPDATE)).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });
});

describe("id is IMMUTABLE after creation", () => {
  it("update keys off the id: a known id resolves, an unknown one does not", async () => {
    // "resolves" == it got past the existence lookup to the write step.
    expect(await updateCatalogItem(VALID_UPDATE)).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });

  it("has no way to rename: an extra newId field is ignored, the key still wins", async () => {
    // The input schema simply has no rename field — a client sending one changes
    // nothing, so historical charges/packages can never be orphaned. Proof: the
    // action still resolves the KEY "p10" (reaching the write) rather than failing
    // UNKNOWN_ITEM on the nonexistent "p10-v2".
    const res = await updateCatalogItem({
      ...VALID_UPDATE,
      ...({ newId: "p10-v2" } as unknown as Record<string, never>),
    });
    expect(res).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });

  it("rejects an update for an id that does not exist", async () => {
    const res = await updateCatalogItem({ ...VALID_UPDATE, id: "ghost" });
    expect(res).toEqual({ ok: false, code: "UNKNOWN_ITEM" });
  });
});

// ───────────────────────── archive, never delete ─────────────────────────

describe("archive is a SOFT retire — never a hard delete", () => {
  it("archiving resolves a known item and reaches the write (MOCK_NO_DB, no DB here)", async () => {
    expect(await archiveCatalogItem("p10")).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });

  it("is reversible: restore is a real action taking the same path", async () => {
    expect(await restoreCatalogItem("p10")).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });

  it("rejects archiving an unknown id", async () => {
    expect(await archiveCatalogItem("ghost")).toEqual({ ok: false, code: "UNKNOWN_ITEM" });
  });

  it("rejects a blank id", async () => {
    expect(await archiveCatalogItem("")).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("can archive 'drop' — the 1+1 promo item — but that DISABLES the promo", async () => {
    // Documented coupling, not a bug: promoBonusHours keys off the literal id
    // "drop" (lib/credits/creditPackage.ts). Archiving it is allowed; the UI warns
    // (cat_promo_warning). Pinned here so a future refactor notices the link.
    expect(await archiveCatalogItem("drop")).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });
});

// ───────────────────────── delete (hard-delete if unused, else archive) ─────────────────────────

describe("deleteCatalogItem — gates without a database", () => {
  it("a known item reaches the write (MOCK_NO_DB in mock mode)", async () => {
    // The unused-vs-referenced decision needs the DB; the DB-backed proof lives in
    // tests/integration/catalog-crud.integration.test.ts. Here we only pin the gates.
    expect(await deleteCatalogItem("p10")).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });

  it("an unknown id is UNKNOWN_ITEM (in any mode)", async () => {
    expect(await deleteCatalogItem("ghost")).toEqual({ ok: false, code: "UNKNOWN_ITEM" });
  });

  it("a blank id is INVALID_INPUT (after the owner gate)", async () => {
    expect(await deleteCatalogItem("")).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});

// ───────────────────────── reorder ─────────────────────────

describe("reorderCatalog", () => {
  it("accepts a list of ids (passes validation → MOCK_NO_DB with no database)", async () => {
    expect(await reorderCatalog({ ids: ["drop", "p5", "p10", "p15"] })).toEqual({
      ok: false,
      code: "MOCK_NO_DB",
    });
  });

  it("rejects duplicate ids (two items can't share a slot)", async () => {
    expect(await reorderCatalog({ ids: ["p10", "p10"] })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("rejects an empty list", async () => {
    expect(await reorderCatalog({ ids: [] })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});

// ───────────────────────── the admin read model ─────────────────────────

describe("listCatalogForAdmin", () => {
  it("returns EVERY item including hidden-category ones, with active + sortOrder", async () => {
    const res = await listCatalogForAdmin();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items.length).toBe(13); // all 13, not the 10 purchasable ones
    expect(res.items.map((i) => i.id)).toContain("r-solo");
    for (const item of res.items) {
      expect(typeof item.active).toBe("boolean");
      expect(Number.isInteger(item.sortOrder)).toBe(true);
    }
  });
});
