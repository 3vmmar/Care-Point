import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Canonical schema. `drizzle-kit generate` turns this into the migrations under
 * `drizzle/`, which the deploy pipeline applies.
 *
 * This file is the ONLY source of truth for DDL. The `db/*.ts` modules used to
 * additionally issue `CREATE TABLE IF NOT EXISTS` at runtime, which produced a
 * schema that disagreed with this one — most consequentially by creating the
 * hold- and manage-token indexes as non-unique. Those bootstraps are gone; if a
 * table does not exist, the answer is to apply migrations, not to have the
 * request path invent one.
 *
 * ## Type conventions
 *
 * Two kinds of time appear in this schema and they are deliberately different:
 *
 * - **Instants** — when something happened — are `timestamptz`. The database
 *   stores a point in time and the timezone question never arises again.
 * - **Clinic wall-clock** — `slot_date`, `slot_time`, session start and end —
 *   are `date` and `time`. A slot is "17:30 at Maadi", not an instant; it only
 *   becomes one when combined with the branch's timezone. Storing these as
 *   `timestamptz` would silently shift the clinic's day across a DST boundary.
 *
 * The runtime in `db/*.ts` reads rows as strings, so the driver's type parsers
 * normalise `timestamptz` to ISO-8601 and `time` to `HH:mm` — see
 * `db/client.ts`. Change one without the other and comparisons rot quietly.
 *
 * Enumerations are `text` with a `CHECK`, not a native `pgEnum`, so a new value
 * is one migration rather than a type rewrite. Only value sets with an explicit
 * TypeScript union or `VALID_*` array as their authority are constrained;
 * open-ended fields such as `security_events.event` deliberately are not.
 */

/* -------------------------------------------------------------------------- */
/* Booking core                                                               */
/* -------------------------------------------------------------------------- */

export const appointments = pgTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    holdToken: text("hold_token").notNull(),
    /**
     * held → confirmed → checked_in → completed
     *                 ↘ cancelled / no_show
     */
    status: text("status").notNull().default("held"),
    /**
     * Branch and service are stored as id strings and deliberately carry no
     * foreign key. An appointment is a record of what was booked; it must keep
     * saying "Maadi" and "rhinoplasty consultation" even if the catalogue is
     * later reorganised. The forward risk — publishing slots at an address that
     * no longer exists — is closed on `weekly_sessions` instead, where it
     * actually lives.
     */
    branch: text("branch").notNull(),
    service: text("service").notNull(),
    slotDate: date("slot_date").notNull(),
    slotTime: time("slot_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(45),
    /**
     * Who is consulting. One person cannot be in two rooms at once.
     *
     * Constrained, unlike branch and service: this column is half of
     * `appointment_cells`' primary key, so a value that matches no practitioner
     * does not fail — it silently opens a second parallel room at the same
     * address and the occupancy grid stops preventing anything.
     */
    practitioner: text("practitioner").references(() => practitioners.id, {
      onDelete: "restrict",
    }),
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
    consentGivenAt: timestamp("consent_given_at", {
      withTimezone: true,
      mode: "string",
    }),
    consentVersion: text("consent_version"),
    /** Unguessable token letting the patient manage their own booking. */
    manageToken: text("manage_token"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true, mode: "string" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    /** "patient" or the staff email that performed the change. */
    cancelledBy: text("cancelled_by"),
    statusUpdatedAt: timestamp("status_updated_at", {
      withTimezone: true,
      mode: "string",
    }),
    /** Set once the reminder for this visit has gone out, so it sends once. */
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true, mode: "string" }),
    /** Set once a durable reminder job exists; delivery is tracked separately. */
    reminderQueuedAt: timestamp("reminder_queued_at", {
      withTimezone: true,
      mode: "string",
    }),
    /** Set when contact details were cleared by the retention job. */
    purgedAt: timestamp("purged_at", { withTimezone: true, mode: "string" }),
    /**
     * Why the appointment was cancelled, keyed to `cancellation_reasons`.
     *
     * The clinic recorded *that* a cancellation happened and never why, so the
     * one number a practice can actually act on — are people cancelling because
     * the time was wrong, or because they changed their mind about the treatment
     * — did not exist. `RESTRICT` because a reason that has been used is history;
     * retire it with `active = false` rather than deleting it.
     */
    cancellationReason: text("cancellation_reason").references(
      () => cancellationReasons.code,
      { onDelete: "restrict" },
    ),
    /** Free text, only ever entered by staff. Never shown to the patient. */
    cancellationNote: text("cancellation_note"),
  },
  (table) => [
    index("appointments_status_date").on(table.status, table.slotDate),
    /**
     * UNIQUE, not merely indexed. Both tokens are used as single-row lookup
     * keys — the hold token is the confirm-step idempotency key and the manage
     * token authorises a patient's own booking page — so their uniqueness was
     * an invariant the code relied on but only crypto.randomUUID's collision
     * odds guaranteed. Declared, the database enforces it. Postgres treats
     * NULLs as distinct in a unique index, so purged rows (manage_token = NULL)
     * never collide.
     */
    uniqueIndex("appointments_hold_token").on(table.holdToken),
    uniqueIndex("appointments_manage_token").on(table.manageToken),
    index("appointments_slot_date").on(table.slotDate),
    /** Serves the branch-scoped day reads: booked intervals, daily load, and
     *  every dashboard aggregate that filters branch + date. */
    index("appointments_branch_date_status").on(
      table.branch,
      table.slotDate,
      table.status,
    ),
    check(
      "appointments_status_valid",
      sql`${table.status} IN ('held', 'confirmed', 'checked_in', 'completed', 'no_show', 'cancelled')`,
    ),
    check("appointments_language_valid", sql`${table.language} IN ('en', 'ar')`),
    check("appointments_duration_positive", sql`${table.durationMinutes} > 0`),
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
 * Rows are written inside the same transaction as the appointment — so a losing
 * racer rolls back entirely rather than leaving an appointment with no reserved
 * time. On D1 that was `batch()`; on Postgres it is a real transaction, which is
 * the one place this migration strictly strengthens the guarantee.
 *
 * Cancelled appointments have their cells deleted, which is how a slot returns
 * to the calendar.
 */
export const appointmentCells = pgTable(
  "appointment_cells",
  {
    branch: text("branch").notNull(),
    /** Keyed here too: two practitioners share an address, not a room. */
    practitioner: text("practitioner").notNull(),
    slotDate: date("slot_date").notNull(),
    /** Grid cell start, always on a 15-minute boundary. */
    cellTime: time("cell_time").notNull(),
    /**
     * Declared, enforced, cascading. An orphan cell is the worst quiet failure
     * this table can produce — a slot nobody holds but nobody can book.
     *
     * `branch` and `practitioner` deliberately carry no foreign key of their
     * own: they are a projection of the parent appointment, which is already
     * constrained, and this is the hottest write path in the system — several
     * rows per booking.
     */
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.branch, table.practitioner, table.slotDate, table.cellTime],
    }),
    index("appointment_cells_appointment").on(table.appointmentId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Audit and privacy                                                          */
/* -------------------------------------------------------------------------- */

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
export const accessLog = pgTable(
  "access_log",
  {
    id: text("id").primaryKey(),
    /**
     * Staff email. No foreign key: "patient" is a valid actor for self-service
     * actions, so this can never be a strict reference to `staff_users`.
     */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    /**
     * Appointment id for single-record actions; null for a list.
     *
     * No foreign key, and this one is the deliberate exemption that matters
     * most. The log has to answer "was this patient's record accessed?" *after*
     * the retention job has purged the appointment's contact details. A cascade
     * would delete the evidence along with the data it was evidence about.
     */
    subjectId: text("subject_id"),
    /** How many records the action touched, for list and export. */
    subjectCount: integer("subject_count").notNull().default(1),
    /** Truncated hash of the caller IP — enough to spot an anomaly, not to track. */
    clientHash: text("client_hash"),
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("access_log_actor_at").on(table.actor, table.at),
    index("access_log_subject").on(table.subjectId),
    index("access_log_at").on(table.at),
    check(
      "access_log_action_valid",
      sql`${table.action} IN ('list', 'view', 'update', 'create', 'export', 'erase')`,
    ),
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
export const dataRequests = pgTable(
  "data_requests",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    /** Contact details as supplied, used to locate the records. */
    requesterName: text("requester_name").notNull(),
    requesterPhone: text("requester_phone").notNull(),
    requesterEmail: text("requester_email"),
    note: text("note"),
    language: text("language").notNull().default("en"),
    clientHash: text("client_hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    /** Staff email that actioned it, and what they recorded. */
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
    resolution: text("resolution"),
    /** How many appointment rows the fulfilment touched. */
    affectedCount: integer("affected_count"),
  },
  (table) => [
    index("data_requests_status").on(table.status, table.createdAt),
    index("data_requests_phone").on(table.requesterPhone),
    check(
      "data_requests_kind_valid",
      sql`${table.kind} IN ('access', 'erase', 'correct')`,
    ),
    check(
      "data_requests_status_valid",
      sql`${table.status} IN ('pending', 'fulfilled', 'rejected')`,
    ),
    check("data_requests_language_valid", sql`${table.language} IN ('en', 'ar')`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Clinic catalogue and rota                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The operational catalogue lives in the database so the patient site and the
 * separately deployed Clinic OS read the same branches, people, services and
 * hours. Static configuration remains the migration fallback until the clinic
 * has supplied and approved the real production data.
 */
export const departments = pgTable("departments", {
  id: text("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const clinicBranches = pgTable("clinic_branches", {
  id: text("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  addressEn: text("address_en").notNull(),
  addressAr: text("address_ar").notNull(),
  mapUrl: text("map_url"),
  timezone: text("timezone").notNull().default("Africa/Cairo"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const practitioners = pgTable(
  "practitioners",
  {
    id: text("id").primaryKey(),
    /** `RESTRICT`: a department with people in it is not something to delete by accident. */
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    titleEn: text("title_en").notNull(),
    titleAr: text("title_ar").notNull(),
    credentials: text("credentials"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("practitioners_department").on(table.departmentId, table.active)],
);

/**
 * Consultation types. `department_id` doubles as the service *category* the
 * booking form groups by — surgical, non-surgical, dental — which is why
 * departments carry those ids rather than organisational ones.
 */
export const clinicServices = pgTable(
  "clinic_services",
  {
    id: text("id").primaryKey(),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    turnaroundMinutes: integer("turnaround_minutes").notNull().default(10),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("clinic_services_department").on(table.departmentId, table.active),
    check("clinic_services_duration_positive", sql`${table.durationMinutes} > 0`),
    check("clinic_services_turnaround_valid", sql`${table.turnaroundMinutes} >= 0`),
  ],
);

/**
 * Declared, migrated, and currently read by nothing — which practitioner works
 * where is answered by `weekly_sessions`, since a rota entry already names both.
 * Kept rather than dropped because it is the natural home for that fact if the
 * rota ever stops being the only answer. Constrained so it cannot rot while it
 * waits.
 */
export const practitionerBranches = pgTable(
  "practitioner_branches",
  {
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioners.id, { onDelete: "cascade" }),
    branchId: text("branch_id")
      .notNull()
      .references(() => clinicBranches.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.practitionerId, table.branchId] })],
);

/** As above: superseded by `weekly_sessions.categories`, kept and constrained. */
export const servicePractitioners = pgTable(
  "service_practitioners",
  {
    serviceId: text("service_id")
      .notNull()
      .references(() => clinicServices.id, { onDelete: "cascade" }),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioners.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.serviceId, table.practitionerId] })],
);

export const weeklySessions = pgTable(
  "weekly_sessions",
  {
    id: text("id").primaryKey(),
    /**
     * `CASCADE` on both. This is the relation whose absence was a live defect:
     * deleting a branch left its rota behind, and the rota is what publishes
     * bookable slots — so the site went on offering appointments at an address
     * the clinic no longer had.
     */
    branchId: text("branch_id")
      .notNull()
      .references(() => clinicBranches.id, { onDelete: "cascade" }),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioners.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    intervalMinutes: integer("interval_minutes").notNull().default(30),
    /**
     * Comma-separated department ids bookable in this session.
     *
     * Held on the session rather than derived through `service_practitioners`
     * because it is a property of the *sitting*, not of the person: the surgeon's
     * Tuesday evening at Maadi takes surgical and non-surgical work, and a dental
     * appointment must not be bookable into it even though the same practitioner
     * could in principle do one.
     *
     * Still a delimited string in a single column, which no constraint can
     * validate and no index can help. Postgres would model this as `text[]` or a
     * join table; converting it touches every read in the availability engine,
     * so it is deliberately out of scope for this migration and recorded as a
     * known denormalisation.
     */
    categories: text("categories").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("weekly_sessions_branch_day").on(table.branchId, table.weekday, table.active),
    index("weekly_sessions_practitioner_day").on(
      table.practitionerId,
      table.weekday,
      table.active,
    ),
    check("weekly_sessions_weekday_valid", sql`${table.weekday} BETWEEN 0 AND 6`),
    check("weekly_sessions_interval_positive", sql`${table.intervalMinutes} > 0`),
    check("weekly_sessions_time_ordered", sql`${table.endTime} > ${table.startTime}`),
  ],
);

export const scheduleExceptions = pgTable(
  "schedule_exceptions",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id")
      .notNull()
      .references(() => clinicBranches.id, { onDelete: "cascade" }),
    /** Null is meaningful: the exception applies to the whole branch. */
    practitionerId: text("practitioner_id").references(() => practitioners.id, {
      onDelete: "cascade",
    }),
    date: date("date").notNull(),
    /** "closed" removes time; "added" opens an exceptional session. */
    kind: text("kind").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    reason: text("reason"),
    /** Patients see closures on the booking calendar, so the label is bilingual. */
    reasonAr: text("reason_ar"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("schedule_exceptions_branch_date").on(table.branchId, table.date),
    index("schedule_exceptions_practitioner_date").on(table.practitionerId, table.date),
    check("schedule_exceptions_kind_valid", sql`${table.kind} IN ('closed', 'added')`),
  ],
);

/**
 * Why appointments get cancelled.
 *
 * A lookup table rather than free text so the answer can be counted. Free text
 * would give the clinic a thousand ways to write "patient was travelling" and no
 * way to see that travel is why a fifth of its Thursday evenings empty out.
 */
export const cancellationReasons = pgTable(
  "cancellation_reasons",
  {
    code: text("code").primaryKey(),
    labelEn: text("label_en").notNull(),
    labelAr: text("label_ar").notNull(),
    /** Who is offered this reason. */
    audience: text("audience").notNull().default("both"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("cancellation_reasons_audience").on(table.audience, table.active),
    check(
      "cancellation_reasons_audience_valid",
      sql`${table.audience} IN ('patient', 'staff', 'both')`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Staff identity and security                                                */
/* -------------------------------------------------------------------------- */

/**
 * Staff directory, roles and second factor, used by the private deployment.
 *
 * The email is the primary key because identity arrives from the authenticating
 * proxy as an email address and nothing else — there is no local password to key
 * a surrogate id against.
 */
export const staffUsers = pgTable("staff_users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  active: boolean("active").notNull().default(true),
  /**
   * PBKDF2 hash, salt and cost in one field — see `lib/password.ts`.
   *
   * Null for an account that has not claimed a password yet. Identity used to come
   * entirely from a proxy header, which made the practice dependent on a
   * credential it neither issued nor could rotate; this is the clinic owning its
   * own front door.
   */
  passwordHash: text("password_hash"),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true, mode: "string" }),
  /**
   * Set when an owner issues a temporary password. The holder can sign in and do
   * exactly one thing: choose a real one.
   */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /**
   * AES-GCM ciphertext of the TOTP secret, never the secret itself. A TOTP
   * secret is a symmetric key: in the clear, a leaked copy of this table is a
   * permanent second factor for every account, used silently and undetectably.
   */
  totpSecret: text("totp_secret"),
  /** Set when a generated secret has been proved by a code, not merely issued. */
  totpConfirmedAt: timestamp("totp_confirmed_at", {
    withTimezone: true,
    mode: "string",
  }),
  /**
   * Highest time step already accepted. RFC 6238 §5.2 requires one code to be
   * usable once, so a replay inside the same window is refused.
   */
  totpLastCounter: integer("totp_last_counter").notNull().default(0),
  /** Consecutive failures, reset by a success. Drives the lockout below. */
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "string" }),
  /**
   * Bumped by an MFA reset or a deactivation, which invalidates every session
   * already issued to this person. Revocation that leaves live sessions running
   * is not revocation.
   */
  sessionEpoch: integer("session_epoch").notNull().default(1),
  /** Self-reference: who issued this account. `SET NULL` — the record outlives them. */
  invitedBy: text("invited_by").references((): AnyPgColumn => staffUsers.email, {
    onDelete: "set null",
  }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const staffUserRoles = pgTable(
  "staff_user_roles",
  {
    /** `CASCADE`: a role grant that outlives its account is a permission with no holder. */
    email: text("email")
      .notNull()
      .references(() => staffUsers.email, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.email, table.role] }),
    check(
      "staff_user_roles_role_valid",
      sql`${table.role} IN ('owner', 'doctor', 'receptionist', 'privacy_admin', 'auditor')`,
    ),
  ],
);

/**
 * One-time codes for the day a phone is lost.
 *
 * Stored as a SHA-256 digest of a high-entropy generated code, so the table
 * cannot be read back into working codes. Redemption marks the row used rather
 * than deleting it, which is what allows "this account was recovered on the
 * 14th" to be answered afterwards.
 */
export const staffRecoveryCodes = pgTable(
  "staff_recovery_codes",
  {
    email: text("email")
      .notNull()
      .references(() => staffUsers.email, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.email, table.codeHash] }),
    index("staff_recovery_codes_email").on(table.email, table.usedAt),
  ],
);

/**
 * One row per issued MFA session.
 *
 * Staff could hold valid sessions on any number of devices with no way to see or
 * end them: the only revocation available was bumping the epoch, which signs
 * everybody's devices out at once and gives no answer to "where am I signed in?".
 * That is the question somebody asks after leaving a browser open on a hotel
 * computer, and it deserves a better answer than "reset your second factor".
 *
 * Holds a digest of the token, never the token: this table is a list of sessions,
 * not a set of spare keys to them.
 */
export const staffSessions = pgTable(
  "staff_sessions",
  {
    /** Random id carried inside the signed token, so a session is addressable. */
    id: text("id").primaryKey(),
    email: text("email")
      .notNull()
      .references(() => staffUsers.email, { onDelete: "cascade" }),
    /** SHA-256 of the token, so a leaked row cannot be replayed as a session. */
    tokenDigest: text("token_digest").notNull(),
    /** Coarse device description parsed from the user agent. Never the full UA. */
    device: text("device"),
    /** Truncated hash of the caller IP — enough to spot an anomaly, not to track. */
    clientHash: text("client_hash"),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    /** "staff" when signed out deliberately, "owner" when ended by somebody else. */
    revokedBy: text("revoked_by"),
  },
  (table) => [
    index("staff_sessions_email").on(table.email, table.revokedAt),
    index("staff_sessions_expires").on(table.expiresAt),
  ],
);

/**
 * Fixed-window counter for authentication attempts, keyed per client.
 *
 * The per-account lockout stops five wrong codes against one colleague. It does
 * nothing about one source spreading five guesses across every address in the
 * directory, which is the shape a real attack takes once the staff list is known.
 * Cloudflare's WAF is the right place for volumetric limits; this is the floor
 * that exists whether or not that has been configured.
 *
 * Keyed by client fingerprint *or* an email in the same column, which is why it
 * relates to nothing and carries no foreign key.
 */
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
    mode: "string",
  }).notNull(),
  /** Set once the limit is hit, so the block outlives the counting window. */
  blockedUntil: timestamp("blocked_until", { withTimezone: true, mode: "string" }),
});

/**
 * Authentication and authorisation events, separate from `access_log`.
 *
 * `access_log` answers "who read this patient's record?". This answers "who
 * tried to get in, who was refused, and who changed what somebody else is
 * allowed to do?" — questions whose answers are needed even when no patient
 * record was reached, which is exactly the case during an attack. Holds no
 * patient data, so it is retained on the audit schedule rather than the PII one.
 */
export const securityEvents = pgTable(
  "security_events",
  {
    id: text("id").primaryKey(),
    /**
     * Staff email where known; "anonymous" for an unauthenticated attempt.
     * Unconstrained by necessity — the actor of a refused sign-in may not exist.
     */
    actor: text("actor").notNull(),
    /**
     * mfa_verified | mfa_failed | role_changed | permission_denied | …
     *
     * Deliberately unconstrained: the set is open and grows with each new
     * control. A CHECK here would make adding an audit event a migration.
     */
    event: text("event").notNull(),
    outcome: text("outcome").notNull(),
    /** Who or what the event was about, when that differs from the actor. */
    subject: text("subject"),
    detail: text("detail"),
    clientHash: text("client_hash"),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("security_events_actor_at").on(table.actor, table.at),
    index("security_events_event_at").on(table.event, table.at),
    index("security_events_at").on(table.at),
    check(
      "security_events_outcome_valid",
      sql`${table.outcome} IN ('allowed', 'denied', 'changed')`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Durable notification outbox                                                */
/* -------------------------------------------------------------------------- */

/**
 * One row per event/channel pair. The row deliberately stores only a subject
 * reference and a non-identifying appointment snapshot: recipient data is
 * loaded from the authoritative appointment or data-request row at send time,
 * so the outbox never becomes a second unmanaged patient directory.
 *
 * `subject_id` points at either `appointments` or `data_requests` depending on
 * `subject_type`, which is the one relation in this schema where a foreign key
 * is impossible rather than merely absent. The discriminator is constrained
 * instead, so at least the *set* of things it can point at is enforced.
 */
export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    channel: text("channel").notNull(),
    contextJson: text("context_json"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }),
    lockedBy: text("locked_by"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("notification_jobs_due").on(table.status, table.nextAttemptAt),
    index("notification_jobs_subject").on(table.subjectType, table.subjectId),
    index("notification_jobs_created").on(table.createdAt),
    check(
      "notification_jobs_status_valid",
      sql`${table.status} IN ('pending', 'processing', 'retrying', 'blocked', 'delivered', 'skipped', 'dead')`,
    ),
    check(
      "notification_jobs_subject_type_valid",
      sql`${table.subjectType} IN ('appointment', 'data_request')`,
    ),
    check(
      "notification_jobs_kind_valid",
      sql`${table.kind} IN ('booking.confirmed', 'booking.cancelled', 'booking.rescheduled', 'booking.reminder', 'data.request')`,
    ),
    check(
      "notification_jobs_channel_valid",
      sql`${table.channel} IN ('patient_email', 'patient_whatsapp', 'clinic_email', 'clinic_webhook', 'branch_sms')`,
    ),
    check("notification_jobs_attempts_valid", sql`${table.attempts} >= 0`),
    check("notification_jobs_max_attempts_valid", sql`${table.maxAttempts} > 0`),
  ],
);

/** Attempt history contains delivery metadata, never message bodies or PII. */
export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => notificationJobs.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    /** Unconstrained: the provider-outcome vocabulary is not a closed set. */
    outcome: text("outcome").notNull(),
    provider: text("provider"),
    statusCode: integer("status_code"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
    finishedAt: timestamp("finished_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => [index("notification_attempts_job").on(table.jobId, table.attemptNumber)],
);

/* -------------------------------------------------------------------------- */
/* Pilot operations                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The pilot is deliberately controlled from one durable row. The public
 * booking worker reads this policy before offering or holding a slot, while
 * Clinic OS is the only surface allowed to change it.
 */
export const pilotSettings = pgTable(
  "pilot_settings",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("setup"),
    /**
     * A running pilot is always bounded to exactly one branch. `RESTRICT`:
     * removing the branch a live pilot is bound to should be refused, not
     * silently nulled.
     */
    branchId: text("branch_id").references(() => clinicBranches.id, {
      onDelete: "restrict",
    }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    decision: text("decision").notNull().default("pending"),
    decisionNote: text("decision_note"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    check(
      "pilot_settings_status_valid",
      sql`${table.status} IN ('setup', 'running', 'paused', 'complete')`,
    ),
    check(
      "pilot_settings_decision_valid",
      sql`${table.decision} IN ('pending', 'go', 'extend', 'stop')`,
    ),
  ],
);

/** Operational sign-offs required before the pilot can honestly be started. */
export const pilotChecklist = pgTable("pilot_checklist", {
  itemKey: text("item_key").primaryKey(),
  completed: boolean("completed").notNull().default(false),
  note: text("note"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});

/**
 * Operational problems noticed during the parallel run. These records contain
 * no patient identifiers; individual patient issues belong on the appointment.
 */
export const pilotIncidents = pgTable(
  "pilot_incidents",
  {
    id: text("id").primaryKey(),
    summary: text("summary").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull().default("open"),
    openedBy: text("opened_by").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("pilot_incidents_status").on(table.status, table.openedAt),
    check(
      "pilot_incidents_severity_valid",
      sql`${table.severity} IN ('low', 'medium', 'high', 'critical')`,
    ),
    check(
      "pilot_incidents_status_valid",
      sql`${table.status} IN ('open', 'resolved')`,
    ),
  ],
);

/** Immutable weekly snapshots: the evidence behind a go/no-go decision. */
export const pilotReviews = pgTable(
  "pilot_reviews",
  {
    id: text("id").primaryKey(),
    weekStart: date("week_start").notNull(),
    /** `RESTRICT`: this is evidence. It should not lose its subject. */
    branchId: text("branch_id").references(() => clinicBranches.id, {
      onDelete: "restrict",
    }),
    bookings: integer("bookings").notNull(),
    completed: integer("completed").notNull(),
    noShows: integer("no_shows").notNull(),
    cancelled: integer("cancelled").notNull(),
    notificationTotal: integer("notification_total").notNull(),
    notificationFailed: integer("notification_failed").notNull(),
    openIncidents: integer("open_incidents").notNull(),
    recommendation: text("recommendation").notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("pilot_reviews_week").on(table.weekStart),
    index("pilot_reviews_created").on(table.createdAt),
    check(
      "pilot_reviews_recommendation_valid",
      sql`${table.recommendation} IN ('continue', 'investigate', 'stop')`,
    ),
  ],
);
