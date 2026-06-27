// Neon serverless Postgres + Drizzle.
//
// We use the WebSocket `Pool` driver (not the HTTP `neon()` driver) because the
// credit-ledger debit needs a real interactive multi-statement transaction
// (SELECT … FOR UPDATE, then INSERT/UPDATE). See CLAUDE.md §2.
//
// The client is lazily initialised so importing this module never throws when
// DATABASE_URL is absent (e.g. UI rendering against mock data in v1).

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

let _pool: Pool | null = null;
let _db: NeonDatabase<typeof schema> | null = null;

export type Database = NeonDatabase<typeof schema>;

export function getDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at your Neon pooled connection string.",
    );
  }
  if (!_db) {
    _pool = new Pool({ connectionString: url });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

/**
 * Close the pooled connection and reset the lazy singletons. A no-op when no pool
 * was ever opened. The app itself never needs this (the pool lives for the process
 * lifetime), but a long-lived test runner (vitest) must release the WebSocket pool
 * in teardown or its worker stays alive after the suite finishes. The next `getDb()`
 * transparently re-opens a fresh pool.
 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

export { schema };
