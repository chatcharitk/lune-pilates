// Live concurrency proof for the money/seat invariants (CLAUDE.md §5 inv 1 & 8).
// Requires a real DATABASE_URL — run after `npm run db:push`.
//
//   npm run verify:concurrency
//
// It builds isolated fixtures (unique ids per run, safe to re-run) and fires
// parallel bookClassWithDebit calls to prove the transaction never oversells.

import "./_load-env";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookClassWithDebit } from "@/lib/credits/debit";
import { bookings, classInstances, creditLedger, households, packages, users } from "@/lib/db/schema";

const db = getDb();
const tag = `ct_${Date.now().toString(36)}`;
const future = (h: number) => new Date(Date.now() + h * 3_600_000);

let failures = 0;
function check(label: string, pass: boolean, detail: string) {
  console.info(`${pass ? "✓ PASS" : "✗ FAIL"} — ${label}: ${detail}`);
  if (!pass) failures++;
}

async function makeHousehold(houseNo: string) {
  const [h] = await db.insert(households).values({ houseNumber: houseNo }).returning();
  return h!;
}
async function makeMember(phone: string, householdId: string) {
  const [u] = await db
    .insert(users)
    .values({ phone, name: phone, tier: "member", householdId })
    .returning();
  return u!;
}
async function makeGroupPackage(householdId: string, hoursLeft: number) {
  const [p] = await db
    .insert(packages)
    .values({
      type: "p10",
      category: "group",
      hoursTotal: hoursLeft,
      hoursLeft,
      expiresAt: future(720),
      ownerHouseholdId: householdId,
    })
    .returning();
  return p!;
}
async function makeGroupClass(capacity: number) {
  const [c] = await db
    .insert(classInstances)
    .values({
      startsAt: future(48),
      durationMin: 60,
      type: "group",
      capacity,
      status: "published",
      publishedAt: new Date(),
    })
    .returning();
  return c!;
}

// ── Scenario A: shared household pool with only 1 credit, two members race ──
// Different users, different seats — only the credit pool constrains. Exactly
// one booking must succeed; the pool must end at 0 with exactly one −1 ledger row.
async function scenarioCreditOversell() {
  const house = await makeHousehold(`${tag}-A`);
  const u1 = await makeMember(`${tag}-A1`, house.id);
  const u2 = await makeMember(`${tag}-A2`, house.id);
  const pkg = await makeGroupPackage(house.id, 1); // covers exactly ONE booking
  const cls = await makeGroupClass(2); // seats are NOT the limit

  const results = await Promise.all([
    bookClassWithDebit({ classInstanceId: cls.id, userId: u1.id, viewerTier: "member", packageId: pkg.id, position: "left" }),
    bookClassWithDebit({ classInstanceId: cls.id, userId: u2.id, viewerTier: "member", packageId: pkg.id, position: "right" }),
  ]);

  const ok = results.filter((r) => r.ok).length;
  const noCredits = results.filter((r) => !r.ok && r.code === "NO_CREDITS").length;
  const [pkgAfter] = await db.select().from(packages).where(eq(packages.id, pkg.id));
  const debitRows = await db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.packageId, pkg.id), eq(creditLedger.reason, "booking")));
  const live = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.classInstanceId, cls.id), eq(bookings.status, "booked")));

  console.info("\n── Scenario A: credit oversell (pool 1, 2 racers) ──");
  check("exactly one booking succeeds", ok === 1, `${ok} ok, ${noCredits} NO_CREDITS`);
  check("pool ends at 0 (no over-debit)", pkgAfter?.hoursLeft === 0, `hoursLeft=${pkgAfter?.hoursLeft}`);
  check("exactly one −1 ledger row", debitRows.length === 1, `${debitRows.length} debit rows`);
  check("exactly one live booking", live.length === 1, `${live.length} live`);
}

// ── Scenario B: capacity 1, five members with plenty of credit race the seat ──
// Credits are NOT the limit. Exactly one booking must win the single seat.
async function scenarioSeatOversell() {
  const house = await makeHousehold(`${tag}-B`);
  const pkg = await makeGroupPackage(house.id, 10); // plenty
  const cls = await makeGroupClass(1); // ONE seat
  const members = await Promise.all(
    [1, 2, 3, 4, 5].map((n) => makeMember(`${tag}-B${n}`, house.id)),
  );

  const results = await Promise.all(
    members.map((u) => bookClassWithDebit({ classInstanceId: cls.id, userId: u.id, viewerTier: "member", packageId: pkg.id })),
  );

  const ok = results.filter((r) => r.ok).length;
  const full = results.filter((r) => !r.ok && r.code === "CLASS_FULL").length;
  const [pkgAfter] = await db.select().from(packages).where(eq(packages.id, pkg.id));
  const live = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.classInstanceId, cls.id), eq(bookings.status, "booked")));

  console.info("\n── Scenario B: seat oversell (cap 1, 5 racers) ──");
  check("exactly one booking wins the seat", ok === 1, `${ok} ok, ${full} CLASS_FULL`);
  check("pool debited exactly once (10 → 9)", pkgAfter?.hoursLeft === 9, `hoursLeft=${pkgAfter?.hoursLeft}`);
  check("exactly one live booking", live.length === 1, `${live.length} live`);
}

async function main() {
  console.info(`Running live concurrency verification (fixtures tagged ${tag})…`);
  await scenarioCreditOversell();
  await scenarioSeatOversell();
  console.info(`\n${failures === 0 ? "✅ ALL INVARIANTS HELD" : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
