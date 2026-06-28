// No-DB fallback + pure helpers for the admin "Members / Customers & households"
// read model (lib/admin/members.ts), plus the createCustomer action's no-DB path.
// Runs without DATABASE_URL so it exercises the mock path the screen renders
// against, and pins the two invariants the screen must honour:
//   - invariant 2 (shared pool consistency): every member of a house number reads
//     the SAME summed household pool.
//   - invariant 3 (guests): a guest's balance is their OWN packages only and a
//     guest never carries a sharing summary.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXPIRING_SOON_DAYS,
  getCustomerDetail,
  getCustomerLedger,
  listCustomers,
  matchesQuery,
  mid,
  summariseCredits,
  type UsablePackageSummary,
} from "@/lib/admin/members";
import { createCustomer } from "@/app/actions/admin-members";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

beforeEach(() => {
  // Force the no-DB mock path regardless of the dev environment.
  delete process.env.DATABASE_URL;
  delete process.env.ADMIN_AUTH;
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
});

const now = new Date("2026-06-22T06:00:00+07:00");
const day = 24 * 3_600_000;

function pkg(hoursLeft: number, daysOut: number): UsablePackageSummary {
  return { hoursLeft, expiresAt: new Date(now.getTime() + daysOut * day) };
}

describe("summariseCredits (pure)", () => {
  it("sums hours_left across packages and picks the soonest expiry", () => {
    const s = summariseCredits([pkg(5, 20), pkg(3, 30), pkg(1, 10)], now);
    expect(s.balance).toBe(9);
    expect(s.expiry).toBe(new Date(now.getTime() + 10 * day).toISOString());
  });

  it("an empty pool is a zero balance, no expiry, active", () => {
    const s = summariseCredits([], now);
    expect(s).toEqual({ balance: 0, expiry: null, status: "active" });
  });

  it("flags expiring exactly AT the threshold (inclusive)", () => {
    const s = summariseCredits([pkg(3, EXPIRING_SOON_DAYS)], now);
    expect(s.status).toBe("expiring");
  });

  it("stays active just beyond the threshold", () => {
    const s = summariseCredits([pkg(3, EXPIRING_SOON_DAYS + 1)], now);
    expect(s.status).toBe("active");
  });

  it("integer balances sum without float drift", () => {
    const s = summariseCredits([pkg(1, 5), pkg(1, 6), pkg(1, 7)], now);
    expect(s.balance).toBe(3);
  });
});

describe("matchesQuery (pure)", () => {
  const c = { name: "Pim Srisai", house: "A-114", phone: "081 234 5678" };
  it("matches by name (case-insensitive)", () => expect(matchesQuery(c, "pim")).toBe(true));
  it("matches by house", () => expect(matchesQuery(c, "a-114")).toBe(true));
  it("matches by phone fragment", () => expect(matchesQuery(c, "234")).toBe(true));
  it("an empty/space query matches everyone", () => {
    expect(matchesQuery(c, "")).toBe(true);
    expect(matchesQuery(c, "   ")).toBe(true);
    expect(matchesQuery(c, undefined)).toBe(true);
  });
  it("a non-matching query excludes the row", () => expect(matchesQuery(c, "zzz")).toBe(false));
  it("matches a guest with a null house without throwing", () => {
    expect(matchesQuery({ name: "Guest", house: null, phone: "099" }, "guest")).toBe(true);
    expect(matchesQuery({ name: "Guest", house: null, phone: "099" }, "a-1")).toBe(false);
  });
});

describe("listCustomers (no-DB mock)", () => {
  it("returns every customer, deterministically ordered by name", async () => {
    const list = await listCustomers({}, now);
    expect(list.length).toBe(8);
    const names = list.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("INVARIANT 2: every member of a house reads the SAME shared pool balance", async () => {
    const list = await listCustomers({}, now);
    const byId = new Map(list.map((c) => [c.id, c]));
    // A-114 members m1 + m7 share one household pool.
    const m1 = byId.get(mid(1))!;
    const m7 = byId.get(mid(7))!;
    expect(m1.tier).toBe("member");
    expect(m7.tier).toBe("member");
    expect(m1.house).toBe("A-114");
    expect(m7.house).toBe("A-114");
    expect(m1.balance).toBe(m7.balance); // the pool is one shared number
    expect(m1.expiry).toBe(m7.expiry); // and the same soonest expiry
    // C-007 members m4 + m5 likewise.
    expect(byId.get(mid(4))!.balance).toBe(byId.get(mid(5))!.balance);
  });

  it("INVARIANT 3: a guest in a member house reads ONLY their own credits", async () => {
    const list = await listCustomers({}, now);
    const byId = new Map(list.map((c) => [c.id, c]));
    const m3 = byId.get(mid(3))!; // a guest (no household, so no house)
    expect(m3.tier).toBe("guest");
    expect(m3.house).toBeNull(); // guests aren't in a household (spec User model)
    // The member pool in A-114 (m1 + m7 = 8) must NOT leak to the guest.
    const memberPool = byId.get(mid(1))!.balance;
    expect(m3.balance).not.toBe(memberPool);
    expect(m3.balance).toBe(5); // m3's own package only
    // A guest never carries a sharing summary.
    expect(m3.sharing).toBeNull();
  });

  it("members carry a sharing summary; shared iff the house has >1 person", async () => {
    const list = await listCustomers({}, now);
    const byId = new Map(list.map((c) => [c.id, c]));
    // m1 shares A-114 with member m7 (guest m3 isn't in the household) → shared, size 2.
    expect(byId.get(mid(1))!.sharing).toEqual({ householdSize: 2, shared: true });
    // m8 is the only person in E-088 → not shared, householdSize 1.
    expect(byId.get(mid(8))!.sharing).toEqual({ householdSize: 1, shared: false });
  });

  it("flags an expiring-soon member and an active one", async () => {
    const list = await listCustomers({}, now);
    const byId = new Map(list.map((c) => [c.id, c]));
    // m1's pool expires in 2 days → expiring.
    expect(byId.get(mid(1))!.status).toBe("expiring");
    // m8 expires in 41 days → active.
    expect(byId.get(mid(8))!.status).toBe("active");
  });

  it("search filters by name / house / phone", async () => {
    expect((await listCustomers({ query: "Pim" }, now)).map((c) => c.id)).toContain(mid(1));
    expect((await listCustomers({ query: "C-007" }, now)).map((c) => c.id).sort()).toEqual([mid(4), mid(5)]);
    expect((await listCustomers({ query: "778 5512" }, now)).map((c) => c.id)).toEqual([mid(6)]);
    expect(await listCustomers({ query: "nobody" }, now)).toEqual([]);
  });
});

describe("getCustomerDetail (no-DB mock)", () => {
  it("returns null for an unknown id", async () => {
    expect(await getCustomerDetail("nope", now)).toBeNull();
  });

  it("a member's detail lists the household members (self included; guests are standalone)", async () => {
    const d = (await getCustomerDetail(mid(1), now))!;
    expect(d).not.toBeNull();
    expect(d.sharingNote).toBe("member");
    const ids = d.housemates.map((h) => h.id).sort();
    expect(ids).toEqual([mid(1), mid(7)]); // members only — the guest m3 isn't in the household
    // self is present in the group
    expect(d.housemates.some((h) => h.id === mid(1))).toBe(true);
    // detail balance equals the row balance (one shared pool — invariant 2)
    const row = (await listCustomers({ query: "Pim" }, now)).find((c) => c.id === mid(1))!;
    expect(d.balance).toBe(row.balance);
  });

  it("a guest's detail uses the guest note and reads only their own credits", async () => {
    const d = (await getCustomerDetail(mid(3), now))!;
    expect(d.sharingNote).toBe("guest");
    expect(d.tier).toBe("guest");
    expect(d.sharing).toBeNull();
    expect(d.balance).toBe(5); // own package only — no household pool leak
  });
});

describe("getCustomerLedger (no-DB mock)", () => {
  it("returns the believable rows newest-first with correct running balanceAfter", async () => {
    const rows = await getCustomerLedger(mid(1), now);
    expect(rows.length).toBe(4);

    // Newest-first ordering by createdAt (descending).
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.createdAt >= rows[i]!.createdAt).toBe(true);
    }

    // Reasons present (one of each kind).
    expect(rows.map((r) => r.reason).sort()).toEqual(
      ["adjustment", "booking", "cancel_refund", "purchase"].sort(),
    );

    // The NEWEST row's balanceAfter = Σ all deltas (ledger reconciles to balance).
    const sumDeltas = rows.reduce((s, r) => s + r.delta, 0);
    expect(rows[0]!.balanceAfter).toBe(sumDeltas);
    expect(rows[0]!.balanceAfter).toBe(12); // 10 - 1 + 1 + 2

    // Running balances down the newest-first list: 12, 10, 9, 10 (oldest is purchase +10).
    expect(rows.map((r) => r.balanceAfter)).toEqual([12, 10, 9, 10]);

    // Deltas are signed integers.
    for (const r of rows) expect(Number.isInteger(r.delta)).toBe(true);
  });
});

describe("createCustomer (no-DB mock)", () => {
  it("creates a guest with no household even when a houseNumber is passed (invariant 3)", async () => {
    const res = await createCustomer({
      name: "New Guest",
      phone: "099 000 0001",
      tier: "guest",
      houseNumber: "Z-999",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.customer.tier).toBe("guest");
      expect(res.customer.house).toBeNull(); // houseNumber ignored for a guest
      expect(res.customer.householdCreated).toBe(false);
    }
  });

  it("keeps a member's houseNumber through", async () => {
    const res = await createCustomer({
      name: "New Member",
      phone: "099 000 0002",
      tier: "member",
      houseNumber: "F-100",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.customer.tier).toBe("member");
      expect(res.customer.house).toBe("F-100");
    }
  });

  it("rejects malformed input", async () => {
    const res = await createCustomer({ name: "", phone: "", tier: "member" });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("UNAUTHORIZED first in deny mode, before input parsing", async () => {
    process.env.ADMIN_AUTH = "deny";
    const res = await createCustomer({ name: "", phone: "", tier: "guest" });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" }); // gate beats INVALID_INPUT
  });
});
