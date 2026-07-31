import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Canonical appointment schema. `drizzle-kit generate` turns this into the
 * migrations under `drizzle/`, which the platform applies on deploy.
 *
 * The runtime in `db/bookings.ts` uses D1 prepared statements directly rather
 * than the Drizzle query builder, but mirrors this table exactly — keep the two
 * in step when adding a column.
 */
export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    holdToken: text("hold_token").notNull(),
    /**
     * held → confirmed → checked_in → completed
     *                 ↘ cancelled / no_show
     */
    status: text("status").notNull().default("held"),
    branch: text("branch").notNull(),
    service: text("service").notNull(),
    slotDate: text("slot_date").notNull(),
    slotTime: text("slot_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(45),
    /** Who is consulting. One person cannot be in two rooms at once. */
    practitioner: text("practitioner"),
    patientName: text("patient_name"),
    patientPhone: text("patient_phone"),
    patientEmail: text("patient_email"),
    /** Free-text note the patient adds at booking time. */
    patientNote: text("patient_note"),
    /** Clinic-side note, only ever visible to staff. */
    staffNote: text("staff_note"),
    language: text("language").notNull().default("en"),
    source: text("source").notNull().default("website"),
    /** Truncated hash of IP + user agent, used only to rate-limit holds. */
    clientFingerprint: text("client_fingerprint"),
    consentGivenAt: text("consent_given_at"),
    consentVersion: text("consent_version"),
    /** Unguessable token letting the patient manage their own booking. */
    manageToken: text("manage_token"),
    createdAt: text("created_at").notNull(),
    holdExpiresAt: text("hold_expires_at"),
    confirmedAt: text("confirmed_at"),
    checkedInAt: text("checked_in_at"),
    cancelledAt: text("cancelled_at"),
    /** "patient" or the staff email that performed the change. */
    cancelledBy: text("cancelled_by"),
    statusUpdatedAt: text("status_updated_at"),
    /** Set once the reminder for this visit has gone out, so it sends once. */
    reminderSentAt: text("reminder_sent_at"),
    /** Set when contact details were cleared by the retention job. */
    purgedAt: text("purged_at"),
  },
  (table) => [
    index("appointments_status_date").on(table.status, table.slotDate),
    index("appointments_hold_token").on(table.holdToken),
    index("appointments_manage_token").on(table.manageToken),
    index("appointments_slot_date").on(table.slotDate),
  ],
);

/**
 * The occupancy grid — one row per fifteen-minute cell an appointment covers,
 * turnaround included.
 *
 * This is what makes double-booking impossible now that appointments vary in
 * length. A unique start time was sufficient when every consultation was 45
 * minutes; it is not, once a 16:00 sixty-minute booking and a 16:30
 * thirty-minute booking can coexist without sharing a start time. Both claim
 * the 16:30 cell, and the composite primary key rejects the second.
 *
 * Rows are written inside the same `batch()` as the appointment, which D1 runs
 * as a transaction — so a losing racer rolls back entirely rather than leaving
 * an appointment with no reserved time.
 *
 * Cancelled appointments have their cells deleted, which is how a slot returns
 * to the calendar.
 */
export const appointmentCells = sqliteTable(
  "appointment_cells",
  {
    branch: text("branch").notNull(),
    /** Keyed here too: two practitioners share an address, not a room. */
    practitioner: text("practitioner").notNull(),
    slotDate: text("slot_date").notNull(),
    /** Grid cell start, `HH:mm`, always on a 15-minute boundary. */
    cellTime: text("cell_time").notNull(),
    appointmentId: text("appointment_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.branch, table.practitioner, table.slotDate, table.cellTime],
    }),
    index("appointment_cells_appointment").on(table.appointmentId),
  ],
);

/**
 * Staff access to patient records.
 *
 * The dashboard shows names, phone numbers and clinical notes. Without a record
 * of who looked at what, the clinic cannot answer the two questions that matter
 * after an incident — "was this patient's data accessed?" and "by whom?" — and
 * Egypt's PDPL expects a controller to be able to answer both.
 *
 * Deliberately holds no patient data itself: only the appointment id, so the
 * log survives the PII retention purge without becoming a second copy of the
 * thing being protected.
 */
export const accessLog = sqliteTable(
  "access_log",
  {
    id: text("id").primaryKey(),
    /** Staff email from the verified identity header. */
    actor: text("actor").notNull(),
    /** "list" | "view" | "update" | "create" | "export" | "erase" */
    action: text("action").notNull(),
    /** Appointment id for single-record actions; null for a list. */
    subjectId: text("subject_id"),
    /** How many records the action touched, for list and export. */
    subjectCount: integer("subject_count").notNull().default(1),
    /** Truncated hash of the caller IP — enough to spot an anomaly, not to track. */
    clientHash: text("client_hash"),
    detail: text("detail"),
    at: text("at").notNull(),
  },
  (table) => [
    index("access_log_actor_at").on(table.actor, table.at),
    index("access_log_subject").on(table.subjectId),
    index("access_log_at").on(table.at),
  ],
);

/**
 * Data-subject requests (PDPL access / correction / erasure).
 *
 * Deliberately a *queue*, not an action. A request submitted through the
 * website creates a pending row and nothing else — it never erases or exports
 * anything on its own. Self-service erasure keyed on a phone number would let
 * anyone who knows a patient's number destroy their appointment history, or
 * pull a copy of it; identity has to be established by the clinic out of band
 * before staff fulfil the request.
 */
export const dataRequests = sqliteTable(
  "data_requests",
  {
    id: text("id").primaryKey(),
    /** "access" | "erase" | "correct" */
    kind: text("kind").notNull(),
    /** "pending" | "fulfilled" | "rejected" */
    status: text("status").notNull().default("pending"),
    /** Contact details as supplied, used to locate the records. */
    requesterName: text("requester_name").notNull(),
    requesterPhone: text("requester_phone").notNull(),
    requesterEmail: text("requester_email"),
    note: text("note"),
    language: text("language").notNull().default("en"),
    clientHash: text("client_hash"),
    createdAt: text("created_at").notNull(),
    /** Staff email that actioned it, and what they recorded. */
    resolvedBy: text("resolved_by"),
    resolvedAt: text("resolved_at"),
    resolution: text("resolution"),
    /** How many appointment rows the fulfilment touched. */
    affectedCount: integer("affected_count"),
  },
  (table) => [
    index("data_requests_status").on(table.status, table.createdAt),
    index("data_requests_phone").on(table.requesterPhone),
  ],
);
