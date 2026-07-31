import { env } from "cloudflare:workers";
import {
  CONSENT_VERSION,
  DEFAULT_APPOINTMENT_MINUTES,
  findBranch,
  HOLD_DURATION_MINUTES,
  PII_RETENTION_DAYS,
  serviceDuration,
} from "@/lib/clinic";
import { generateSlots, occupiedCells } from "@/lib/schedule";
import { addDays, clinicToday, openDayKeys, type DateKey } from "@/lib/dates";
import {
  ensureNotificationSchema,
  notificationJobStatements,
} from "@/db/notifications";

export type AppointmentStatus =
  | "held"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "no_show"
  | "cancelled";

/**
 * Statuses that occupy a slot. `cancelled` is deliberately absent: a cancelled
 * appointment must hand its time back to the calendar.
 */
const OCCUPYING_STATUSES = ["confirmed", "checked_in", "completed", "no_show"] as const;
const OCCUPYING_LIST = OCCUPYING_STATUSES.map((status) => `'${status}'`).join(", ");

/** Status changes staff are allowed to make from the dashboard. */
export const STAFF_STATUS_ACTIONS = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
] as const;

export type StaffStatusAction = (typeof STAFF_STATUS_ACTIONS)[number];

export type BookingInput = {
  holdToken: string;
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  patientNote?: string;
  language?: "en" | "ar";
};

export type Appointment = {
  id: string;
  status: AppointmentStatus;
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  durationMinutes: number;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  patientNote: string | null;
  staffNote: string | null;
  language: string;
  source: string;
  createdAt: string;
  confirmedAt: string | null;
  checkedInAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
};

export type ConfirmedAppointment = Appointment & { manageToken: string | null };

const APPOINTMENT_COLUMNS = `id, status, branch, service,
        slot_date AS slotDate, slot_time AS slotTime,
        duration_minutes AS durationMinutes,
        patient_name AS patientName, patient_phone AS patientPhone,
        patient_email AS patientEmail, patient_note AS patientNote,
        staff_note AS staffNote, language, source,
        created_at AS createdAt, confirmed_at AS confirmedAt,
        checked_in_at AS checkedInAt, cancelled_at AS cancelledAt,
        cancelled_by AS cancelledBy`;

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

function now() {
  return new Date().toISOString();
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
      CREATE INDEX IF NOT EXISTS appointments_status_date
      ON appointments (status, slot_date)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS appointments_hold_token
      ON appointments (hold_token)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS appointments_slot_date
      ON appointments (slot_date)
    `),
  ]);

  // Databases created before these columns existed are upgraded in place;
  // SQLite has no ADD COLUMN IF NOT EXISTS, so a duplicate is the success case.
  for (const column of [
    "client_fingerprint TEXT",
    "consent_given_at TEXT",
    "consent_version TEXT",
    "patient_note TEXT",
    "staff_note TEXT",
    "manage_token TEXT",
    "checked_in_at TEXT",
    "cancelled_at TEXT",
    "cancelled_by TEXT",
    "status_updated_at TEXT",
    "reminder_sent_at TEXT",
    "reminder_queued_at TEXT",
    "purged_at TEXT",
    "practitioner TEXT",
  ]) {
    try {
      await db.prepare(`ALTER TABLE appointments ADD COLUMN ${column}`).run();
    } catch (error) {
      if (!/duplicate column/i.test(String(error))) throw error;
    }
  }

  /**
   * Occupancy grid.
   *
   * Uniqueness on the appointment's own start time was enough while every
   * appointment lasted the same 45 minutes. It is not enough now: a 16:00
   * sixty-minute consultation and a 16:30 thirty-minute one have different
   * start times and occupy the same room, so nothing collided and both were
   * written.
   *
   * Each appointment instead claims one row per fifteen-minute cell it covers,
   * turnaround included. The composite primary key is what makes that
   * impossible, and because the rows go in inside the same `batch()` as the
   * appointment, a losing racer rolls the whole thing back rather than
   * half-booking.
   *
   * Keyed by practitioner as well as branch — the surgeon and the dental team
   * consult at the same address at the same time, in different rooms.
   */
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS appointment_cells (
        branch TEXT NOT NULL,
        practitioner TEXT NOT NULL,
        slot_date TEXT NOT NULL,
        cell_time TEXT NOT NULL,
        appointment_id TEXT NOT NULL,
        PRIMARY KEY (branch, practitioner, slot_date, cell_time)
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS appointment_cells_appointment
      ON appointment_cells (appointment_id)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS appointments_manage_token
      ON appointments (manage_token)
    `),
  ]);

  // Both older slot indexes are now actively wrong: they key on branch + time
  // without the practitioner, so they would reject the dental team and the
  // surgeon legitimately consulting at the same moment. `appointment_cells`
  // supersedes them and is strictly stronger.
  for (const index of ["appointments_slot_unique", "appointments_slot_live_unique"]) {
    await db.prepare(`DROP INDEX IF EXISTS ${index}`).run().catch(() => undefined);
  }

  await backfillCells(db);
  await seedAppointments(db);
}

/**
 * Gives existing appointments their occupancy rows.
 *
 * Runs once per database: appointments written before the grid existed have no
 * cells, so without this their times would read as free. Cheap and idempotent —
 * `INSERT OR IGNORE` means a second pass does nothing.
 */
async function backfillCells(db: D1Database) {
  try {
    const orphans = await db
      .prepare(
        `SELECT a.id, a.branch, a.practitioner, a.slot_date AS slotDate,
                a.slot_time AS slotTime, a.duration_minutes AS durationMinutes
         FROM appointments a
         LEFT JOIN appointment_cells c ON c.appointment_id = a.id
         WHERE a.status <> 'cancelled' AND c.appointment_id IS NULL
         LIMIT 500`,
      )
      .all<{
        id: string;
        branch: string;
        practitioner: string | null;
        slotDate: string;
        slotTime: string;
        durationMinutes: number;
      }>();

    const rows = orphans.results ?? [];
    if (rows.length === 0) return;

    const statements = rows.flatMap((row) =>
      cellInserts(db, {
        id: row.id,
        branch: row.branch,
        practitioner: row.practitioner,
        slotDate: row.slotDate,
        slotTime: row.slotTime,
        durationMinutes: row.durationMinutes,
      }),
    );
    if (statements.length > 0) await db.batch(statements);
    console.log(`[schema] backfilled occupancy for ${rows.length} appointments`);
  } catch (error) {
    // A backfill failure must not take the whole isolate down; the read path
    // still filters by interval overlap either way.
    console.error("occupancy backfill skipped", error);
  }
}

/**
 * Legacy rows may predate the practitioner column. They still need a stable
 * key, and an empty string would let two of them share a cell.
 */
const UNASSIGNED = "unassigned";

/** The INSERT statements claiming every cell an appointment covers. */
function cellInserts(
  db: D1Database,
  appointment: {
    id: string;
    branch: string;
    practitioner: string | null;
    slotDate: string;
    slotTime: string;
    durationMinutes: number;
  },
): D1PreparedStatement[] {
  const practitioner = appointment.practitioner || UNASSIGNED;
  return occupiedCells(appointment.slotTime, appointment.durationMinutes).map((cell) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO appointment_cells
         (branch, practitioner, slot_date, cell_time, appointment_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(appointment.branch, practitioner, appointment.slotDate, cell, appointment.id),
  );
}

/**
 * The same inserts, but strict.
 *
 * `INSERT OR IGNORE` is right for a backfill, where a pre-existing row means
 * the work is already done. It is exactly wrong when claiming a slot: a
 * conflicting cell must abort the batch so the caller can report a clash
 * instead of silently overwriting someone else's appointment.
 */
function claimCells(
  db: D1Database,
  appointment: {
    id: string;
    branch: string;
    practitioner: string | null;
    slotDate: string;
    slotTime: string;
    durationMinutes: number;
  },
): D1PreparedStatement[] {
  const practitioner = appointment.practitioner || UNASSIGNED;
  return occupiedCells(appointment.slotTime, appointment.durationMinutes).map((cell) =>
    db
      .prepare(
        `INSERT INTO appointment_cells
         (branch, practitioner, slot_date, cell_time, appointment_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(appointment.branch, practitioner, appointment.slotDate, cell, appointment.id),
  );
}

/** Hands an appointment's time back to the calendar. */
function releaseCells(db: D1Database, appointmentId: string): D1PreparedStatement {
  return db
    .prepare("DELETE FROM appointment_cells WHERE appointment_id = ?")
    .bind(appointmentId);
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One real appointment so the dashboard is never an empty shell on a fresh
 * database. Keyed by a fixed id, so re-running bootstrap never duplicates it,
 * and rolled forward when its date passes so the clinic view stays populated.
 * Set SEED_APPOINTMENT="0" to skip it entirely.
 */
const SEED_ID = "a5f1c2d0-0000-4000-8000-000000000001";
const SEED = {
  branch: "Maadi",
  service: "aesthetic",
  patientName: "Ammar Ahmed",
  patientPhone: "01501606307",
  language: "en",
};

async function seedAppointments(db: D1Database) {
  if (process.env.SEED_APPOINTMENT === "0") return;

  try {
    const existing = await db
      .prepare("SELECT id, slot_date AS slotDate, status FROM appointments WHERE id = ?")
      .bind(SEED_ID)
      .first<{ id: string; slotDate: string; status: string }>();

    const today = clinicToday();
    if (existing) {
      // Leave a cancelled or still-upcoming seed alone; only roll forward one
      // that has fallen into the past.
      if (existing.status === "cancelled" || existing.slotDate >= today) return;
      const rolled = await firstFreeSeedSlot(db, today);
      if (!rolled) return;
      await db
        .prepare(
          `UPDATE appointments SET slot_date = ?, slot_time = ?, practitioner = ?,
           status = 'confirmed', status_updated_at = ? WHERE id = ?`,
        )
        .bind(rolled.date, rolled.time, rolled.practitioner, now(), SEED_ID)
        .run();
      return;
    }

    const target = await firstFreeSeedSlot(db, today);
    if (!target) return;
    const timestamp = now();
    await db
      .prepare(
        `INSERT INTO appointments
         (id, hold_token, status, branch, service, slot_date, slot_time,
          duration_minutes, practitioner, patient_name, patient_phone, language,
          source, consent_given_at, consent_version, manage_token, created_at,
          confirmed_at, status_updated_at)
         VALUES (?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'clinic', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        SEED_ID,
        crypto.randomUUID(),
        SEED.branch,
        SEED.service,
        target.date,
        target.time,
        serviceDuration(SEED.service),
        target.practitioner,
        SEED.patientName,
        SEED.patientPhone,
        SEED.language,
        timestamp,
        CONSENT_VERSION,
        crypto.randomUUID(),
        timestamp,
        timestamp,
        timestamp,
      )
      .run();
  } catch (error) {
    // A seed is a convenience, never a reason to fail a request.
    console.error("appointment seed skipped", error);
  }
}

/**
 * The first upcoming day the seed branch actually runs, with a free slot.
 * Derived from the generated schedule, so it can never place the seed at a time
 * the clinic does not open.
 */
async function firstFreeSeedSlot(
  db: D1Database,
  from: DateKey,
): Promise<{ date: DateKey; time: string; practitioner: string } | null> {
  const branch = findBranch(SEED.branch);
  if (!branch) return null;

  for (const day of openDayKeys(14).filter((candidate) => candidate >= from)) {
    const slots = generateSlots(branch, day, SEED.service);
    if (slots.length === 0) continue;

    const taken = await db
      .prepare(
        `SELECT slot_time AS slotTime FROM appointments
         WHERE branch = ? AND slot_date = ? AND status <> 'cancelled' AND id <> ?`,
      )
      .bind(SEED.branch, day, SEED_ID)
      .all<{ slotTime: string }>();
    const busy = new Set((taken.results ?? []).map((row) => row.slotTime));

    const free = slots.find((slot) => !busy.has(slot.time));
    if (free) return { date: day, time: free.time, practitioner: free.practitioner };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Maintenance (scheduled, not on the request path)                            */
/* -------------------------------------------------------------------------- */

/**
 * Clears holds nobody completed. Availability reads already ignore expired
 * holds, so this is housekeeping rather than correctness — which is exactly why
 * it belongs on a cron trigger instead of firing a DELETE on every page view.
 */
export async function releaseExpiredHolds(): Promise<number> {
  await ensureBookingSchema();
  const db = database();
  const timestamp = now();

  // Cells first: deleting the appointments would orphan them and leave the
  // times permanently unbookable.
  const [, appointments] = await db.batch([
    db.prepare(
      `DELETE FROM appointment_cells WHERE appointment_id IN (
         SELECT id FROM appointments WHERE status = 'held' AND hold_expires_at < ?)`,
    ).bind(timestamp),
    db
      .prepare("DELETE FROM appointments WHERE status = 'held' AND hold_expires_at < ?")
      .bind(timestamp),
  ]);
  return appointments.meta.changes ?? 0;
}

/**
 * Retention: strips patient contact details from visits older than the
 * retention window while keeping the anonymous row for reporting.
 */
export async function purgeExpiredContactDetails(): Promise<number> {
  await ensureBookingSchema();
  const cutoff = addDays(clinicToday(), -PII_RETENTION_DAYS);
  const result = await database()
    .prepare(
      `UPDATE appointments
       SET patient_name = NULL, patient_phone = NULL, patient_email = NULL,
           patient_note = NULL, staff_note = NULL, manage_token = NULL,
           client_fingerprint = NULL, purged_at = ?
       WHERE slot_date < ? AND purged_at IS NULL
         AND (patient_name IS NOT NULL OR patient_phone IS NOT NULL)`,
    )
    .bind(now(), cutoff)
    .run();
  return result.meta.changes ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Availability & holds                                                        */
/* -------------------------------------------------------------------------- */

export type BookedInterval = {
  slotDate: string;
  slotTime: string;
  durationMinutes: number;
  practitioner: string | null;
};

/**
 * Live appointments in a date range, with their length.
 *
 * Returns intervals rather than a set of taken times because appointments no
 * longer all last the same amount of time: a 16:00 sixty-minute consultation
 * blocks 16:30 without ever occupying the string "16:30". The caller filters
 * generated slots by overlap.
 */
export async function getBookedIntervals(
  branch: string,
  dates: DateKey[],
): Promise<BookedInterval[]> {
  await ensureBookingSchema();
  if (dates.length === 0) return [];

  const placeholders = dates.map(() => "?").join(", ");
  const result = await database()
    .prepare(
      `SELECT slot_date AS slotDate, slot_time AS slotTime,
              duration_minutes AS durationMinutes, practitioner
       FROM appointments
       WHERE branch = ? AND slot_date IN (${placeholders})
       AND (status IN (${OCCUPYING_LIST})
            OR (status = 'held' AND hold_expires_at >= ?))`,
    )
    .bind(branch, ...dates, now())
    .all<BookedInterval>();

  return result.results ?? [];
}

/** Live holds attributed to one visitor, used to rate-limit the hold endpoint. */
export async function countActiveHoldsForClient(fingerprint: string) {
  await ensureBookingSchema();
  const row = await database()
    .prepare(
      `SELECT COUNT(*) AS total FROM appointments
       WHERE status = 'held' AND client_fingerprint = ? AND hold_expires_at >= ?`,
    )
    .bind(fingerprint, now())
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function holdAppointment(input: {
  branch: string;
  service: string;
  slotDate: DateKey;
  slotTime: string;
  practitioner: string;
  fingerprint: string;
}) {
  await ensureBookingSchema();
  const db = database();
  const id = crypto.randomUUID();
  const holdToken = crypto.randomUUID();
  const timestamp = new Date();
  const iso = timestamp.toISOString();
  const expiresAt = new Date(
    timestamp.getTime() + HOLD_DURATION_MINUTES * 60 * 1000,
  ).toISOString();
  const durationMinutes = serviceDuration(input.service);

  /**
   * One atomic batch: clear anything abandoned, write the hold, claim every
   * cell it covers.
   *
   * D1 runs a batch as a transaction, so a cell already taken by a concurrent
   * booking aborts the whole thing — no appointment row is left behind, and the
   * caller sees a constraint error it can turn into a 409. This is what makes
   * two overlapping bookings of *different lengths* impossible rather than
   * merely unlikely.
   */
  await db.batch([
    // Expired holds are released here as well as by the cron, so the slot the
    // UI just offered is genuinely claimable rather than blocked by a ghost.
    db
      .prepare(
        `DELETE FROM appointment_cells WHERE appointment_id IN (
           SELECT id FROM appointments
           WHERE status = 'held' AND hold_expires_at < ?)`,
      )
      .bind(iso),
    db
      .prepare("DELETE FROM appointments WHERE status = 'held' AND hold_expires_at < ?")
      .bind(iso),
    db
      .prepare(
        `INSERT INTO appointments
         (id, hold_token, status, branch, service, slot_date, slot_time,
          duration_minutes, practitioner, language, source, client_fingerprint,
          created_at, hold_expires_at, status_updated_at)
         VALUES (?, ?, 'held', ?, ?, ?, ?, ?, ?, 'en', 'website', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        holdToken,
        input.branch,
        input.service,
        input.slotDate,
        input.slotTime,
        durationMinutes,
        input.practitioner,
        input.fingerprint,
        iso,
        expiresAt,
        iso,
      ),
    ...claimCells(db, {
      id,
      branch: input.branch,
      practitioner: input.practitioner,
      slotDate: input.slotDate,
      slotTime: input.slotTime,
      durationMinutes,
    }),
  ]);

  return { id, holdToken, expiresAt };
}

export async function confirmAppointment(
  input: BookingInput,
): Promise<ConfirmedAppointment | null> {
  await ensureBookingSchema();
  await ensureNotificationSchema();
  const db = database();
  const timestamp = now();
  const manageToken = crypto.randomUUID();

  const candidate = await db
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS}, manage_token AS manageToken
       FROM appointments WHERE hold_token = ?`,
    )
    .bind(input.holdToken)
    .first<ConfirmedAppointment>();
  if (!candidate) return null;
  if (candidate.status === "confirmed") return candidate;

  // Conditional UPDATE rather than read-then-write: the `status = 'held'` and
  // expiry predicates make claiming a hold atomic, so a hold that expired (or
  // was already confirmed) mid-form affects zero rows instead of overwriting.
  const [result] = await db.batch([
    db
      .prepare(
        `UPDATE appointments
         SET status = 'confirmed', patient_name = ?, patient_phone = ?,
             patient_email = ?, patient_note = ?, language = ?, confirmed_at = ?,
             consent_given_at = ?, consent_version = ?, manage_token = ?,
             status_updated_at = ?, hold_expires_at = NULL
         WHERE id = ? AND hold_token = ? AND status = 'held' AND hold_expires_at >= ?`,
      )
      .bind(
        input.patientName.trim(),
        input.patientPhone.trim(),
        input.patientEmail?.trim() || null,
        input.patientNote?.trim() || null,
        input.language ?? "en",
        timestamp,
        timestamp,
        CONSENT_VERSION,
        manageToken,
        timestamp,
        candidate.id,
        input.holdToken,
        timestamp,
      ),
    ...notificationJobStatements(db, {
      kind: "booking.confirmed",
      subjectType: "appointment",
      subjectId: candidate.id,
      eventKey: `booking.confirmed:${candidate.id}:${timestamp}`,
      context: {
        branch: candidate.branch,
        service: candidate.service,
        slotDate: candidate.slotDate,
        slotTime: candidate.slotTime,
      },
      createdAt: timestamp,
      expectedStatusUpdatedAt: timestamp,
    }),
  ]);

  if (!result.meta.changes) {
    /**
     * Zero rows changed has two very different causes, and treating them the
     * same produced a real bug: a patient who double-tapped Confirm on a slow
     * connection was told their held time had expired, moments after it had in
     * fact been booked. They would then book a second appointment, or give up.
     *
     * The hold token is a natural idempotency key — it is single-use, unguessable
     * and already in the request — so a repeat of a confirmation that already
     * succeeded returns the same booking rather than an error. Only a hold that
     * genuinely no longer exists returns null.
     */
    const existing = await db
      .prepare(
        `SELECT ${APPOINTMENT_COLUMNS}, manage_token AS manageToken
         FROM appointments WHERE hold_token = ? AND status = 'confirmed'`,
      )
      .bind(input.holdToken)
      .first<ConfirmedAppointment>();
    return existing ?? null;
  }

  return db
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS}, manage_token AS manageToken
       FROM appointments WHERE hold_token = ?`,
    )
    .bind(input.holdToken)
    .first<ConfirmedAppointment>();
}

/* -------------------------------------------------------------------------- */
/* Patient self-service                                                        */
/* -------------------------------------------------------------------------- */

export async function getAppointmentByManageToken(token: string) {
  await ensureBookingSchema();
  if (!token) return null;
  return database()
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS} FROM appointments
       WHERE manage_token = ? AND status <> 'held'`,
    )
    .bind(token)
    .first<Appointment>();
}

export async function cancelByManageToken(token: string) {
  await ensureBookingSchema();
  await ensureNotificationSchema();
  const db = database();
  const timestamp = now();

  const existing = await db
    .prepare(
      `SELECT id, branch, service, slot_date AS slotDate, slot_time AS slotTime
       FROM appointments WHERE manage_token = ?
         AND status IN ('confirmed', 'checked_in') AND slot_date >= ?`,
    )
    .bind(token, clinicToday())
    .first<{ id: string; branch: string; service: string; slotDate: string; slotTime: string }>();
  if (!existing) return false;

  const [cancelled] = await db.batch([
    db
      .prepare(
        `UPDATE appointments
         SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'patient',
             status_updated_at = ?
         WHERE id = ? AND manage_token = ? AND status IN ('confirmed', 'checked_in')
           AND slot_date >= ?`,
      )
      .bind(timestamp, timestamp, existing.id, token, clinicToday()),
    // A cancelled visit must hand its time straight back to the calendar.
    db
      .prepare(
        `DELETE FROM appointment_cells WHERE appointment_id IN (
           SELECT id FROM appointments WHERE manage_token = ? AND status = 'cancelled')`,
      )
      .bind(token),
    ...notificationJobStatements(db, {
      kind: "booking.cancelled",
      subjectType: "appointment",
      subjectId: existing.id,
      eventKey: `booking.cancelled:${existing.id}:${timestamp}`,
      context: {
        branch: existing.branch,
        service: existing.service,
        slotDate: existing.slotDate,
        slotTime: existing.slotTime,
      },
      createdAt: timestamp,
      expectedStatusUpdatedAt: timestamp,
    }),
  ]);
  return (cancelled.meta.changes ?? 0) > 0;
}

export async function rescheduleByManageToken(input: {
  token: string;
  slotDate: DateKey;
  slotTime: string;
  practitioner?: string;
}) {
  await ensureBookingSchema();
  await ensureNotificationSchema();
  const db = database();
  const timestamp = now();

  const existing = await db
    .prepare(
      `SELECT id, branch, practitioner, duration_minutes AS durationMinutes
       FROM appointments
       WHERE manage_token = ? AND status = 'confirmed' AND slot_date >= ?`,
    )
    .bind(input.token, clinicToday())
    .first<{
      id: string;
      branch: string;
      practitioner: string | null;
      durationMinutes: number;
    }>();
  if (!existing) return null;

  const practitioner = input.practitioner ?? existing.practitioner;

  // Release the old time and claim the new one together, so a clash on the new
  // slot leaves the original booking untouched rather than destroying it.
  await db.batch([
    releaseCells(db, existing.id),
    db
      .prepare(
        `UPDATE appointments
         SET slot_date = ?, slot_time = ?, practitioner = ?, status_updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.slotDate, input.slotTime, practitioner, timestamp, existing.id),
    ...claimCells(db, {
      id: existing.id,
      branch: existing.branch,
      practitioner,
      slotDate: input.slotDate,
      slotTime: input.slotTime,
      durationMinutes: existing.durationMinutes,
    }),
    ...notificationJobStatements(db, {
      kind: "booking.rescheduled",
      subjectType: "appointment",
      subjectId: existing.id,
      eventKey: `booking.rescheduled:${existing.id}:${timestamp}`,
      context: {
        branch: existing.branch,
        slotDate: input.slotDate,
        slotTime: input.slotTime,
      },
      createdAt: timestamp,
      expectedStatusUpdatedAt: timestamp,
    }),
  ]);

  return db
    .prepare(`SELECT ${APPOINTMENT_COLUMNS} FROM appointments WHERE id = ?`)
    .bind(existing.id)
    .first<Appointment>();
}

/* -------------------------------------------------------------------------- */
/* Clinic OS                                                                   */
/* -------------------------------------------------------------------------- */

export type AppointmentQuery = {
  /** Inclusive clinic-local day bounds. Defaults to today onwards. */
  from?: DateKey;
  to?: DateKey;
  branch?: string;
  status?: AppointmentStatus | "active";
  limit?: number;
  offset?: number;
};

export async function listAppointments(query: AppointmentQuery = {}) {
  await ensureBookingSchema();
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);

  const clauses = ["status <> 'held'"];
  const bindings: (string | number)[] = [];

  clauses.push("slot_date >= ?");
  bindings.push(query.from ?? clinicToday());

  if (query.to) {
    clauses.push("slot_date <= ?");
    bindings.push(query.to);
  }
  if (query.branch) {
    clauses.push("branch = ?");
    bindings.push(query.branch);
  }
  if (query.status === "active") {
    clauses.push("status IN ('confirmed', 'checked_in')");
  } else if (query.status) {
    clauses.push("status = ?");
    bindings.push(query.status);
  }

  const where = clauses.join(" AND ");
  const [rows, count] = await Promise.all([
    database()
      .prepare(
        `SELECT ${APPOINTMENT_COLUMNS} FROM appointments
         WHERE ${where}
         ORDER BY slot_date ASC, slot_time ASC LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, limit, offset)
      .all<Appointment>(),
    database()
      .prepare(`SELECT COUNT(*) AS total FROM appointments WHERE ${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
  ]);

  return {
    appointments: rows.results ?? [],
    total: count?.total ?? 0,
    limit,
    offset,
  };
}

export type DashboardSummary = {
  today: number;
  todayRemaining: number;
  upcoming: number;
  next7Days: number;
  bookedLast7Days: number;
  cancelledLast30Days: number;
  noShowLast30Days: number;
  completedLast30Days: number;
  noShowRate: number;
  byBranch: Array<{ branch: string; total: number }>;
  byService: Array<{ service: string; total: number }>;
  byDay: Array<{ date: string; total: number }>;
  newestBookingAt: string | null;
};

/** Real counts for the clinic dashboard — no estimates, no seeded values. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  await ensureBookingSchema();
  const db = database();
  const today = clinicToday();
  const weekAhead = addDays(today, 7);
  const weekAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const monthAgo = addDays(today, -30);

  const [totals, lifecycle, branchRows, serviceRows, dayRows] = await Promise.all([
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN slot_date = ? THEN 1 ELSE 0 END) AS today,
           SUM(CASE WHEN slot_date >= ? THEN 1 ELSE 0 END) AS upcoming,
           SUM(CASE WHEN slot_date >= ? AND slot_date <= ? THEN 1 ELSE 0 END) AS next7Days,
           SUM(CASE WHEN confirmed_at >= ? THEN 1 ELSE 0 END) AS bookedLast7Days,
           MAX(confirmed_at) AS newestBookingAt
         FROM appointments
         WHERE status IN ('confirmed', 'checked_in', 'completed')`,
      )
      .bind(today, today, today, weekAhead, weekAgoIso)
      .first<{
        today: number | null;
        upcoming: number | null;
        next7Days: number | null;
        bookedLast7Days: number | null;
        newestBookingAt: string | null;
      }>(),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
           SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS noShow,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
         FROM appointments
         WHERE slot_date >= ? AND slot_date <= ? AND status <> 'held'`,
      )
      .bind(monthAgo, today)
      .first<{ cancelled: number | null; noShow: number | null; completed: number | null }>(),
    db
      .prepare(
        `SELECT branch, COUNT(*) AS total FROM appointments
         WHERE status IN ('confirmed', 'checked_in') AND slot_date >= ?
         GROUP BY branch ORDER BY total DESC`,
      )
      .bind(today)
      .all<{ branch: string; total: number }>(),
    db
      .prepare(
        `SELECT service, COUNT(*) AS total FROM appointments
         WHERE status IN ('confirmed', 'checked_in', 'completed') AND slot_date >= ?
         GROUP BY service ORDER BY total DESC`,
      )
      .bind(monthAgo)
      .all<{ service: string; total: number }>(),
    db
      .prepare(
        `SELECT slot_date AS date, COUNT(*) AS total FROM appointments
         WHERE status IN ('confirmed', 'checked_in') AND slot_date >= ? AND slot_date <= ?
         GROUP BY slot_date ORDER BY slot_date ASC`,
      )
      .bind(today, addDays(today, 13))
      .all<{ date: string; total: number }>(),
  ]);

  const completed = lifecycle?.completed ?? 0;
  const noShow = lifecycle?.noShow ?? 0;
  const attended = completed + noShow;

  return {
    today: totals?.today ?? 0,
    // Filled in by the caller, which knows the current clinic time.
    todayRemaining: 0,
    upcoming: totals?.upcoming ?? 0,
    next7Days: totals?.next7Days ?? 0,
    bookedLast7Days: totals?.bookedLast7Days ?? 0,
    cancelledLast30Days: lifecycle?.cancelled ?? 0,
    noShowLast30Days: noShow,
    completedLast30Days: completed,
    noShowRate: attended > 0 ? Math.round((noShow / attended) * 100) : 0,
    byBranch: branchRows.results ?? [],
    byService: serviceRows.results ?? [],
    byDay: dayRows.results ?? [],
    newestBookingAt: totals?.newestBookingAt ?? null,
  };
}

export async function getAppointmentById(id: string) {
  await ensureBookingSchema();
  if (!id) return null;
  return database()
    .prepare(`SELECT ${APPOINTMENT_COLUMNS} FROM appointments WHERE id = ?`)
    .bind(id)
    .first<Appointment>();
}

/**
 * Every past visit for one phone number.
 *
 * A surgeon walking into a consultation wants to know in one glance whether
 * this is a first visit or a follow-up, and what was said last time. Matching
 * is on phone rather than name because names are typed inconsistently in two
 * scripts, while the number is the thing patients give reliably.
 */
export async function patientHistory(phone: string, excludeId?: string) {
  await ensureBookingSchema();
  const normalised = normalisePhone(phone);
  if (!normalised) return [];

  const result = await database()
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS} FROM appointments
       WHERE status <> 'held'
         AND REPLACE(REPLACE(REPLACE(REPLACE(patient_phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
         AND id <> ?
       ORDER BY slot_date DESC, slot_time DESC LIMIT 25`,
    )
    // Matched on the last nine digits so 01501606307, +201501606307 and
    // 0150 160 6307 are recognised as the same person.
    .bind(`%${normalised.slice(-9)}`, excludeId ?? "")
    .all<Appointment>();
  return result.results ?? [];
}

function normalisePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/** Booked counts per day for a branch, used to show how full the clinic is. */
export async function dailyLoad(input: {
  from: DateKey;
  to: DateKey;
  branch?: string;
}) {
  await ensureBookingSchema();
  const clauses = ["status IN ('confirmed', 'checked_in', 'completed')", "slot_date >= ?", "slot_date <= ?"];
  const bindings: string[] = [input.from, input.to];
  if (input.branch) {
    clauses.push("branch = ?");
    bindings.push(input.branch);
  }

  const result = await database()
    .prepare(
      `SELECT slot_date AS date, branch, COUNT(*) AS total FROM appointments
       WHERE ${clauses.join(" AND ")}
       GROUP BY slot_date, branch ORDER BY slot_date ASC`,
    )
    .bind(...bindings)
    .all<{ date: string; branch: string; total: number }>();
  return result.results ?? [];
}

export async function updateAppointmentStatus(input: {
  id: string;
  status: StaffStatusAction;
  actor: string;
}) {
  await ensureBookingSchema();
  await ensureNotificationSchema();
  const db = database();
  const timestamp = now();
  const isCancel = input.status === "cancelled";
  const isCheckIn = input.status === "checked_in";

  const existing = await db
    .prepare(
      `SELECT id, branch, service, slot_date AS slotDate, slot_time AS slotTime
       FROM appointments WHERE id = ? AND status <> 'held'`,
    )
    .bind(input.id)
    .first<{ id: string; branch: string; service: string; slotDate: string; slotTime: string }>();
  if (!existing) return null;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE appointments
         SET status = ?,
             status_updated_at = ?,
             checked_in_at = CASE WHEN ? THEN ? ELSE checked_in_at END,
             cancelled_at = CASE WHEN ? THEN ? ELSE cancelled_at END,
             cancelled_by = CASE WHEN ? THEN ? ELSE cancelled_by END
         WHERE id = ? AND status <> 'held' AND status <> ?`,
      )
      .bind(
        input.status,
        timestamp,
        isCheckIn ? 1 : 0,
        timestamp,
        isCancel ? 1 : 0,
        timestamp,
        isCancel ? 1 : 0,
        input.actor,
        input.id,
        input.status,
      ),
  ];

  if (isCancel) {
    statements.push(
      db.prepare("DELETE FROM appointment_cells WHERE appointment_id = ?").bind(input.id),
      ...notificationJobStatements(db, {
        kind: "booking.cancelled",
        subjectType: "appointment",
        subjectId: input.id,
        eventKey: `booking.cancelled:${input.id}:${timestamp}`,
        context: {
          branch: existing.branch,
          service: existing.service,
          slotDate: existing.slotDate,
          slotTime: existing.slotTime,
        },
        createdAt: timestamp,
        expectedStatusUpdatedAt: timestamp,
      }),
    );
  }

  const [result] = await db.batch(statements);

  if (!(result.meta.changes ?? 0)) return null;

  return db
    .prepare(`SELECT ${APPOINTMENT_COLUMNS} FROM appointments WHERE id = ?`)
    .bind(input.id)
    .first<Appointment>();
}

export async function setStaffNote(id: string, note: string) {
  await ensureBookingSchema();
  const result = await database()
    .prepare(
      "UPDATE appointments SET staff_note = ?, status_updated_at = ? WHERE id = ? AND status <> 'held'",
    )
    .bind(note.trim() || null, now(), id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * A booking taken at the desk or over the phone. Same table, different source,
 * so the day view is complete rather than showing only website traffic.
 */
export async function createClinicAppointment(input: {
  branch: string;
  service: string;
  slotDate: DateKey;
  slotTime: string;
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  staffNote?: string;
  language?: "en" | "ar";
  source?: "phone" | "walk_in" | "clinic";
  practitioner?: string;
  actor: string;
}) {
  await ensureBookingSchema();
  await ensureNotificationSchema();
  const db = database();
  const timestamp = now();
  const id = crypto.randomUUID();
  const holdToken = crypto.randomUUID();
  const manageToken = crypto.randomUUID();
  const durationMinutes = serviceDuration(input.service);
  const practitioner = input.practitioner ?? null;

  // Same atomic claim as a patient booking: reception cannot double-book the
  // room either, however fast they type.
  await db.batch([
    db
    .prepare(
      `INSERT INTO appointments
       (id, hold_token, status, branch, service, slot_date, slot_time,
        duration_minutes, practitioner, patient_name, patient_phone, patient_email,
        staff_note, language, source, consent_given_at, consent_version,
        manage_token, created_at, confirmed_at, status_updated_at)
       VALUES (?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      holdToken,
      input.branch,
      input.service,
      input.slotDate,
      input.slotTime,
      durationMinutes,
      practitioner,
      input.patientName.trim(),
      input.patientPhone.trim(),
      input.patientEmail?.trim() || null,
      input.staffNote?.trim() || `Added by ${input.actor}`,
      input.language ?? "en",
      input.source ?? "clinic",
      timestamp,
      CONSENT_VERSION,
      manageToken,
      timestamp,
      timestamp,
      timestamp,
    ),
    ...claimCells(db, {
      id,
      branch: input.branch,
      practitioner,
      slotDate: input.slotDate,
      slotTime: input.slotTime,
      durationMinutes,
    }),
    ...notificationJobStatements(db, {
      kind: "booking.confirmed",
      subjectType: "appointment",
      subjectId: id,
      eventKey: `booking.confirmed:${id}:${timestamp}`,
      context: {
        branch: input.branch,
        service: input.service,
        slotDate: input.slotDate,
        slotTime: input.slotTime,
      },
      createdAt: timestamp,
      expectedStatusUpdatedAt: timestamp,
    }),
  ]);

  return db
    .prepare(`SELECT ${APPOINTMENT_COLUMNS} FROM appointments WHERE id = ?`)
    .bind(id)
    .first<Appointment>();
}

/**
 * Confirmed visits inside the reminder window that have not been told yet.
 *
 * Bounded to tomorrow only. `reminder_queued_at` closes duplicate scheduling;
 * `reminder_sent_at` is written only after a patient channel confirms delivery.
 */
export async function appointmentsNeedingReminder(limit = 200) {
  await ensureBookingSchema();
  const tomorrow = addDays(clinicToday(), 1);
  const result = await database()
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS}, manage_token AS manageToken
       FROM appointments
       WHERE status = 'confirmed' AND reminder_queued_at IS NULL
         AND slot_date = ?
       ORDER BY slot_time ASC LIMIT ?`,
    )
    .bind(tomorrow, limit)
    .all<ConfirmedAppointment>();
  return result.results ?? [];
}

/**
 * A cheap liveness probe for the health endpoint.
 *
 * Deliberately a real query rather than a binding check: a bound-but-broken D1
 * is exactly the failure an uptime monitor exists to catch, and it is invisible
 * to anything that only asks whether `env.DB` is defined.
 */
export async function checkDatabase(): Promise<{ ok: boolean }> {
  try {
    await ensureBookingSchema();
    const row = await database()
      .prepare("SELECT COUNT(*) AS total FROM appointments WHERE slot_date >= ?")
      .bind(clinicToday())
      .first<{ total: number }>();
    return { ok: typeof row?.total === "number" };
  } catch {
    return { ok: false };
  }
}
