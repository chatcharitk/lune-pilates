// Waitlist hold-sweep cron endpoint (CLAUDE.md §5 invariant 6).
//
// Expires every `offered` waitlist hold past its 30-minute deadline and cascades
// the offer to the next FIFO head of each affected class (emitting
// `waitlist.offered`). Occupancy/capacity is never touched — the freed seat stays
// openly bookable; this only moves the notification head-start down the queue.
//
// PROD WIRING: point a scheduler at this route on a short interval (e.g. Vercel
// Cron every minute, or an external cron hitting the URL). The hold granularity is
// 30 minutes, so even a 1–5 minute cadence keeps offers fresh. The route is
// idempotent — running it more often only ever no-ops on already-swept rows.
//
// AUTH: requires a shared secret in the `Authorization: Bearer <CRON_SECRET>` or
// `x-cron-secret` HEADER, matched timing-safely against the `CRON_SECRET` env
// var. HEADERS ONLY — the former `?secret=` query-param form was removed (audit:
// query strings land verbatim in access/proxy logs). Fails CLOSED: if
// `CRON_SECRET` is unset the route refuses to run (503).

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sweepWaitlist } from "@/lib/waitlist/queries";

// Always run dynamically (this mutates data); never cache.
export const dynamic = "force-dynamic";

/** Constant-time string compare (length-guarded — timingSafeEqual throws on mismatch). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // fail closed — no secret configured ⇒ no sweep.

  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const headerSecret = req.headers.get("x-cron-secret");

  return (
    (bearer !== null && safeEqual(bearer, expected)) ||
    (headerSecret !== null && safeEqual(headerSecret, expected))
  );
}

async function handle(req: Request): Promise<NextResponse> {
  if (!process.env.CRON_SECRET) {
    // Misconfiguration, not an auth failure — distinguish so ops can spot it.
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const summary = await sweepWaitlist(now);
  return NextResponse.json({ ok: true, sweptAt: now.toISOString(), ...summary });
}

// GET and POST both supported so it works with header-only schedulers (GET) and
// secret-in-body schedulers (POST) alike. Both require the shared secret.
export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
