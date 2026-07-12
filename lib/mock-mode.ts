// Central switch for the no-DB mock/dev mode (audit HIGH: ~40 call sites checked
// `!process.env.DATABASE_URL` directly, so a PRODUCTION deploy with a missing or
// typo'd DATABASE_URL silently served demo data and returned ok from mutations
// that wrote nothing). Mock mode is now allowed ONLY outside production: in prod
// the guards fall through to getDb(), which throws loudly (lib/db/client.ts) and
// surfaces the branded error boundary instead of an invisible misconfiguration.
//
// Best-effort side channels (LINE notification lookups) deliberately keep their
// own plain no-DB checks — a notification must never crash a money path.
export function mockDataMode(): boolean {
  return !process.env.DATABASE_URL && process.env.NODE_ENV !== "production";
}
