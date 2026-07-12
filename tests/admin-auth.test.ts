// Pins the admin-auth gate (closing audit finding H1). With ADMIN_AUTH=deny the
// guard MUST reject every admin server action up-front — before input parsing and
// before the no-DB short-circuit — so a future refactor can't silently reorder it
// past those branches. Also confirms the v1 default (mock) leaves the gate a no-op.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireAdmin, requireOwner } from "@/lib/auth/admin";
import { setCheckIn } from "@/app/actions/admin";
import {
  cancelClass,
  createClass,
  createTemplateSlot,
  deleteClass,
  deleteTemplateSlot,
  generateWeekFromBaseline,
  publishWeek,
  updateClass,
  updateTemplateSlot,
} from "@/app/actions/schedule";
import {
  adminBookForCustomer,
  adminCancelBooking,
  adminOfferWaitlistSeat,
  adminReschedule,
  adminSetBookingPosition,
} from "@/app/actions/admin-bookings";
import { createCustomer } from "@/app/actions/admin-members";
import { posConfirmPayment, posSellPackage } from "@/app/actions/admin-pos";
import { approveSlip, getSlip, rejectSlip } from "@/app/actions/admin-payments";
import {
  createInstructor,
  setInstructorActive,
  setInstructorAvailability,
  updateInstructor,
} from "@/app/actions/instructors";
import { adjustCredits, getAdjustablePackages, getCustomerLedger } from "@/app/actions/admin-credits";
import { updateSaleTime } from "@/app/actions/admin-sales";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;
const ORIGINAL_ADMIN_ROLE = process.env.ADMIN_ROLE;
const ORIGINAL_ADMIN_INSTRUCTOR_ID = process.env.ADMIN_INSTRUCTOR_ID;

function restoreEnv() {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
  // Save/restore the role state too so a block setting ADMIN_ROLE can't leak into
  // the next describe (and flip the default-owner expectations).
  if (ORIGINAL_ADMIN_ROLE === undefined) delete process.env.ADMIN_ROLE;
  else process.env.ADMIN_ROLE = ORIGINAL_ADMIN_ROLE;
  if (ORIGINAL_ADMIN_INSTRUCTOR_ID === undefined) delete process.env.ADMIN_INSTRUCTOR_ID;
  else process.env.ADMIN_INSTRUCTOR_ID = ORIGINAL_ADMIN_INSTRUCTOR_ID;
}

// Each admin action invoked with input that is EITHER malformed (uuid actions) or
// would otherwise succeed via the no-DB branch (week actions) — so a result of
// UNAUTHORIZED can only come from the gate running first.
const GATED_ACTIONS: { name: string; call: () => Promise<{ ok: boolean; code?: string }> }[] = [
  { name: "setCheckIn", call: () => setCheckIn({ bookingId: "not-a-uuid", checkedIn: true }) },
  {
    name: "createClass",
    call: () =>
      createClass({ date: "bad", time: "bad", type: "group", durationMin: 60, capacity: 3, instructorId: null }),
  },
  {
    name: "updateClass",
    call: () =>
      updateClass({ id: "bad", time: "bad", type: "group", durationMin: 60, capacity: 3, instructorId: null }),
  },
  { name: "deleteClass", call: () => deleteClass({ id: "not-a-uuid" }) },
  // Class-level cancel (Owner-only): malformed uuid — UNAUTHORIZED beats it.
  { name: "cancelClass", call: () => cancelClass({ id: "not-a-uuid" }) },
  // Template CRUD (Owner-only): malformed input (bad dayOfWeek/time/uuid) —
  // UNAUTHORIZED can only come from the requireOwner gate running first.
  {
    name: "createTemplateSlot",
    call: () =>
      createTemplateSlot({ dayOfWeek: 0, time: "bad", type: "group", durationMin: 60, capacity: 3 }),
  },
  {
    name: "updateTemplateSlot",
    call: () =>
      updateTemplateSlot({ id: "bad", time: "bad", type: "group", durationMin: 60, capacity: 3 }),
  },
  { name: "deleteTemplateSlot", call: () => deleteTemplateSlot({ id: "not-a-uuid" }) },
  { name: "generateWeekFromBaseline", call: () => generateWeekFromBaseline({ weekStart: "2026-06-15" }) },
  { name: "publishWeek", call: () => publishWeek({ weekStart: "2026-06-15" }) },
  { name: "adminCancelBooking", call: () => adminCancelBooking({ bookingId: "not-a-uuid" }) },
  { name: "adminOfferWaitlistSeat", call: () => adminOfferWaitlistSeat({ classInstanceId: "not-a-uuid" }) },
  {
    name: "adminBookForCustomer",
    call: () => adminBookForCustomer({ classInstanceId: "not-a-uuid", userId: "not-a-uuid" }),
  },
  // Malformed input (empty name/phone) — UNAUTHORIZED can only come from the gate.
  { name: "createCustomer", call: () => createCustomer({ name: "", phone: "", tier: "guest" }) },
  // POS: malformed input (bad uuid / empty packageId) — UNAUTHORIZED beats it.
  {
    name: "posSellPackage",
    call: () => posSellPackage({ customerId: "not-a-uuid", packageId: "", method: "cash", idempotencyKey: "x" }),
  },
  { name: "posConfirmPayment", call: () => posConfirmPayment({ chargeId: "" }) },
  // Slip verification (Feature 3): empty chargeId is malformed — UNAUTHORIZED beats it.
  { name: "approveSlip", call: () => approveSlip({ chargeId: "" }) },
  { name: "rejectSlip", call: () => rejectSlip({ chargeId: "" }) },
  { name: "getSlip", call: () => getSlip({ chargeId: "" }) },
  // Instructors: malformed input (empty id + bad time) — UNAUTHORIZED beats it.
  {
    name: "setInstructorAvailability",
    call: () =>
      setInstructorAvailability({
        instructorId: "",
        // @ts-expect-error malformed week on purpose — the gate must run first
        week: { Mon: [["bad", "bad"]] },
      }),
  },
  // Instructor CRUD (Owner-only): malformed input (empty names/id) — UNAUTHORIZED beats it.
  { name: "createInstructor", call: () => createInstructor({ name: "", nameTh: "" }) },
  { name: "updateInstructor", call: () => updateInstructor({ id: "", name: "", nameTh: "" }) },
  // @ts-expect-error malformed active on purpose — the gate must run before parse
  { name: "setInstructorActive", call: () => setInstructorActive({ id: "", active: "nope" }) },
  // Admin reschedule (#7, Owner-only): malformed uuids — UNAUTHORIZED beats it.
  {
    name: "adminReschedule",
    call: () => adminReschedule({ bookingId: "not-a-uuid", newClassInstanceId: "not-a-uuid" }),
  },
  // Reformer position change (Owner-only): malformed uuid — UNAUTHORIZED beats it.
  {
    name: "adminSetBookingPosition",
    call: () => adminSetBookingPosition({ bookingId: "not-a-uuid", position: "left" }),
  },
  // Manual credit adjustment (#8, Owner-only): malformed input — UNAUTHORIZED beats it.
  {
    name: "adjustCredits",
    call: () =>
      adjustCredits({ customerId: "bad", packageId: "bad", deltaHours: 0, note: "", idempotencyKey: "bad" }),
  },
  { name: "getAdjustablePackages", call: () => getAdjustablePackages("not-a-uuid") },
  // Sale-time correction (Owner-only): malformed datetime — UNAUTHORIZED beats it.
  { name: "updateSaleTime", call: () => updateSaleTime({ chargeId: "", soldAt: "not-a-date" }) },
];

// Owner-only actions = every gated action EXCEPT setCheckIn (which is
// instructor-allowed). An instructor hitting any of these is rejected like unauth.
const OWNER_ONLY_ACTIONS = GATED_ACTIONS.filter((a) => a.name !== "setCheckIn");

describe("admin auth gate — ADMIN_AUTH=deny rejects every admin action first", () => {
  beforeEach(() => {
    process.env.ADMIN_AUTH = "deny";
    delete process.env.DATABASE_URL; // also exercise the no-DB path
  });
  afterEach(restoreEnv);

  it("requireAdmin() returns null in deny mode", async () => {
    expect(await requireAdmin()).toBeNull();
  });

  for (const { name, call } of GATED_ACTIONS) {
    it(`${name} → UNAUTHORIZED (before input parse / no-DB branch)`, async () => {
      const res = await call();
      expect(res.ok).toBe(false);
      expect(res.code).toBe("UNAUTHORIZED");
    });
  }
});

describe("admin auth gate — v1 default (mock) is a no-op", () => {
  beforeEach(() => {
    delete process.env.ADMIN_AUTH; // default mode
    delete process.env.DATABASE_URL;
  });
  afterEach(restoreEnv);

  it("requireAdmin() resolves a session by default", async () => {
    const admin = await requireAdmin();
    expect(admin).not.toBeNull();
    expect(admin?.id).toBeTruthy();
  });

  it("a valid admin action still succeeds (gate transparent)", async () => {
    const res = await setCheckIn({
      bookingId: "00000000-0000-4000-8000-000000000001",
      checkedIn: true,
    });
    expect(res.ok).toBe(true);
  });
});

describe("ADMIN_ROLE=instructor — least-privilege: owner-only actions rejected, check-in allowed", () => {
  beforeEach(() => {
    process.env.ADMIN_ROLE = "instructor";
    delete process.env.ADMIN_AUTH; // not deny — exercise the instructor mock, not reject
    delete process.env.DATABASE_URL; // no-DB path (check-in is owner-equivalent here)
  });
  afterEach(restoreEnv);

  // (a) Every owner-only action rejects an instructor exactly like unauth — the
  // requireOwner() gate returns null for a non-owner → UNAUTHORIZED.
  for (const { name, call } of OWNER_ONLY_ACTIONS) {
    it(`${name} → UNAUTHORIZED for an instructor (requireOwner rejects)`, async () => {
      const res = await call();
      expect(res.ok).toBe(false);
      expect(res.code).toBe("UNAUTHORIZED");
    });
  }

  // (b) Check-in is instructor-allowed: the no-DB path returns ok for the instructor.
  it("setCheckIn → ok for an instructor (instructor-allowed)", async () => {
    const res = await setCheckIn({
      bookingId: "00000000-0000-4000-8000-000000000001",
      checkedIn: true,
    });
    expect(res.ok).toBe(true);
  });

  it("requireAdmin() resolves an instructor session with a non-null instructorId", async () => {
    const session = await requireAdmin();
    expect(session).not.toBeNull();
    expect(session?.role).toBe("instructor");
    expect(session?.instructorId).toBeTruthy();
  });

  it("requireOwner() is null for an instructor", async () => {
    expect(await requireOwner()).toBeNull();
  });
});

describe("requireOwner — default (no ADMIN_ROLE) is an owner", () => {
  beforeEach(() => {
    delete process.env.ADMIN_AUTH;
    delete process.env.ADMIN_ROLE;
    delete process.env.DATABASE_URL;
  });
  afterEach(restoreEnv);

  it("requireOwner() is non-null when ADMIN_ROLE is unset (owner)", async () => {
    const owner = await requireOwner();
    expect(owner).not.toBeNull();
    expect(owner?.role).toBe("owner");
    expect(owner?.instructorId).toBeNull();
  });
});

// getCustomerLedger is owner-gated PII (a customer's whole credit history) but
// returns CustomerLedgerEntry[] (not the {ok,code} shape GATED_ACTIONS asserts),
// so it gets its own gate test: a non-owner (deny) and an instructor must read [].
describe("getCustomerLedger — owner-only PII read returns [] for non-owners", () => {
  const VALID_ID = "00000000-0000-4000-8000-000000000001";
  beforeEach(() => delete process.env.DATABASE_URL);
  afterEach(restoreEnv);

  it("→ [] under ADMIN_AUTH=deny", async () => {
    process.env.ADMIN_AUTH = "deny";
    expect(await getCustomerLedger(VALID_ID)).toEqual([]);
  });

  it("→ [] for an instructor (requireOwner rejects)", async () => {
    delete process.env.ADMIN_AUTH;
    process.env.ADMIN_ROLE = "instructor";
    expect(await getCustomerLedger(VALID_ID)).toEqual([]);
  });
});
