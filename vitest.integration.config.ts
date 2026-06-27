import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// DB-backed integration suite — separate from the default `npm test` so the no-DB
// unit run can never be broken by it. Run with:
//
//   npm run test:integration
//
// It REQUIRES a real DATABASE_URL (loaded from .env by the setup file, or taken
// from the shell). When DATABASE_URL is unset the specs skip themselves cleanly
// (describe.skipIf), so the command is safe to run anywhere.
//
// These tests open real transactions against the configured Postgres and create
// uniquely-tagged fixtures they clean up after themselves (mirroring scripts/
// verify-*.ts), so they are safe to point at the shared dev DB. File parallelism is
// off and a generous timeout is set because each assertion is a network round-trip
// to a serverless Postgres and one spec deliberately holds a transaction open.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
