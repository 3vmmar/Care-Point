import { env } from "cloudflare:workers";

export type BookingInput = {
  holdToken: string;
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  language?: "en" | "ar";
};

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

export async function ensureBookingSchema() {
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
        duration_minutes INTEGER NOT NULL DEFAULT 45,
        patient_name TEXT,
        patient_phone TEXT,
        patient_email TEXT,
        language TEXT NOT NULL DEFAULT 'en',
        source TEXT NOT NULL DEFAULT 'website',
        created_at TEXT NOT NULL,
        hold_expires_at TEXT,
        confirmed_at TEXT
      )
    `),
    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_unique
      ON appointments (branch, slot_date, slot_time)
    `),
  ]);
}

export async function releaseExpiredHolds() {
  await database()
    .prepare(
      "DELETE FROM appointments WHERE status = 'held' AND hold_expires_at < ?",
    )
    .bind(new Date().toISOString())
    .run();
}

export async function getUnavailableSlots(branch: string, dates: string[]) {
  await ensureBookingSchema();
  await releaseExpiredHolds();
  if (dates.length === 0) return new Set<string>();

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
    (result.results ?? []).map(
      (row: { slot_date: string; slot_time: string }) =>
        `${row.slot_date}|${row.slot_time}`,
    ),
  );
}

export async function holdAppointment(input: {
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
}) {
  await ensureBookingSchema();
  await releaseExpiredHolds();
  const id = crypto.randomUUID();
  const holdToken = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  await database()
    .prepare(
      `INSERT INTO appointments
       (id, hold_token, status, branch, service, slot_date, slot_time,
        duration_minutes, language, source, created_at, hold_expires_at)
       VALUES (?, ?, 'held', ?, ?, ?, ?, 45, 'en', 'website-demo', ?, ?)`,
    )
    .bind(
      id,
      holdToken,
      input.branch,
      input.service,
      input.slotDate,
      input.slotTime,
      now.toISOString(),
      expiresAt,
    )
    .run();

  return { id, holdToken, expiresAt };
}

export async function confirmAppointment(input: BookingInput) {
  await ensureBookingSchema();
  await releaseExpiredHolds();
  const now = new Date().toISOString();
  const result = await database()
    .prepare(
      `UPDATE appointments
       SET status = 'confirmed', patient_name = ?, patient_phone = ?,
           patient_email = ?, language = ?, confirmed_at = ?, hold_expires_at = NULL
       WHERE hold_token = ? AND status = 'held' AND hold_expires_at >= ?`,
    )
    .bind(
      input.patientName.trim(),
      input.patientPhone.trim(),
      input.patientEmail?.trim() || null,
      input.language ?? "en",
      now,
      input.holdToken,
      now,
    )
    .run();

  if (!result.meta.changes) return null;
  return database()
    .prepare(
      `SELECT id, branch, service, slot_date AS slotDate, slot_time AS slotTime,
              patient_name AS patientName, patient_phone AS patientPhone,
              patient_email AS patientEmail, confirmed_at AS confirmedAt
       FROM appointments WHERE hold_token = ?`,
    )
    .bind(input.holdToken)
    .first();
}

export async function listConfirmedAppointments() {
  await ensureBookingSchema();
  return database()
    .prepare(
      `SELECT id, branch, service, slot_date AS slotDate, slot_time AS slotTime,
              patient_name AS patientName, patient_phone AS patientPhone,
              patient_email AS patientEmail, confirmed_at AS confirmedAt
       FROM appointments WHERE status = 'confirmed'
       ORDER BY slot_date ASC, slot_time ASC LIMIT 50`,
    )
    .all();
}
