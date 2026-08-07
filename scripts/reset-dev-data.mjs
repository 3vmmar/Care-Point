import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Wipes the operational data out of the LOCAL development database, leaving
 * the clinic's real configuration intact.
 *
 * WHY THIS EXISTS. The dev server and the Playwright suite share one D1 store
 * (.wrangler/state), so every E2E run writes its fixtures into the database
 * the dashboard reads: "HTTP Race Winner", "API Lifecycle Patient",
 * "Accessibility 1786…" and hundreds of friends. None of that is seeded by
 * code — the seed appointment is opt-in and off — but to anyone looking at
 * Clinic OS it is indistinguishable from fake data shipping with the product.
 * Run this to get a clean book; expect it to fill again after `npm run
 * test:e2e`, because the suites genuinely book appointments.
 *
 * WHAT IT KEEPS, deliberately:
 *   - the live catalogue: departments, branches, services, weekly_sessions,
 *     schedule_exceptions, cancellation_reasons — this is the practice's REAL
 *     rota, edited via Clinic OS → Hours; deleting it would revert opening
 *     hours to the seeded constants.
 *   - practitioners referenced by the rota (the test suites create extras
 *     like "Dr. Clash"; those go).
 *
 * WHAT IT WIPES: appointments and their occupancy cells, the notification
 * outbox and attempts, data-subject requests, the access/security audit
 * trails, staff accounts and sessions (dev bypasses auth, so none are needed
 * locally), throttle counters, and all pilot state.
 *
 * Never points at production: it only knows how to find Miniflare's local
 * store, and D1 in production is not a file on this machine.
 *
 *   node --experimental-sqlite scripts/reset-dev-data.mjs
 *   (or: npm run db:reset-dev)
 */

const store = resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

let candidates;
try {
  candidates = readdirSync(store)
    .filter((file) => file.endsWith(".sqlite") && !file.includes("metadata"))
    .map((file) => join(store, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
} catch {
  console.error(`No local D1 store at ${store} — nothing to reset.`);
  process.exit(1);
}
if (candidates.length === 0) {
  console.error("No local D1 database file found — nothing to reset.");
  process.exit(1);
}

const db = new DatabaseSync(candidates[0]);

const wipe = [
  "appointment_cells",
  "appointments",
  "notification_attempts",
  "notification_jobs",
  "data_requests",
  "access_log",
  "security_events",
  "auth_throttle",
  "staff_sessions",
  "staff_recovery_codes",
  "staff_user_roles",
  "staff_users",
  "pilot_incidents",
  "pilot_reviews",
  "pilot_checklist",
  "pilot_settings",
];

const exists = (table) =>
  db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) !== undefined;

db.exec("BEGIN");
try {
  let total = 0;
  for (const table of wipe) {
    if (!exists(table)) continue;
    const { changes } = db.prepare(`DELETE FROM ${table}`).run();
    if (changes > 0) console.log(`  ${table}: ${changes} row(s) removed`);
    total += changes;
  }

  // Practitioners the rota does not reference are test leftovers. Junction
  // rows go with them; the two real clinicians stay because weekly_sessions
  // points at them.
  if (exists("practitioners") && exists("weekly_sessions")) {
    for (const junction of ["practitioner_branches", "service_practitioners"]) {
      if (!exists(junction)) continue;
      const { changes } = db
        .prepare(
          `DELETE FROM ${junction} WHERE practitioner_id NOT IN
             (SELECT DISTINCT practitioner_id FROM weekly_sessions)`,
        )
        .run();
      if (changes > 0) console.log(`  ${junction}: ${changes} orphan link(s) removed`);
    }
    const { changes } = db
      .prepare(
        `DELETE FROM practitioners WHERE id NOT IN
           (SELECT DISTINCT practitioner_id FROM weekly_sessions)`,
      )
      .run();
    if (changes > 0) console.log(`  practitioners: ${changes} test-created clinician(s) removed`);
    total += changes;
  }

  db.exec("COMMIT");
  console.log(`\nDone — ${total} operational row(s) cleared. The catalogue (real hours,`);
  console.log("branches, services) was left untouched. Running the E2E suite will");
  console.log("repopulate test bookings; run this again afterwards for a clean book.");
} catch (error) {
  db.exec("ROLLBACK");
  console.error("Reset failed and was rolled back:", error.message);
  process.exit(1);
} finally {
  db.close();
}
