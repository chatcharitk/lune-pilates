// Pins the admin-auth gate (closing audit finding H1). With ADMIN_AUTH=deny the
// guard MUST reject every admin server action up-front — before input parsing and
// before the no-DB short-circuit — so a future refactor can't silently reorder it
// past those branches. Also confirms the v1 default (mock) leaves the gate a no-op.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireAdmin } from "@/lib/auth/admin";
import { setCheckIn } from "@/app/actions/admin";
import {
  createClass,
  deleteClass,
  generateWeekFromBaseline,
  publishWeek,
  updateClass,
} from "@/app/actions/schedule";
import {
  adminBookForCustomer,
  adminCancelBooking,
  adminOfferWaitlistSeat,
} from "@/app/actions/admin-bookings";
import { createCustomer } from "@/app/actions/admin-members";
import { posConfirmPayment, posSellPackage } from "@/app/actions/admin-pos";
import { approveSlip, getSlip, rejectSlip } from "@/app/actions/admin-payments";
import { setInstructorAvailability } from "@/app/actions/instructors";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

function restoreEnv() {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
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
];

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
