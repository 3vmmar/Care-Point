/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { database } from "@/db/client";

declare global {
  // Cloudflare's generated binding contract is a global namespace by design.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      SEED_APPOINTMENT: string;
    }
  }
}

/**
 * Schema is applied by migrations, not by the suite.
 *
 * The D1 era had `applyD1Migrations`, which built the schema inside the test
 * worker. Postgres has no in-worker equivalent, and inventing one would recreate
 * exactly the problem this migration removed: a second source of truth for DDL
 * that drifts from `drizzle/`. So the suite asserts the schema is there and
 * tells you how to fix it if not.
 */
beforeAll(async () => {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. The integration suite needs a real Postgres — " +
        "point it at a scratch database or a Neon branch, never production.",
    );
  }

  try {
    await database()
      .prepare("SELECT 1 FROM appointments LIMIT 1")
      .all();
  } catch (error) {
    throw new Error(
      "The schema is missing or incomplete. Run `npm run db:migrate` against " +
        `DATABASE_URL first. Underlying error: ${String(error)}`,
    );
  }
});

/**
 * A clean database per test file.
 *
 * Derived from `information_schema` rather than a hand-kept list, so a new table
 * cannot be silently left dirty between tests. `CASCADE` is required now that
 * twenty foreign keys exist — truncating `appointments` alone would be refused
 * by `appointment_cells`.
 */
beforeEach(async () => {
  const db = database();
  const tables = await db
    .prepare(
      `SELECT table_name AS "tableName"
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
         AND table_name <> '__drizzle_migrations'`,
    )
    .all<{ tableName: string }>();

  const names = (tables.results ?? []).map((row) => `"${row.tableName}"`);
  if (names.length === 0) return;

  // One statement: TRUNCATE of several tables is atomic and far cheaper than
  // a DELETE per table over a network round trip each.
  await db
    .prepare(`TRUNCATE TABLE ${names.join(", ")} RESTART IDENTITY CASCADE`)
    .run();
});
