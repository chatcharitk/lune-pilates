// Read model for the admin "Sales history" screen + CSV export (Group D #1,
// Owner-only). A "sale" is a `charges` row — the SAME unified payments ledger the
// Payments screen reads (lib/admin/payments.ts) — but scoped to an arbitrary
// [start, end) date range (rangeBounds) and returned as a flat, export-friendly
// SalesRow rather than the screen's grouped/stat shape.
//
// This deliberately REUSES the Payments helpers (packageLabelFor, normaliseMethod,
// normaliseStatus, whenDisplay) and the charges→users join, so the sales history
// can never drift from the Payments table: same money, same labels, same status
// normalisation. ALL statuses are included (paid AND pending AND awaiting_review
// AND rejected) — a sales/audit export must show every charge in the window, not
// just collected revenue. Newest-first, like the Payments table.
//
// Money is shaped server-side (CLAUDE.md §8): the amount comes from the stored
// charge row, never the client; the client supplies only the date range.
//
// No-DB dev fallback: reshapes the Payments mock fixture to SalesRow, filtered to
// the range, so the screen + export render without a database. The DB path is the
// authoritative one.

import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { charges, users } from "@/lib/db/schema";
import type { Bilingual } from "@/lib/i18n";
import type { PeriodBounds } from "@/lib/admin/period";
import {
  listPayments,
  normaliseMethod,
  normaliseStatus,
  packageLabelFor,
  whenDisplay,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/admin/payments";

// Re-export the tender/status unions from payments.ts — the single definition, so
// a SalesRow's method/status can never diverge from a PaymentRow's (don't redefine).
export type { PaymentMethod, PaymentStatus };

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/** One row of sales history, shaped for both the table and the CSV export. */
export interface SalesRow {
  /** The charge id (stable row key). */
  id: string;
  /** When the sale was opened (ISO 8601) — the export's Date column and sort key. */
  when: string;
  /** A short human display of `when` (e.g. "09:12", "Yesterday", "31 May"). */
  whenDisplay: string;
  /** The customer the charge is for. */
  customerName: string;
  /** The customer's users.id (avatar seed / detail link). */
  customerId: string;
  /** Bilingual package name resolved from the catalog by the stored packageId. */
  packageLabel: Bilingual;
  /** Raw catalog item id (e.g. "p10"), for any UI that needs the key, not the label. */
  packageId: string;
  /** How the sale was tendered. */
  method: PaymentMethod;
  /** THB amount, integer — from the charge row (set from the catalog at sale time). */
  amount: number;
  /** The charge lifecycle (all statuses are listed; the export shows every charge). */
  status: PaymentStatus;
}

/** A roll-up of a sales slice (pure, for an optional summary header). */
export interface SalesSummary {
  /** Number of charges in the slice (every status). */
  count: number;
  /** Σ amount of PAID charges (collected revenue). */
  revenuePaid: number;
  /** Σ amount of PENDING + AWAITING_REVIEW charges (uncollected). */
  pending: number;
}

// ───────────────────────── pure helpers ─────────────────────────

/**
 * Roll a set of sales rows into a small summary: total count (every status),
 * collected revenue (Σ paid), and uncollected (Σ pending + awaiting_review).
 * Pure (no I/O) and shared by the DB and mock paths; rejected charges contribute
 * to neither money tile. Summing integer THB never drifts (CLAUDE.md §8).
 */
export function summariseSales(rows: readonly SalesRow[]): SalesSummary {
  let revenuePaid = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === "paid") revenuePaid += r.amount;
    else if (r.status === "pending" || r.status === "awaiting_review") pending += r.amount;
  }
  return { count: rows.length, revenuePaid, pending };
}

// ───────────────────────── public query ─────────────────────────

/**
 * Every sale (charge) opened within the half-open `[range.start, range.end)`
 * window, newest first, shaped for the sales history table and the CSV export.
 * Includes ALL statuses (an audit export must show every charge in the window).
 * Each row carries the customer, the bilingual package label, the integer THB
 * amount, the tender method, the timestamp, and the status — all server-side.
 *
 * No-DB fallback: reshapes the Payments mock fixture to SalesRow, filtered to the
 * range. The DB path is authoritative.
 */
export async function listSales(range: PeriodBounds, now: Date = new Date()): Promise<SalesRow[]> {
  if (!process.env.DATABASE_URL) {
    return await mockListSales(range, now);
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
      name: users.name,
    })
    .from(charges)
    .innerJoin(users, eq(charges.userId, users.id))
    .where(and(gte(charges.createdAt, range.start), lt(charges.createdAt, range.end)))
    .orderBy(desc(charges.createdAt));

  return rows.map((r) => ({
    id: r.chargeId,
    when: r.createdAt.toISOString(),
    whenDisplay: whenDisplay(r.createdAt, now),
    customerName: r.name,
    customerId: r.userId,
    packageLabel: packageLabelFor(r.packageId),
    packageId: r.packageId,
    method: normaliseMethod(r.method),
    amount: r.amount,
    status: normaliseStatus(r.status),
  }));
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Reshape the Payments mock fixture (the single no-DB source of truth) into
// SalesRow, filtered to the range and re-sorted newest-first. We go through
// `listPayments` — which in the no-DB branch returns the mock fixture — so the
// sales mock and the payments mock stay byte-for-byte identical (one fixture).

async function mockListSales(range: PeriodBounds, now: Date): Promise<SalesRow[]> {
  const payments = await listPayments(now); // no-DB branch → mock fixture
  return payments
    .filter((p) => {
      const t = new Date(p.when).getTime();
      return t >= range.start.getTime() && t < range.end.getTime();
    })
    .map((p) => ({
      id: p.id,
      when: p.when,
      whenDisplay: p.whenDisplay,
      customerName: p.customer.name,
      customerId: p.customer.userId,
      packageLabel: p.packageLabel,
      packageId: p.packageId,
      method: p.method,
      amount: p.amount,
      status: p.status,
    }))
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
}
