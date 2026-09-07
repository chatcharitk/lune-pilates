// No-DB unit tests for the Settings actions (app/actions/admin-settings.ts) and the
// T&C consent gate on createCheckout (app/actions/purchase.ts).
//
// Mirrors tests/admin-visibility.test.ts's conventions: DATABASE_URL is unset to
// force the mock branch, ADMIN_ROLE toggles the owner gate, and a valid write in
// mock mode reaches MOCK_NO_DB (never a fake ok:true).
//
// The consent gate is the point of the feature, so it is tested from the caller's
// side too: a checkout must be REFUSED when the accepted terms version is not the
// active one, whatever the client sends.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStudioInfo,
  listTerms,
  publishTerms,
  updateStudioInfo,
  type UpdateStudioInfoInput,
} from "@/app/actions/admin-settings";
import { createCheckout } from "@/app/actions/purchase";
import { SEED_TERMS } from "@/lib/settings/terms";
import { SEED_STUDIO_INFO } from "@/lib/settings/studio";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;
const ORIGINAL_ADMIN_ROLE = process.env.ADMIN_ROLE;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB path
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

const VALID_STUDIO: UpdateStudioInfoInput = {
  nameEn: "LUNE Pilates",
  nameTh: "ลูเน่ พิลาทิส",
  addressEn: "123 Sukhumvit, Bangkok",
  addressTh: "123 สุขุมวิท กรุงเทพฯ",
  phone: "021234567",
  mapUrl: "https://maps.google.com/?q=lune",
  hoursEn: "Mon–Fri 07:00–20:00",
  hoursTh: "จันทร์–ศุกร์ 07:00–20:00",
};

describe("terms: read", () => {
  it("falls back to the seed terms when nothing is published", async () => {
    const res = await listTerms();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.active.id).toBe(SEED_TERMS.id);
    expect(res.active.version).toBe(1);
    expect(res.active.bodyEn.length).toBeGreaterThan(0);
    expect(res.active.bodyTh.length).toBeGreaterThan(0);
    expect(res.history).toHaveLength(1);
  });

  it("is owner-only", async () => {
    process.env.ADMIN_ROLE = "instructor";
    const res = await listTerms();
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});

describe("terms: publish", () => {
  it("rejects an unauthorised caller BEFORE validating input", async () => {
    process.env.ADMIN_ROLE = "instructor";
    // Deliberately invalid input: the gate must still report UNAUTHORIZED, never
    // INVALID_INPUT, so an instructor learns nothing about the schema.
    const res = await publishTerms({ bodyEn: "", bodyTh: "" });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("rejects empty bodies", async () => {
    const res = await publishTerms({ bodyEn: "   ", bodyTh: "ok" });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("reports MOCK_NO_DB rather than a fake success for a valid publish", async () => {
    const res = await publishTerms({ bodyEn: "New terms", bodyTh: "ข้อกำหนดใหม่" });
    expect(res).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });
});

describe("studio info", () => {
  it("falls back to the seed info when unset", async () => {
    const res = await getStudioInfo();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.info).toEqual(SEED_STUDIO_INFO);
  });

  it("is owner-only", async () => {
    process.env.ADMIN_ROLE = "instructor";
    expect(await getStudioInfo()).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await updateStudioInfo(VALID_STUDIO)).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("requires a studio name in both languages", async () => {
    const res = await updateStudioInfo({ ...VALID_STUDIO, nameTh: "  " });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://example.com/x", "not a url"])(
    "rejects a non-http(s) map link: %s",
    async (mapUrl) => {
      const res = await updateStudioInfo({ ...VALID_STUDIO, mapUrl });
      expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
    },
  );

  it("accepts an empty map link (meaning: none)", async () => {
    // Valid input, so it gets past validation and stops at the no-DB boundary.
    const res = await updateStudioInfo({ ...VALID_STUDIO, mapUrl: "" });
    expect(res).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });

  it("reports MOCK_NO_DB rather than a fake success for a valid save", async () => {
    const res = await updateStudioInfo(VALID_STUDIO);
    expect(res).toEqual({ ok: false, code: "MOCK_NO_DB" });
  });
});

describe("checkout consent gate", () => {
  it("opens a checkout when the accepted terms version is the active one", async () => {
    const res = await createCheckout({ packageId: "p10", termsVersionId: SEED_TERMS.id });
    expect(res.ok).toBe(true);
  });

  it.each([
    ["a stale version id", "00000000-0000-0000-0000-0000000000ff"],
    ["an invented id", "whatever"],
  ])("refuses a checkout with %s", async (_label, termsVersionId) => {
    const res = await createCheckout({ packageId: "p10", termsVersionId });
    expect(res).toEqual({ ok: false, code: "TERMS_OUTDATED" });
  });

  it("refuses a checkout with no consent at all", async () => {
    // The field is required by the contract — a client omitting it is INVALID_INPUT,
    // so there is no way to reach a charge without sending SOME acceptance.
    const res = await createCheckout({ packageId: "p10" } as never);
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("checks authorization-independent input before the terms gate", async () => {
    // An unknown package fails as UNKNOWN_PACKAGE even with valid consent — the
    // consent gate does not mask other failures.
    const res = await createCheckout({ packageId: "nope", termsVersionId: SEED_TERMS.id });
    expect(res).toEqual({ ok: false, code: "UNKNOWN_PACKAGE" });
  });
});
