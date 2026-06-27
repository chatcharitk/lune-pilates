// Setup for the integration suite: load .env into process.env so DATABASE_URL is
// available the same way the app and the verify scripts expect it, WITHOUT adding a
// dotenv dependency. `process.loadEnvFile()` does not override variables already set
// in the shell, so an explicit `DATABASE_URL=… npm run test:integration` still wins.
//
// Guarded: if there is no .env (e.g. CI without one and no shell var either), the
// specs simply skip themselves (describe.skipIf(!process.env.DATABASE_URL)).

try {
  process.loadEnvFile();
} catch {
  // No .env on disk — rely on the shell environment (or skip if DATABASE_URL unset).
}
