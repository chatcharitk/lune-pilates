// CSV export of sales history (Group D #1, OWNER-ONLY).
//
// GET /api/admin/sales/export?from=yyyy-mm-dd&to=yyyy-mm-dd
//   → text/csv attachment of every charge in the INCLUSIVE [from..to] day range
//     (defaults: from = first-of-this-month, to = today), newest first, ALL
//     statuses. Columns (lib/admin/csv.ts): Date, Customer, Package, Method,
//     Amount, Status.
//
// SECURITY:
//   - OWNER-ONLY: `requireOwner()` is LINE 1 of the handler — a 403 is returned
//     BEFORE any DB read, so an instructor / unauthenticated caller can never
//     stream customer PII. (Mirrors the server-action gate discipline.)
//   - NO-CACHE: the body is customer PII (names, amounts) — `Cache-Control:
//     no-store` so no proxy/browser retains it.
//   - The client supplies ONLY the date range; the money and identities are read
//     server-side from the charges/users tables (CLAUDE.md §8). The range is
//     parsed via rangeBounds, which fails closed to the default window on a
//     malformed value.
//   - A UTF-8 BOM (﻿) prefixes the body so Excel renders Thai package labels
//     and customer names correctly.

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/admin";
import { rangeBounds } from "@/lib/admin/period";
import { listSales } from "@/lib/admin/sales";
import { salesRowsToCsv } from "@/lib/admin/csv";

// PII + always-fresh: never statically optimised, never cached.
export const dynamic = "force-dynamic";

/** Local `yyyy-mm-dd` of a Date, for the download filename. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: Request): Promise<NextResponse> {
  // OWNER GATE — line 1, before ANY DB read (no PII leaves on an unauthorized call).
  if (!(await requireOwner())) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const range = rangeBounds(from, to);

  const csv = salesRowsToCsv(await listSales(range), "en");

  // The filename labels the INCLUSIVE day range. `range.end` is the EXCLUSIVE upper
  // bound (start-of-(lastDay + 1)), so the inclusive last day is end − 1 day.
  const startLabel = ymd(range.start);
  const endLabel = ymd(new Date(range.end.getTime() - 24 * 3_600_000));

  // UTF-8 BOM (﻿) so Excel detects UTF-8 and renders Thai labels/names correctly.
  const body = "﻿" + csv;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lune-sales_${startLabel}_${endLabel}.csv"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
