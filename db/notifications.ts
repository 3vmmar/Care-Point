import { env } from "cloudflare:workers";
import {
  channelsForNotification,
  retryDelayMs,
  retryDisposition,
  type NotificationChannel,
  type NotificationKind,
} from "@/lib/notification-policy";

export {
  channelsForNotification,
  retryDelayMs,
  retryDisposition,
} from "@/lib/notification-policy";
export type { NotificationChannel, NotificationKind } from "@/lib/notification-policy";
export type NotificationStatus =
  | "pending"
  | "processing"
  | "retrying"
  | "blocked"
  | "delivered"
  | "skipped"
  | "dead";
export type NotificationSubjectType = "appointment" | "data_request";

export type NotificationJob = {
  id: string;
  dedupeKey: string;
  kind: NotificationKind;
  subjectType: NotificationSubjectType;
  subjectId: string;
  channel: NotificationChannel;
  contextJson: string | null;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  provider: string | null;
  providerMessageId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
};

export type AppointmentNotificationSubject = {
  id: string;
  branch: string;
  service: string;
  practitioner: string | null;
  slotDate: string;
  slotTime: string;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  patientNote: string | null;
  language: string;
  manageToken: string | null;
};

export type DataRequestNotificationSubject = {
  id: string;
  kind: string;
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string | null;
  note: string | null;
  language: string;
  createdAt: string;
};

const JOB_COLUMNS = `id, dedupe_key AS dedupeKey, kind,
  subject_type AS subjectType, subject_id AS subjectId, channel,
  context_json AS contextJson, status, attempts, max_attempts AS maxAttempts,
  next_attempt_at AS nextAttemptAt, locked_at AS lockedAt, locked_by AS lockedBy,
  provider, provider_message_id AS providerMessageId,
  last_error_code AS lastErrorCode, last_error_message AS lastErrorMessage,
  created_at AS createdAt, updated_at AS updatedAt, delivered_at AS deliveredAt`;

const MAX_ATTEMPTS = 6;
const LOCK_TIMEOUT_MS = 5 * 60_000;

function database() {
  if (!env.DB) throw new Error("The notification database is not available.");
  return env.DB;
}

function iso(date = new Date()) {
  return date.toISOString();
}

let schemaReady: Promise<void> | null = null;

export function ensureNotificationSchema(): Promise<void> {
  schemaReady ??= createSchema().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

async function createSchema() {
  const db = database();
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS notification_jobs (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        context_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT ${MAX_ATTEMPTS},
        next_attempt_at TEXT NOT NULL,
        locked_at TEXT,
        locked_by TEXT,
        provider TEXT,
        provider_message_id TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS notification_attempts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL
          REFERENCES notification_jobs(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        provider TEXT,
        status_code INTEGER,
        error_code TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS notification_jobs_due ON notification_jobs (status, next_attempt_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS notification_jobs_subject ON notification_jobs (subject_type, subject_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS notification_jobs_created ON notification_jobs (created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS notification_attempts_job ON notification_attempts (job_id, attempt_number)",
    ),
  ]);
}

export function notificationJobStatements(
  db: D1Database,
  input: {
    kind: NotificationKind;
    subjectType: NotificationSubjectType;
    subjectId: string;
    eventKey: string;
    context?: Record<string, string | number | boolean | null>;
    createdAt: string;
    /** Appointment writes use this to ensure jobs exist only if that write won. */
    expectedStatusUpdatedAt?: string;
    requiredStatus?: string;
  },
): D1PreparedStatement[] {
  const contextJson = input.context ? JSON.stringify(input.context) : null;
  return channelsForNotification(input.kind).map((channel) => {
    const values = [
      crypto.randomUUID(),
      `${input.eventKey}:${channel}`,
      input.kind,
      input.subjectType,
      input.subjectId,
      channel,
      contextJson,
      input.createdAt,
      input.createdAt,
      input.createdAt,
    ];

    if (input.subjectType === "appointment") {
      const condition = input.expectedStatusUpdatedAt
        ? "id = ? AND status_updated_at = ?"
        : input.requiredStatus
          ? "id = ? AND status = ?"
          : "id = ? AND status <> 'held'";
      return db
        .prepare(
          `INSERT OR IGNORE INTO notification_jobs
           (id, dedupe_key, kind, subject_type, subject_id, channel,
            context_json, status, attempts, max_attempts, next_attempt_at,
            created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ${MAX_ATTEMPTS}, ?, ?, ?
           FROM appointments WHERE ${condition}`,
        )
        .bind(
          ...values,
          input.subjectId,
          ...(input.expectedStatusUpdatedAt
            ? [input.expectedStatusUpdatedAt]
            : input.requiredStatus
              ? [input.requiredStatus]
              : []),
        );
    }

    return db
      .prepare(
        `INSERT OR IGNORE INTO notification_jobs
         (id, dedupe_key, kind, subject_type, subject_id, channel,
          context_json, status, attempts, max_attempts, next_attempt_at,
          created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ${MAX_ATTEMPTS}, ?, ?, ?
         FROM data_requests WHERE id = ?`,
      )
      .bind(...values, input.subjectId);
  });
}

export async function queueReminder(input: {
  appointmentId: string;
  slotDate: string;
  slotTime: string;
  branch: string;
  service: string;
}) {
  await ensureNotificationSchema();
  const db = database();
  const timestamp = iso();
  await db.batch([
    ...notificationJobStatements(db, {
      kind: "booking.reminder",
      subjectType: "appointment",
      subjectId: input.appointmentId,
      eventKey: `booking.reminder:${input.appointmentId}:${input.slotDate}`,
      context: {
        slotDate: input.slotDate,
        slotTime: input.slotTime,
        branch: input.branch,
        service: input.service,
      },
      createdAt: timestamp,
      requiredStatus: "confirmed",
    }),
    db
      .prepare(
        `UPDATE appointments SET reminder_queued_at = ?
         WHERE id = ? AND status = 'confirmed' AND reminder_queued_at IS NULL`,
      )
      .bind(timestamp, input.appointmentId),
  ]);
}

export async function claimDueNotificationJobs(limit = 25): Promise<NotificationJob[]> {
  await ensureNotificationSchema();
  const db = database();
  const workerId = crypto.randomUUID();
  const timestamp = iso();
  const stale = iso(new Date(Date.now() - LOCK_TIMEOUT_MS));
  const rows = await db
    .prepare(
      `SELECT ${JOB_COLUMNS} FROM notification_jobs
       WHERE ((status IN ('pending', 'retrying') AND next_attempt_at <= ?)
          OR (status = 'processing' AND locked_at < ?))
       ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?`,
    )
    .bind(timestamp, stale, Math.min(Math.max(limit, 1), 100))
    .all<NotificationJob>();

  const claimed: NotificationJob[] = [];
  for (const job of rows.results ?? []) {
    const result = await db
      .prepare(
        `UPDATE notification_jobs
         SET status = 'processing', locked_at = ?, locked_by = ?, updated_at = ?
         WHERE id = ? AND ((status IN ('pending', 'retrying') AND next_attempt_at <= ?)
           OR (status = 'processing' AND locked_at < ?))`,
      )
      .bind(timestamp, workerId, timestamp, job.id, timestamp, stale)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      claimed.push({ ...job, status: "processing", lockedAt: timestamp, lockedBy: workerId });
    }
  }
  return claimed;
}

export async function loadNotificationSubject(job: NotificationJob) {
  await ensureNotificationSchema();
  const db = database();
  if (job.subjectType === "appointment") {
    return db
      .prepare(
        `SELECT id, branch, service, practitioner,
          slot_date AS slotDate, slot_time AS slotTime,
          patient_name AS patientName, patient_phone AS patientPhone,
          patient_email AS patientEmail, patient_note AS patientNote,
          language, manage_token AS manageToken
         FROM appointments WHERE id = ?`,
      )
      .bind(job.subjectId)
      .first<AppointmentNotificationSubject>();
  }
  return db
    .prepare(
      `SELECT id, kind, requester_name AS requesterName,
        requester_phone AS requesterPhone, requester_email AS requesterEmail,
        note, language, created_at AS createdAt
       FROM data_requests WHERE id = ?`,
    )
    .bind(job.subjectId)
    .first<DataRequestNotificationSubject>();
}

type AttemptResult = {
  outcome: "delivered" | "skipped" | "blocked" | "retrying" | "dead";
  provider?: string | null;
  providerMessageId?: string | null;
  statusCode?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
};

export async function finishNotificationJob(job: NotificationJob, result: AttemptResult) {
  await ensureNotificationSchema();
  const db = database();
  const finishedAt = iso();
  const providerAttempted = result.outcome === "delivered" || result.outcome === "retrying" || result.outcome === "dead";
  const attempts = job.attempts + (providerAttempted ? 1 : 0);
  const status =
    result.outcome === "retrying" || result.outcome === "dead"
      ? retryDisposition({
          attempts,
          maxAttempts: job.maxAttempts,
          retryable: result.retryable ?? result.outcome === "retrying",
        })
      : result.outcome;
  const nextAttemptAt =
    status === "retrying"
      ? iso(new Date(Date.now() + retryDelayMs(attempts)))
      : finishedAt;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO notification_attempts
         (id, job_id, attempt_number, outcome, provider, status_code,
          error_code, error_message, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        job.id,
        providerAttempted ? attempts : job.attempts,
        status,
        result.provider ?? null,
        result.statusCode ?? null,
        result.errorCode ?? null,
        result.errorMessage ?? null,
        job.lockedAt ?? finishedAt,
        finishedAt,
      ),
    db
      .prepare(
        `UPDATE notification_jobs
         SET status = ?, attempts = ?, next_attempt_at = ?, locked_at = NULL,
           locked_by = NULL, provider = ?, provider_message_id = ?,
           last_error_code = ?, last_error_message = ?, updated_at = ?,
           delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END
         WHERE id = ? AND status = 'processing' AND locked_by = ?`,
      )
      .bind(
        status,
        attempts,
        nextAttemptAt,
        result.provider ?? null,
        result.providerMessageId ?? null,
        result.errorCode ?? null,
        result.errorMessage ?? null,
        finishedAt,
        status,
        finishedAt,
        job.id,
        job.lockedBy,
      ),
  ];

  if (
    status === "delivered" &&
    job.kind === "booking.reminder" &&
    (job.channel === "patient_email" || job.channel === "patient_whatsapp")
  ) {
    statements.push(
      db
        .prepare(
          "UPDATE appointments SET reminder_sent_at = COALESCE(reminder_sent_at, ?) WHERE id = ?",
        )
        .bind(finishedAt, job.subjectId),
    );
  }

  await db.batch(statements);
  return status;
}

export async function notificationQueueSummary() {
  await ensureNotificationSchema();
  const since = iso(new Date(Date.now() - 24 * 60 * 60_000));
  const row = await database()
    .prepare(
      `SELECT
        SUM(CASE WHEN status IN ('pending', 'processing', 'retrying') THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS dead,
        SUM(CASE WHEN status = 'delivered' AND delivered_at >= ? THEN 1 ELSE 0 END) AS delivered24h,
        MIN(CASE WHEN status IN ('pending', 'processing', 'retrying', 'blocked') THEN created_at END) AS oldestOpenAt
       FROM notification_jobs`,
    )
    .bind(since)
    .first<{
      queued: number | null;
      blocked: number | null;
      dead: number | null;
      delivered24h: number | null;
      oldestOpenAt: string | null;
    }>();
  return {
    queued: row?.queued ?? 0,
    blocked: row?.blocked ?? 0,
    dead: row?.dead ?? 0,
    delivered24h: row?.delivered24h ?? 0,
    oldestOpenAt: row?.oldestOpenAt ?? null,
  };
}

export async function listNotificationJobs(status?: NotificationStatus, limit = 100) {
  await ensureNotificationSchema();
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const result = status
    ? await database()
        .prepare(
          `SELECT ${JOB_COLUMNS} FROM notification_jobs WHERE status = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(status, safeLimit)
        .all<NotificationJob>()
    : await database()
        .prepare(`SELECT ${JOB_COLUMNS} FROM notification_jobs ORDER BY created_at DESC LIMIT ?`)
        .bind(safeLimit)
        .all<NotificationJob>();
  return result.results ?? [];
}

export async function retryNotificationJob(id: string) {
  await ensureNotificationSchema();
  const timestamp = iso();
  const result = await database()
    .prepare(
      `UPDATE notification_jobs SET status = 'pending', attempts = 0,
       next_attempt_at = ?, locked_at = NULL, locked_by = NULL,
       last_error_code = NULL, last_error_message = NULL, updated_at = ?
       WHERE id = ? AND status IN ('dead', 'blocked', 'retrying')`,
    )
    .bind(timestamp, timestamp, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * A blocked job stays quiet until its channel becomes configured. This avoids
 * writing one futile attempt per job every minute during Meta onboarding while
 * still recovering automatically on the first cron after credentials arrive.
 */
export async function releaseConfiguredNotificationJobs(channels: NotificationChannel[]) {
  if (channels.length === 0) return 0;
  await ensureNotificationSchema();
  const timestamp = iso();
  const placeholders = channels.map(() => "?").join(", ");
  const result = await database()
    .prepare(
      `UPDATE notification_jobs SET status = 'pending', next_attempt_at = ?,
       updated_at = ?, last_error_code = NULL, last_error_message = NULL
       WHERE status = 'blocked' AND channel IN (${placeholders})`,
    )
    .bind(timestamp, timestamp, ...channels)
    .run();
  return result.meta.changes ?? 0;
}

export async function purgeNotificationHistory(retentionDays = 180) {
  await ensureNotificationSchema();
  const db = database();
  const cutoff = iso(new Date(Date.now() - retentionDays * 86_400_000));
  const [, jobs] = await db.batch([
    db
      .prepare(
        `DELETE FROM notification_attempts WHERE job_id IN (
          SELECT id FROM notification_jobs
          WHERE status IN ('delivered', 'skipped', 'dead') AND created_at < ?
        )`,
      )
      .bind(cutoff),
    db
      .prepare(
        `DELETE FROM notification_jobs
         WHERE status IN ('delivered', 'skipped', 'dead') AND created_at < ?`,
      )
      .bind(cutoff),
  ]);
  return jobs.meta.changes ?? 0;
}
