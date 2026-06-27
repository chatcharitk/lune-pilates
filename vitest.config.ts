import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Default suite = the no-DB unit tests. It must stay green WITHOUT a DATABASE_URL,
// so the DB-backed integration tests under tests/integration/** are excluded here
// and run via their own gated config (vitest.integration.config.ts, `npm run
// test:integration`).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/integration/**"],
  },
});
