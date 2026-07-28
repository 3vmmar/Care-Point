import { env } from "cloudflare:workers";
import {
  CONSENT_VERSION,
  DEFAULT_APPOINTMENT_MINUTES,
  HOLD_DURATION_MINUTES,
} from "@/lib/clinic";
import { clinicToday, type DateKey } from "@/lib/dates";

export type BookingInput = {
  holdToken: string;
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  language?: "en" | "ar";
};

export type ConfirmedAppointment = {
  id: string;
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  language: string;
  confirmedAt: string | null;
};

const CONFIRMED_COLUMNS = `id, branch, service, slot_date AS slotDate, slot_time AS slotTime,
        patient_name AS patientName, patient_phone AS patientPhone,
        patient_email AS patientEmail, language, confirmed_at AS confirmedAt`;

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

/**
 * Schema setup is idempotent but not free — it used to run on every request,
 * costing several D1 round-trips before any real query. It is memoised for the
 * lifetime of the isolate instead, and the promise (not a boolean) is cached so
 * concurrent requests during a cold start all await the same work.
 */
let schemaReady: Promise<void> | null = null;

export function ensureBookingSchema(): Promise<void> {
  schemaReady ??= createSchema().catch((error) => {
    // Never cache a failure, or the isolate would stay broken until it recycles.
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

async function createSchema() {
  const db = database();
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        hold_token TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'held',
        branch TEXT NOT NULL,
        service TEXT NOT NULL,
        slot_date TEXT NOT NULL,
        slot_time TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT ${DEFAULT_APPOINTMENT_MINUTES},
        patient_name TEXT,
        patient_phone TEXT,
        patient_email TEXT,
        language TEXT NOT NULL DEFAULT 'en',
        source TEXT NOT NULL DEFAULT 'website',
        client_fingerprint TEXT,
        consent_given_at TEXT,
        consent_version TEXT,
        created_at TEXT NOT NULL,
        hold_expires_at TEXT,
        confirmed_at TEXT
      )
    `),
    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_unique
      ON appointments (branch, slot_date, slot_time)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS appointments_status_date
      ON appointments (status, slot_date)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS appointments_hold_token
      ON appointments (hold_token)
    `),
  ]);

  // Databases created before these columns existed are upgraded in place;
  // SQLite has no ADD COLUMN IF NOT EXISTS, so a duplicate is the success case.
  for (const column of [
    "client_fingerprint TEXT",
    "consent_given_at TEXT",
    "consent_version TEXT",
  ]) {
    try {
      await db.prepare(`ALTER TABLE appointments ADD COLUMN ${column}`).run();
    } catch (error) {
      if (!/duplicate column/i.test(String(error))) throw error;
    }
  }
}

export async function releaseExpiredHolds() {
  await database()
    .prepare("DELETE FROM appointments WHERE status = 'held' AND hold_expires_at < ?")
    .bind(new Date().toISOString())
    .run();
}

export async function getUnavailableSlots(branch: string, dates: DateKey[]) {
  await ensureBookingSchema();
  if (dates.length === 0) return new Set<string>();
  await releaseExpiredHolds();

  const placeholders = dates.map(() => "?").join(", ");
  const result = await database()
    .prepare(
      `SELECT slot_date, slot_time FROM appointments
       WHERE branch = ? AND slot_date IN (${placeholders})
       AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at >= ?))`,
    )
    .bind(branch, ...dates, new Date().toISOString())
    .all<{ slot_date: string; slot_time: string }>();

  return new Set(
    (result.results ?? []).map((row) => `${row.slot_date}|${row.slot_time}`),
  );
}

/** Live holds attributed to one visitor, used to rate-limit the hold endpoint. */
export async function countActiveHoldsForClient(fingerprint: string) {
  await ensureBookingSchema();
  const row = await database()
    .prepare(
      `SELECT COUNT(*) AS total FROM appointments
       WHERE status = 'held' AND client_fingerprint = ? AND hold_expires_at >= ?`,
    )
    .bind(fingerprint, new Date().toISOString())
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function holdAppointment(input: {
  branch: string;
  service: string;
  slotDate: DateKey;
  slotTime: string;
  fingerprint: string;
}) {
  await ensureBookingSchema();
  await releaseExpiredHolds();
  const id = crypto.randomUUID();
  const holdToken = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + HOLD_DURATION_MINUTES * 60 * 1000,
  ).toISOString();

  await database()
    .prepare(
      `INSERT INTO appointments
       (id, hold_token, status, branch, service, slot_date, slot_time,
        duration_minutes, language, source, client_fingerprint, created_at, hold_expires_at)
       VALUES (?, ?, 'held', ?, ?, ?, ?, ?, 'en', 'website', ?, ?, ?)`,
    )
    .bind(
      id,
      holdToken,
      input.branch,
      input.service,
      input.slotDate,
      input.slotTime,
      DEFAULT_APPOINTMENT_MINUTES,
      input.fingerprint,
      now.toISOString(),
      expiresAt,
    )
    .run();

  return { id, holdToken, expiresAt };
}

export async function confirmAppointment(input: BookingInput) {
  await ensureBookingSchema();
  const now = new Date().toISOString();

  // Conditional UPDATE rather than read-then-write: the `status = 'held'` and
  // expiry predicates make claiming a hold atomic, so a hold that expired (or
  // was already confirmed) mid-form affects zero rows instead of overwriting.
  const result = await database()
    .prepare(
      `UPDATE appointments
       SET status = 'confirmed', patient_name = ?, patient_phone = ?,
           patient_email = ?, language = ?, confirmed_at = ?,
           consent_given_at = ?, consent_version = ?, hold_expires_at = NULL
       WHERE hold_token = ? AND status = 'held' AND hold_expires_at >= ?`,
    )
    .bind(
      input.patientName.trim(),
      input.patientPhone.trim(),
      input.patientEmail?.trim() || null,
      input.language ?? "en",
      now,
      now,
      CONSENT_VERSION,
      input.holdToken,
      now,
    )
    .run();

  if (!result.meta.changes) return null;

  return database()
    .prepare(`SELECT ${CONFIRMED_COLUMNS} FROM appointments WHERE hold_token = ?`)
    .bind(input.holdToken)
    .first<ConfirmedAppointment>();
}

/** Upcoming confirmed appointments. Past visits are excluded from the queue. */
export async function listConfirmedAppointments(limit = 100) {
  await ensureBookingSchema();
  const result = await database()
    .prepare(
      `SELECT ${CONFIRMED_COLUMNS} FROM appointments
       WHERE status = 'confirmed' AND slot_date >= ?
       ORDER BY slot_date ASC, slot_time ASC LIMIT ?`,
    )
    .bind(clinicToday(), limit)
    .all<ConfirmedAppointment>();
  return result.results ?? [];
}

/** Real counts for the clinic dashboard — no estimates, no seeded values. */
export async function getBookingSummary() {
  await ensureBookingSchema();
  const today = clinicToday();
  const row = await database()
    .prepare(
      `SELECT
         COUNT(*) AS upcoming,
         SUM(CASE WHEN slot_date = ? THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN confirmed_at >= ? THEN 1 ELSE 0 END) AS confirmedThisWeek
       FROM appointments
       WHERE status = 'confirmed' AND slot_date >= ?`,
    )
    .bind(
      today,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      today,
    )
    .first<{ upcoming: number; today: number; confirmedThisWeek: number }>();

  return {
    upcoming: row?.upcoming ?? 0,
    today: row?.today ?? 0,
    confirmedThisWeek: row?.confirmedThisWeek ?? 0,
  };
}
