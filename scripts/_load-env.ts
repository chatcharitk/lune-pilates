// Load .env into process.env for standalone scripts run via `npm run …` (db:seed,
// db:reset, verify:*). Uses the Node built-in (no dotenv dependency), mirroring
// tests/integration/setup-env.ts. Import this FIRST so DATABASE_URL is set before
// any DB client module evaluates. A var already set in the shell still wins, so
// `DATABASE_URL=… npm run db:seed` overrides .env as expected.
try {
  process.loadEnvFile();
} catch {
  // No .env on disk — rely on the shell environment (the script will throw a clear
  // "DATABASE_URL is not set" if neither is present).
}
