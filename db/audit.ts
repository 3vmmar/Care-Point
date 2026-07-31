import { env } from "cloudflare:workers";
import { AUDIT_RETENTION_DAYS } from "@/lib/clinic";
import { addDays, clinicToday } from "@/lib/dates";
import { reportError } from "@/lib/observability";

/**
 * Staff access audit trail.
 *
 * The Clinic OS dashboard exposes patient names, phone numbers, emails and
 * clinical notes. Until now nothing recorded who looked at them, which meant
 * that after any incident the honest answer to "whose data was accessed?" was
 * "we have no idea".
 *
 * Design decisions worth knowing:
 *
 * - **Best-effort, but never silent.** A failed audit write does not fail the
 *   request — refusing to show a clinician their own schedule because a log
 *   insert failed would be worse for patients than the missing entry. But every
 *   failure is reported to the error tracker, so a log that has quietly stopped
 *   recording is visible rather than assumed healthy.
 *
 * - **Holds no patient data.** Only the appointment id. The log therefore
 *   survives the PII retention purge without becoming a second, longer-lived
 *   copy of exactly the data the purge exists to remove.
 */

export type AuditAction = "list" | "view" | "update" | "create" | "export" | "erase";

export type AuditEntry = {
  actor: string;
  action: AuditAction;
  subjectId?: string | null;
  subjectCount?: number;
  clientHash?: string | null;
  detail?: string | null;
};

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

let auditReady: Promise<void> | null = null;

export function ensureAuditSchema(): Promise<void> {
  auditReady ??= createSchema().catch((error) => {
    auditReady = null;
    throw error;
  });
  return auditReady;
}

async function createSchema() {
  const db = database();
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS access_log (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        subject_id TEXT,
        subject_count INTEGER NOT NULL DEFAULT 1,
        client_hash TEXT,
        detail TEXT,
        at TEXT NOT NULL
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS access_log_actor_at ON access_log (actor, at)",
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS access_log_subject ON access_log (subject_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS access_log_at ON access_log (at)"),
  ]);
}

/**
 * Records one access. Never throws.
 *
 * Returns a promise so a caller with an `ExecutionContext` can `waitUntil` it;
 * awaiting is also fine, it is a single indexed insert.
 */
export async function recordAccess(entry: AuditEntry): Promise<void> {
  try {
    await ensureAuditSchema();
    await database()
      .prepare(
        `INSERT INTO access_log
         (id, actor, action, subject_id, subject_count, client_hash, detail, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        entry.actor,
        entry.action,
        entry.subjectId ?? null,
        entry.subjectCount ?? 1,
        entry.clientHash ?? null,
        entry.detail ?? null,
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    // An audit trail that has stopped recording must be loud, not invisible.
    await reportError(error, {
      where: "audit: recordAccess",
      level: "warning",
      extra: { action: entry.action },
    });
  }
}

export type AccessLogRow = {
  id: string;
  actor: string;
  action: string;
  subjectId: string | null;
  subjectCount: number;
  detail: string | null;
  at: string;
};

/** Recent access, newest first. Powers the dashboard's audit view. */
export async function listAccessLog(options: {
  limit?: number;
  actor?: string;
  subjectId?: string;
} = {}) {
  await ensureAuditSchema();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const clauses: string[] = [];
  const bindings: string[] = [];

  if (options.actor) {
    clauses.push("actor = ?");
    bindings.push(options.actor);
  }
  if (options.subjectId) {
    clauses.push("subject_id = ?");
    bindings.push(options.subjectId);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await database()
    .prepare(
      `SELECT id, actor, action, subject_id AS subjectId,
              subject_count AS subjectCount, detail, at
       FROM access_log ${where}
       ORDER BY at DESC LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<AccessLogRow>();

  return result.results ?? [];
}

/**
 * Trims the audit trail.
 *
 * Kept substantially longer than patient contact details — an audit log is only
 * useful if it outlives the incident it is needed to investigate — but not
 * forever, because it identifies staff.
 */
export async function purgeExpiredAuditLog(): Promise<number> {
  await ensureAuditSchema();
  const cutoff = addDays(clinicToday(), -AUDIT_RETENTION_DAYS);
  const result = await database()
    .prepare("DELETE FROM access_log WHERE at < ?")
    .bind(`${cutoff}T00:00:00.000Z`)
    .run();
  return result.meta.changes ?? 0;
}
