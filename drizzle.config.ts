import { defineConfig } from "drizzle-kit";

/**
 * Postgres, not SQLite. The migration off Cloudflare D1 is recorded in
 * `docs/ADR-001-postgres.md`; the D1-era migrations are archived under
 * `docs/archive/drizzle-d1-sqlite/` and are not applied by anything.
 *
 * `DATABASE_URL` is only needed by the commands that talk to a database
 * (`push`, `migrate`, `studio`). `generate` reads the schema alone, which is why
 * CI can run the migration-drift check without a database.
 */
export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
