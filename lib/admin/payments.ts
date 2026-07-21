// Read model for the admin "Payments & POS" screen (spec §4: "POS checkout: Sell
// packages & retail, take PromptPay or cash, issue a receipt."; prototype
// admin-more.jsx `PaymentsScreen`). Returns the payments table (newest first) plus
// the four stat tiles at the top.
//
// Like the other admin read models (today.ts, bookings.ts, members.ts) this is the
// studio's OWN view: it lists every charge regardless of who opened it, applies no
// tiered visibility, and shapes ALL money server-side (CLAUDE.md §8) — amounts come
// from the `charges` row (set from the catalog at sale time), the package label is
// resolved from the catalog by the stored `packageId`, and nothing is trusted from
// the client.
//
// A "payment" row is a `charges` row. The customer self-purchase flow and the admin
// POS both write charges, so this read model is the single, unified payments ledger
// for the front desk — paid (green) and pending (amber), exactly the two states the
// prototype renders.
//
// PERIOD: the stat tiles ("Revenue · June", "this week") are scoped to the CURRENT
// CALENDAR MONTH (see PERIOD_*). Revenue MTD = Σ amount of paid charges this month;
// pending = Σ amount of pending charges this month; package sales = count of paid
// charges this month; new members = users created this month. The period is a named
// constant so it's a one-line change, no schema churn.
//
// No-DB dev fallback: when DATABASE_URL is unset the functions return mock data
// mirroring admin-data.jsx (PAYMENTS), so the screen renders without a database. The
// DB path is the real one.

import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { charges, paymentSlips, users } from "@/lib/db/schema";
import { loadCatalogMap, type CatalogItem } from "@/lib/catalog/packages";
import type { Bilingual } from "@/lib/i18n";
import { PERIOD, periodBounds } from "@/lib/admin/period";
import { formatStudioDate, studioInstant, studioParts, studioStartOfDay } from "@/lib/time";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── period ─────────────────────────
// The accounting window the stat tiles roll up (CURRENT CALENDAR MONTH) now
// lives in lib/admin/period.ts so the Payments tile and the Business Dashboard
// share ONE definition and can never drift. Re-exported here so existing callers
// (and tests) that import PERIOD/periodBounds from this module keep working.
export { PERIOD, periodBounds };

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/** A payment row's customer, as the table renders them (avatar + name). */
export interface PaymentCustomer {
  /** The customer who the charge is for; also the avatar seed. */
  userId: string;
  name: string;
}

/** How a sale was tendered. (Card is out of scope for v1 — see admin-pos.ts.) */
export type PaymentMethod = "promptpay" | "cash";

/**
 * A charge's lifecycle as the admin table renders it (Feature 3):
 *   paid            → credited (green / revenue);
 *   pending         → QR shown, not yet paid (amber / uncollected);
 *   awaiting_review → slip uploaded, awaiting the front desk's verification
 *                     (amber / uncollected — NOT revenue until approved);
 *   rejected        → slip rejected, no credit (red / uncollected).
 *   cancelled       → the sale was voided by the front desk (any unused credit
 *                     reversed); contributes to NO money tile (neither revenue nor
 *                     pending) — see app/actions/admin-sales.ts → cancelSale.
 */
export type PaymentStatus = "paid" | "pending" | "awaiting_review" | "rejected" | "cancelled";

/** One row in the admin payments table. */
export interface PaymentRow {
  /** The charge id (stable row key; also the id `posConfirmPayment` confirms). */
  id: string;
  customer: PaymentCustomer;
  /** Bilingual package name resolved from the catalog by the stored packageId. */
  packageLabel: Bilingual;
  /** Raw catalog item id (e.g. "p10"), for any UI that needs the key, not the label. */
  packageId: string;
  /** THB amount, integer — from the charge row (set from the catalog at sale time). */
  amount: number;
  method: PaymentMethod;
  /** When the charge was opened (ISO 8601). */
  when: string;
  /** A short human display of `when` (e.g. "09:12", "Yesterday", "31 May"). */
  whenDisplay: string;
  status: PaymentStatus;
  /** true when a slip has been uploaded for this charge (the row is viewable/verifiable). */
  hasSlip: boolean;
  /** When an admin reviewed the slip (ISO 8601), or null when not yet reviewed. */
  reviewedAt: string | null;
}

/** The four stat tiles atop the Payments screen. */
export interface PaymentsStats {
  /** Σ amount of PAID charges in the period (the "Revenue · <month>" tile). */
  revenuePaid: number;
  /** Count of PAID charges in the period (the "Package sales" tile). */
  packageSales: number;
  /** Σ amount of PENDING charges in the period (the amber "Pending" tile). */
  pending: number;
  /** Count of users created in the period (the "New members" tile). */
  newMembers: number;
}

/** The whole screen in one fetch: the stat tiles + the rows. */
export interface PaymentsOverview {
  stats: PaymentsStats;
  rows: PaymentRow[];
}

// ───────────────────────── pure helpers ─────────────────────────

/**
 * A charge's display package label. Resolves the bilingual catalog label by the
 * stored `packageId`; falls back to the raw id (never throws) when the catalog has
 * drifted, so a stale charge still renders a row.
 *
 * PURE by construction: the caller loads the catalog ONCE (`loadCatalogMap()`) and
 * passes it in, rather than this helper awaiting a read per row (an N+1 over the
 * charge list). The map includes ARCHIVED items, so a charge for a since-retired
 * package still renders its real label instead of the raw slug.
 */
export function packageLabelFor(
  packageId: string,
  catalog: ReadonlyMap<string, CatalogItem>,
): Bilingual {
  return catalog.get(packageId)?.label ?? { en: packageId, th: packageId };
}

/**
 * Normalise a stored charge method to the contract's `PaymentMethod`. The column is
 * free-text with a "promptpay" default; anything not "cash" reads as "promptpay" so
 * a legacy/unknown value never breaks the table (fail safe to the default tender).
 */
export function normaliseMethod(method: string): PaymentMethod {
  return method === "cash" ? "cash" : "promptpay";
}

/**
 * Normalise a stored charge status to the contract's `PaymentStatus`. The four known
 * states map through; anything else (e.g. legacy "expired", or an unknown value)
 * fails SAFE to "pending" so an unrecognised status is never shown as revenue.
 */
export function normaliseStatus(status: string): PaymentStatus {
  switch (status) {
    case "paid":
      return "paid";
    case "awaiting_review":
      return "awaiting_review";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

/**
 * Roll a set of payment rows into the stat tiles over [start, end). Pure (no I/O)
 * so it is unit-testable and shared by the DB and mock paths. `newMembers` is
 * supplied separately (it counts users, not charges). Summing integer THB never
 * drifts.
 */
export function summarisePayments(
  rows: readonly PaymentRow[],
  newMembers: number,
): PaymentsStats {
  let revenuePaid = 0;
  let packageSales = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === "paid") {
      // Only an APPROVED charge is revenue (Feature 3 — money is granted on approve).
      revenuePaid += r.amount;
      packageSales += 1;
    } else if (r.status === "pending" || r.status === "awaiting_review") {
      // Uncollected: a QR not yet paid, OR a slip awaiting verification. Either way
      // it is NOT revenue until approved, so it rolls into the amber "pending" tile.
      pending += r.amount;
    }
    // "rejected" contributes to neither tile (no credit, not pending collection).
  }
  return { revenuePaid, packageSales, pending, newMembers };
}

/**
 * A short, locale-stable display for a charge instant relative to `now`:
 *   - same day  → "HH:MM" (24h)
 *   - yesterday → "Yesterday"
 *   - same year → "D MMM" (e.g. "31 May")
 *   - else      → "D MMM YYYY"
 * Mirrors the prototype's `when` strings. English-only by design — it is a terse
 * timestamp, not user copy; the frontend may reformat per `lang` from the ISO.
 */
export function whenDisplay(when: Date, now: Date = new Date()): string {
  // Day-bucketing + time-of-day are all pinned to the studio's Bangkok day so the
  // label is correct regardless of the runtime timezone.
  const whenDay = studioStartOfDay(when).getTime();
  const todayDay = studioStartOfDay(now).getTime();
  const w = studioParts(when);
  if (whenDay === todayDay) {
    return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  }
  if (whenDay === todayDay - 24 * 3_600_000) return "Yesterday";
  const month = formatStudioDate(when, "en", { month: "short" });
  return w.year === studioParts(now).year
    ? `${w.day} ${month}`
    : `${w.day} ${month} ${w.year}`;
}

// ───────────────────────── public queries ─────────────────────────

/**
 * Every payment (charge), newest first, for the admin payments table. Each row
 * carries the customer, the bilingual package label (resolved from the catalog),
 * the THB amount, the tender method, the timestamp, and the paid/pending status —
 * all shaped server-side.
 *
 * No-DB fallback: returns mock rows mirroring admin-data.jsx. The DB path is
 * authoritative.
 */
export async function listPayments(now: Date = new Date()): Promise<PaymentRow[]> {
  // The catalog is loaded ONCE per query and threaded into the pure label helper,
  // so labelling N charges costs one read, not N (see packageLabelFor).
  const catalog = await loadCatalogMap();

  if (mockDataMode()) {
    return mockListPayments(now, catalog);
  }

  const db = getDb();
  const rows = await db
    .select({
      chargeId: charges.chargeId,
      packageId: charges.packageId,
      userId: charges.userId,
      amount: charges.amount,
      method: charges.method,
      status: charges.status,
      createdAt: charges.createdAt,
      reviewedAt: charges.reviewedAt,
      name: users.name,
      slipId: paymentSlips.id,
    })
    .from(charges)
    .innerJoin(users, eq(charges.userId, users.id))
    .leftJoin(paymentSlips, eq(paymentSlips.chargeId, charges.chargeId))
    .orderBy(desc(charges.createdAt));

  return rows.map((r) => ({
    id: r.chargeId,
    customer: { userId: r.userId, name: r.name },
    packageLabel: packageLabelFor(r.packageId, catalog),
    packageId: r.packageId,
    amount: r.amount,
    method: normaliseMethod(r.method),
    when: r.createdAt.toISOString(),
    whenDisplay: whenDisplay(r.createdAt, now),
    status: normaliseStatus(r.status),
    hasSlip: r.slipId !== null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  }));
}

/**
 * The four stat tiles, scoped to the current-month PERIOD: revenue (Σ paid),
 * package sales (count paid), pending (Σ pending), and new members (users created
 * this period). All recomputed server-side from the charges/users tables.
 *
 * No-DB fallback: derives the tiles from the mock rows + a mock new-member count.
 */
export async function getPaymentsStats(now: Date = new Date()): Promise<PaymentsStats> {
  const { start, end } = periodBounds(now);
  const catalog = await loadCatalogMap();

  if (mockDataMode()) {
    const rows = mockListPayments(now, catalog).filter((r) => inPeriod(r.when, start, end));
    return summarisePayments(rows, MOCK_NEW_MEMBERS);
  }

  const db = getDb();

  // Charges opened in the period (shaped to rows so the SAME summariser runs) and
  // the new-member count — independent queries, ONE parallel round trip.
  const [chargeRows, memberRows] = await Promise.all([
    db
      .select({
        chargeId: charges.chargeId,
        packageId: charges.packageId,
        userId: charges.userId,
        amount: charges.amount,
        method: charges.method,
        status: charges.status,
        createdAt: charges.createdAt,
        reviewedAt: charges.reviewedAt,
        name: users.name,
      })
      .from(charges)
      .innerJoin(users, eq(charges.userId, users.id))
      .where(and(gte(charges.createdAt, start), lt(charges.createdAt, end))),
    // New members: users created in the period.
    db
      .select({ id: users.id })
      .from(users)
      .where(and(gte(users.createdAt, start), lt(users.createdAt, end))),
  ]);

  const rows: PaymentRow[] = chargeRows.map((r) => ({
    id: r.chargeId,
    customer: { userId: r.userId, name: r.name },
    packageLabel: packageLabelFor(r.packageId, catalog),
    packageId: r.packageId,
    amount: r.amount,
    method: normaliseMethod(r.method),
    when: r.createdAt.toISOString(),
    whenDisplay: whenDisplay(r.createdAt, now),
    status: normaliseStatus(r.status),
    // The stat tiles only sum amounts by status; slip presence is irrelevant here.
    hasSlip: false,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  }));

  return summarisePayments(rows, memberRows.length);
}

/**
 * The whole Payments screen in one call: the stat tiles plus the full rows list.
 * The tiles are period-scoped; the rows are the complete history (newest first).
 */
export async function getPaymentsOverview(now: Date = new Date()): Promise<PaymentsOverview> {
  const [stats, rows] = await Promise.all([getPaymentsStats(now), listPayments(now)]);
  return { stats, rows };
}

// ───────────────────────── helpers ─────────────────────────

/** Is the ISO instant `whenIso` within [start, end)? */
function inPeriod(whenIso: string, start: Date, end: Date): boolean {
  const t = new Date(whenIso).getTime();
  return t >= start.getTime() && t < end.getTime();
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Mirrors admin-data.jsx PAYMENTS so the screen renders a believable list without a
// database. Member ids/names mirror MEMBERS; packageIds map to real catalog items so
// the labels resolve exactly as the DB path would. The DB path is authoritative.

/** New members this period for the no-DB tile (admin-data.jsx PaymentsScreen shows 3). */
const MOCK_NEW_MEMBERS = 3;

interface MockPayment {
  id: string;
  userId: string;
  name: string;
  /** A real catalog item id so packageLabelFor resolves the bilingual label. */
  packageId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  /** true when a slip has been uploaded (awaiting_review rows always have one). */
  hasSlip: boolean;
  /** Days before `now` the charge was opened (0 = today), plus a fixed local time. */
  daysAgo: number;
  hour: number;
  minute: number;
}

// Mirrors admin-data.jsx PAYMENTS (member, pkg, amount, method, status, when),
// remapped onto catalog item ids: "15 hours"→p15, "10 hours"→p10, "5 hours"→p5,
// "Drop-in"→drop. Names mirror the MEMBERS mock used elsewhere. Two awaiting_review
// rows (slip uploaded, not yet verified) are included so the admin verification queue
// renders against the no-DB mock (Feature 3).
const MOCK_PAYMENTS: MockPayment[] = [
  { id: "pay_p6", userId: "m3", name: "Gun Thanawat", packageId: "p10", amount: 5500, method: "promptpay", status: "awaiting_review", hasSlip: true, daysAgo: 0, hour: 10, minute: 5 },
  { id: "pay_p1", userId: "m4", name: "Best Pongsak", packageId: "p15", amount: 7500, method: "promptpay", status: "paid", hasSlip: true, daysAgo: 0, hour: 9, minute: 12 },
  { id: "pay_p7", userId: "m5", name: "Fai Naphat", packageId: "p5", amount: 2950, method: "promptpay", status: "awaiting_review", hasSlip: true, daysAgo: 1, hour: 19, minute: 22 },
  { id: "pay_p2", userId: "m8", name: "Ann Kanya", packageId: "p10", amount: 5500, method: "promptpay", status: "paid", hasSlip: true, daysAgo: 1, hour: 16, minute: 30 },
  { id: "pay_p3", userId: "m2", name: "Nok Charoen", packageId: "p5", amount: 2950, method: "promptpay", status: "pending", hasSlip: false, daysAgo: 1, hour: 11, minute: 5 },
  { id: "pay_p4", userId: "m1", name: "Pim Srisai", packageId: "p10", amount: 5500, method: "cash", status: "paid", hasSlip: false, daysAgo: 2, hour: 18, minute: 40 },
  { id: "pay_p5", userId: "m6", name: "Mind Arunee", packageId: "drop", amount: 650, method: "promptpay", status: "paid", hasSlip: true, daysAgo: 3, hour: 8, minute: 15 },
];

/** The instant a mock payment was opened, relative to `now` (Bangkok-anchored so
 * the seed's intended hour/minute is what whenDisplay renders under any TZ). */
function mockWhen(p: MockPayment, now: Date): Date {
  const { year, month0, day } = studioParts(studioStartOfDay(now));
  return studioInstant(year, month0, day - p.daysAgo, p.hour, p.minute);
}

function mockListPayments(now: Date, catalog: ReadonlyMap<string, CatalogItem>): PaymentRow[] {
  return MOCK_PAYMENTS.map((p) => {
    const when = mockWhen(p, now);
    return {
      id: p.id,
      customer: { userId: p.userId, name: p.name },
      packageLabel: packageLabelFor(p.packageId, catalog),
      packageId: p.packageId,
      amount: p.amount,
      method: p.method,
      when: when.toISOString(),
      whenDisplay: whenDisplay(when, now),
      status: p.status,
      hasSlip: p.hasSlip,
      // awaiting_review = uploaded but not yet reviewed; paid mock rows predate this
      // feature's review stamp, so leave reviewedAt null for the no-DB fixture.
      reviewedAt: null,
    };
  }).sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
}
