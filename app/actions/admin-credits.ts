"use server";

// Server actions for the admin "Adjust credits" control (Group D #8, OWNER-ONLY),
// shown in the Members → customer detail drawer. requireOwner() is line 1 of each
// (an instructor/unauth is UNAUTHORIZED); the amount is validated + recomputed
// server-side (CLAUDE.md §8) — the client only ever sends a signed integer delta.
//
// adjustCredits is the only NEW write to the credit ledger. It is money-critical
// (CLAUDE.md §5 inv 1/2) and runs as ONE interactive transaction: replay-check the
// idempotencyKey, lock the chosen package FOR UPDATE, verify it belongs to the
// customer's pool (member → household, guest → own; invariants 2 & 3), guard the
// zero floor, insert ONE `delta` row with reason="adjustment" (keyed on the
// idempotencyKey via the partial-unique credit_ledger_idem_key index) and reconcile
// packages.hours_left by the same delta — all or nothing. The ledger is the source
// of truth; hours_left is the cache that must equal prior + delta. A dropped-response
// retry (same idempotencyKey) returns the already-applied outcome (pre-check + 23505
// recovery), so it can never double-apply.
//
// No-DB path: validates + echoes a synthesized reconciled balance so the UI flow
// (toast + router.refresh) works without a database.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/client";
import { creditLedger, packages } from "@/lib/db/schema";
import { loadPoolOwner } from "@/lib/credits/selectPackage";
import { ownerForPool, type CreditOwner } from "@/lib/credits/creditPackage";
import { packageLabelFor } from "@/lib/admin/payments";
import { getCustomerLedger as readCustomerLedger, type CustomerLedgerEntry } from "@/lib/admin/members";
import { emit } from "@/lib/events/bus";
import type { Bilingual } from "@/lib/i18n";
import type { PackageCategory } from "@/lib/domain/types";

const PG_UNIQUE_VIOLATION = "23505";
/** True when `err` is a Postgres unique-violation (SQLSTATE 23505), at either the
 *  top level or the neon-serverless-wrapped `cause` (mirrors creditPackage.ts). */
function isUniqueViolation(err: unknown): boolean {
  const top = err as { code?: string; cause?: { code?: string } } | null;
  return top?.code === PG_UNIQUE_VIOLATION || top?.cause?.code === PG_UNIQUE_VIOLATION;
}

/** SQL predicate selecting the pool's packages (household XOR user owner). */
function ownerPackagesWhere(owner: CreditOwner) {
  return owner.ownerHouseholdId !== null
    ? eq(packages.ownerHouseholdId, owner.ownerHouseholdId)
    : eq(packages.ownerUserId, owner.ownerUserId!);
}

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/** One package a customer holds that an owner can adjust the balance of. */
export interface AdjustablePackage {
  /** packages.id (the row the ledger adjustment is bound to). */
  id: string;
  /** Catalog category, for an icon/label hint. */
  category: PackageCategory;
  /** Bilingual display name (e.g. "10 hours"), resolved server-side from the catalog. */
  label: Bilingual;
  /** Current usable balance on this package, in whole credits (the cache). */
  hoursLeft: number;
  /** Soonest expiry (ISO 8601). */
  expiresAt: string;
}

export type GetAdjustablePackagesResult =
  | { ok: true; packages: AdjustablePackage[] }
  | { ok: false; code: AdjustFailureCode };

export interface AdjustCreditsInput {
  /** users.id of the customer whose pool is being adjusted. */
  customerId: string;
  /** packages.id selected in the drawer. */
  packageId: string;
  /** Signed whole-number credit delta (≠ 0); negative subtracts. */
  deltaHours: number;
  /** Required free-text reason (audit note); stored with the adjustment. */
  note: string;
  /** Per-drawer-open token; the backend keys the adjustment on it (no double-apply). */
  idempotencyKey: string;
}

export type AdjustFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_CUSTOMER"
  | "UNKNOWN_PACKAGE"
  | "NEGATIVE_BALANCE";

export interface AdjustOutcome {
  packageId: string;
  /** The signed delta that was applied. */
  deltaHours: number;
  /** The new reconciled balance on the package after the adjustment. */
  hoursLeft: number;
}

export type AdjustCreditsResult =
  | { ok: true; outcome: AdjustOutcome }
  | { ok: false; code: AdjustFailureCode };

// ───────────────────────── input validation ─────────────────────────

const adjustInput = z.object({
  customerId: z.string().uuid(),
  packageId: z.string().uuid(),
  // Whole non-zero integer; the UI also guards != 0.
  deltaHours: z.number().int().refine((n) => n !== 0, "delta must be non-zero"),
  note: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().uuid(),
});

// ───────────────────────── actions ─────────────────────────

/**
 * List the packages an owner can adjust for `customerId` — the customer's usable
 * pool (member → shared household pool, guest → own; invariants 2 & 3), resolved
 * server-side. OWNER-ONLY: `requireOwner()` is line 1 (an instructor / unauth is
 * UNAUTHORIZED).
 *
 * No-DB path: returns the mock customer's packages so the drawer renders.
 */
export async function getAdjustablePackages(
  customerId: string,
): Promise<GetAdjustablePackagesResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  if (!z.string().uuid().safeParse(customerId).success) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  if (!process.env.DATABASE_URL) {
    return mockGetAdjustablePackages(customerId);
  }

  // Resolve the customer's pool ownership from the DB (member → shared household
  // pool, guest → own; invariants 2 & 3), never from the client.
  const ctx = await loadPoolOwner(customerId);
  if (!ctx) return { ok: false, code: "UNKNOWN_CUSTOMER" };
  const owner = ownerForPool(ctx);

  const db = getDb();
  const rows = await db
    .select({
      id: packages.id,
      type: packages.type,
      category: packages.category,
      hoursLeft: packages.hoursLeft,
      expiresAt: packages.expiresAt,
    })
    .from(packages)
    .where(ownerPackagesWhere(owner))
    .orderBy(packages.expiresAt);

  return {
    ok: true,
    packages: rows.map((r) => ({
      id: r.id,
      category: r.category,
      label: packageLabelFor(r.type),
      hoursLeft: r.hoursLeft,
      expiresAt: r.expiresAt.toISOString(),
    })),
  };
}

/**
 * Apply a signed credit adjustment to one of a customer's packages. OWNER-ONLY:
 * `requireOwner()` is line 1. The amount is validated + recomputed server-side
 * (CLAUDE.md §8); the UI never sends a balance, only a signed delta.
 *
 * No-DB path: validates + echoes a synthesized reconciled balance so the UI flow
 * (toast + router.refresh) works without a database.
 */
export async function adjustCredits(raw: AdjustCreditsInput): Promise<AdjustCreditsResult> {
  const admin = await requireOwner();
  if (!admin) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = adjustInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  if (!process.env.DATABASE_URL) {
    return mockAdjustCredits(input);
  }

  // Resolve the customer's pool ownership server-side (member → shared household
  // pool, guest → own; invariants 2 & 3), never trusting the client.
  const ctx = await loadPoolOwner(input.customerId);
  if (!ctx) return { ok: false, code: "UNKNOWN_CUSTOMER" };
  const owner = ownerForPool(ctx);

  const db = getDb();

  // Atomic, idempotent adjustment: in ONE interactive transaction, replay-check the
  // idempotency key, lock the package FOR UPDATE, verify it belongs to the pool,
  // guard the zero floor, insert ONE reason='adjustment' ledger row (keyed on the
  // idempotencyKey) and reconcile packages.hours_left — all or nothing. The ledger
  // is the source of truth; hours_left is the cache that must equal prior + delta.
  type TxResult =
    | { outcome: AdjustOutcome; fresh: boolean }
    | { error: Exclude<AdjustFailureCode, "UNAUTHORIZED" | "INVALID_INPUT" | "UNKNOWN_CUSTOMER"> };

  let applied: TxResult;
  try {
    applied = await db.transaction(async (tx): Promise<TxResult> => {
      // Idempotent replay: this key already applied → return the recorded outcome.
      const [prior] = await tx
        .select({ packageId: creditLedger.packageId, delta: creditLedger.delta })
        .from(creditLedger)
        .where(eq(creditLedger.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (prior) {
        const [p] = await tx
          .select({ hoursLeft: packages.hoursLeft })
          .from(packages)
          .where(eq(packages.id, prior.packageId))
          .limit(1);
        return {
          outcome: { packageId: prior.packageId, deltaHours: prior.delta, hoursLeft: p?.hoursLeft ?? 0 },
          fresh: false,
        };
      }

      const [pkg] = await tx
        .select()
        .from(packages)
        .where(eq(packages.id, input.packageId))
        .for("update")
        .limit(1);
      if (!pkg) return { error: "UNKNOWN_PACKAGE" };
      // Ownership cross-check (invariant 3): the locked package must belong to the
      // resolved pool — a member can't adjust a guest's package, and vice versa.
      if (pkg.ownerHouseholdId !== owner.ownerHouseholdId || pkg.ownerUserId !== owner.ownerUserId) {
        return { error: "UNKNOWN_PACKAGE" };
      }
      const next = pkg.hoursLeft + input.deltaHours;
      if (next < 0) return { error: "NEGATIVE_BALANCE" };

      await tx.insert(creditLedger).values({
        packageId: pkg.id,
        delta: input.deltaHours,
        actorUserId: input.customerId, // recipient/pool owner — a real users row
        bookingId: null,
        reason: "adjustment",
        idempotencyKey: input.idempotencyKey,
      });
      await tx.update(packages).set({ hoursLeft: next }).where(eq(packages.id, pkg.id));

      return { outcome: { packageId: pkg.id, deltaHours: input.deltaHours, hoursLeft: next }, fresh: true };
    });
  } catch (err) {
    // A concurrent same-key insert lost the unique race → the adjustment already
    // applied; recover its outcome (idempotent, never double-apply).
    if (isUniqueViolation(err)) {
      const [prior] = await db
        .select({ packageId: creditLedger.packageId, delta: creditLedger.delta })
        .from(creditLedger)
        .where(eq(creditLedger.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (prior) {
        const [p] = await db
          .select({ hoursLeft: packages.hoursLeft })
          .from(packages)
          .where(eq(packages.id, prior.packageId))
          .limit(1);
        return {
          ok: true,
          outcome: { packageId: prior.packageId, deltaHours: prior.delta, hoursLeft: p?.hoursLeft ?? 0 },
        };
      }
    }
    throw err;
  }

  if ("error" in applied) return { ok: false, code: applied.error };

  // CRM notify only on a fresh apply (not an idempotent replay) — best-effort, after
  // commit, never a parallel source of truth (the ledger row already holds it).
  if (applied.fresh) {
    await emit({
      type: "credit.adjusted",
      packageId: applied.outcome.packageId,
      customerId: input.customerId,
      owner,
      delta: input.deltaHours,
      hoursLeft: applied.outcome.hoursLeft,
      note: input.note,
      adminId: admin.id,
    });
    revalidatePath("/admin/members");
  }

  return { ok: true, outcome: applied.outcome };
}

/**
 * Owner-gated thin wrapper over the lib/admin/members getCustomerLedger READ MODEL,
 * so the Members drawer (a client component) can fetch a customer's credit-transaction
 * history (the read model imports the DB and can't be called from the client directly).
 * requireOwner() is line 1 (an instructor / unauth gets []); the pool is recomputed
 * server-side from the customer id (member → household pool, guest → own; invariants
 * 2 & 3) — no client value is trusted. Returns [] on a bad id or unknown customer.
 *
 * No-DB path: the underlying read model already returns a believable mock ledger.
 */
export async function getCustomerLedger(customerId: string): Promise<CustomerLedgerEntry[]> {
  if (!(await requireOwner())) return [];
  if (!z.string().uuid().safeParse(customerId).success) return [];
  return readCustomerLedger(customerId);
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Mirrors lib/admin/members.ts MOCK_CUSTOMERS so the drawer's package picker and
// the adjustment flow render + succeed without a database. The DB path is the
// authoritative one (and is the backend's to implement — see file header).

/** Stable UUID-shaped mock id matching lib/admin/members.ts `mid()`. */
function mid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** A package id derived from a customer id, so the mock picker has a stable key. */
function mockPkgId(customerIndex: number): string {
  return `00000000-0000-4000-9000-${String(customerIndex).padStart(12, "0")}`;
}

// (id, own credits) for each mock customer, mirroring members.ts ownHours.
const MOCK_PKG: { customerId: string; hoursLeft: number; category: PackageCategory; label: Bilingual; days: number }[] = [
  { customerId: mid(1), hoursLeft: 5, category: "group", label: { en: "10 hours", th: "10 ชั่วโมง" }, days: 2 },
  { customerId: mid(2), hoursLeft: 2, category: "group", label: { en: "5 hours", th: "5 ชั่วโมง" }, days: 5 },
  { customerId: mid(3), hoursLeft: 5, category: "group", label: { en: "10 hours", th: "10 ชั่วโมง" }, days: 8 },
  { customerId: mid(4), hoursLeft: 6, category: "private", label: { en: "1:1 · 8-hour pack", th: "ส่วนตัว · แพ็ก 8 ชม." }, days: 23 },
  { customerId: mid(5), hoursLeft: 6, category: "private", label: { en: "1:1 · 8-hour pack", th: "ส่วนตัว · แพ็ก 8 ชม." }, days: 23 },
  { customerId: mid(6), hoursLeft: 1, category: "group", label: { en: "1 hour", th: "1 ชั่วโมง" }, days: 1 },
  { customerId: mid(7), hoursLeft: 3, category: "group", label: { en: "5 hours", th: "5 ชั่วโมง" }, days: 2 },
  { customerId: mid(8), hoursLeft: 9, category: "group", label: { en: "15 hours", th: "15 ชั่วโมง" }, days: 41 },
];

function mockGetAdjustablePackages(customerId: string): GetAdjustablePackagesResult {
  const idx = MOCK_PKG.findIndex((p) => p.customerId === customerId);
  if (idx < 0) return { ok: false, code: "UNKNOWN_CUSTOMER" };
  const p = MOCK_PKG[idx]!;
  const expiresAt = new Date(Date.now() + p.days * 24 * 3_600_000).toISOString();
  return {
    ok: true,
    packages: [
      { id: mockPkgId(idx + 1), category: p.category, label: p.label, hoursLeft: p.hoursLeft, expiresAt },
    ],
  };
}

function mockAdjustCredits(input: z.infer<typeof adjustInput>): AdjustCreditsResult {
  const idx = MOCK_PKG.findIndex((p) => p.customerId === input.customerId);
  if (idx < 0) return { ok: false, code: "UNKNOWN_CUSTOMER" };
  if (input.packageId !== mockPkgId(idx + 1)) return { ok: false, code: "UNKNOWN_PACKAGE" };
  const next = MOCK_PKG[idx]!.hoursLeft + input.deltaHours;
  if (next < 0) return { ok: false, code: "NEGATIVE_BALANCE" };
  return { ok: true, outcome: { packageId: input.packageId, deltaHours: input.deltaHours, hoursLeft: next } };
}
