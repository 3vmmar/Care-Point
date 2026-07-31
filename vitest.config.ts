import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const migrationsPath = fileURLToPath(new URL("./drizzle", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: "2026-07-31",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: { DB: "care-point-integration" },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(migrationsPath),
          SEED_APPOINTMENT: "0",
        },
      },
    })),
  ],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    testTimeout: 20_000,
  },
});
