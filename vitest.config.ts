import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * The integration suite still runs inside the Workers pool, because every
 * `db/*.ts` module imports `cloudflare:workers` and cannot be loaded outside it.
 * What changed is what it talks to: the Neon driver reaches Postgres over HTTPS,
 * which is ordinary `fetch`, so no binding is needed — only a connection string.
 *
 * These tests therefore need a REAL Postgres. Point `DATABASE_URL` at a scratch
 * database or a Neon branch, never at production: the suite truncates every
 * table between test files.
 *
 *   npm run db:migrate      # once, to create the schema
 *   npm run test:integration
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "";

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
        bindings: {
          DATABASE_URL,
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
