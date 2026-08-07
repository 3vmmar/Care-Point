import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
    /** Set once a durable reminder job exists; delivery is tracked separately. */
    reminderQueuedAt: text("reminder_queued_at"),
    /** Set when contact details were cleared by the retention job. */
    purgedAt: text("purged_at"),
    /**
     * Why the appointment was cancelled, keyed to `cancellation_reasons`.
     *
     * The clinic recorded *that* a cancellation happened and never why, so the
     * one number a practice can actually act on — are people cancelling because
     * the time was wrong, or because they changed their mind about the treatment —
     * did not exist.
     */
    cancellationReason: text("cancellation_reason"),
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
     * odds guaranteed. Declared, the database enforces it. SQLite treats NULLs
     * as distinct, so purged rows (manage_token = NULL) never collide.
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
    /**
     * Declared, enforced, cascading. An orphan cell is the worst quiet failure
     * this table can produce — a slot nobody holds but nobody can book. The
     * batches were already parent-first and transactional; the constraint
     * turns that convention into something the database refuses to let drift.
     * D1 enforces foreign keys unconditionally.
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

/* -------------------------------------------------------------------------- */
/* Clinic catalogue and rota                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The operational catalogue lives in D1 so the patient site and the separately
 * deployed Clinic OS read the same branches, people, services and hours.
 * Static configuration remains the migration fallback until the clinic has
 * supplied and approved the real production data.
 */
export const departments = sqliteTable("departments", {
  id: text("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const clinicBranches = sqliteTable("clinic_branches", {
  id: text("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  addressEn: text("address_en").notNull(),
  addressAr: text("address_ar").notNull(),
  mapUrl: text("map_url"),
  timezone: text("timezone").notNull().default("Africa/Cairo"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const practitioners = sqliteTable(
  "practitioners",
  {
    id: text("id").primaryKey(),
    departmentId: text("department_id").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    titleEn: text("title_en").notNull(),
    titleAr: text("title_ar").notNull(),
    credentials: text("credentials"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("practitioners_department").on(table.departmentId, table.active)],
);

/**
 * Consultation types. `department_id` doubles as the service *category* the
 * booking form groups by — surgical, non-surgical, dental — which is why
 * departments carry those ids rather than organisational ones.
 */
export const clinicServices = sqliteTable(
  "clinic_services",
  {
    id: text("id").primaryKey(),
    departmentId: text("department_id").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    turnaroundMinutes: integer("turnaround_minutes").notNull().default(10),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("clinic_services_department").on(table.departmentId, table.active)],
);

export const practitionerBranches = sqliteTable(
  "practitioner_branches",
  {
    practitionerId: text("practitioner_id").notNull(),
    branchId: text("branch_id").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.practitionerId, table.branchId] })],
);

export const servicePractitioners = sqliteTable(
  "service_practitioners",
  {
    serviceId: text("service_id").notNull(),
    practitionerId: text("practitioner_id").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.serviceId, table.practitionerId] })],
);

export const weeklySessions = sqliteTable(
  "weekly_sessions",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id").notNull(),
    practitionerId: text("practitioner_id").notNull(),
    weekday: integer("weekday").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    intervalMinutes: integer("interval_minutes").notNull().default(30),
    /**
     * Comma-separated department ids bookable in this session.
     *
     * Held on the session rather than derived through `service_practitioners`
     * because it is a property of the *sitting*, not of the person: the surgeon's
     * Tuesday evening at Maadi takes surgical and non-surgical work, and a dental
     * appointment must not be bookable into it even though the same practitioner
     * could in principle do one.
     */
    categories: text("categories").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("weekly_sessions_branch_day").on(table.branchId, table.weekday, table.active),
    index("weekly_sessions_practitioner_day").on(
      table.practitionerId,
      table.weekday,
      table.active,
    ),
  ],
);

export const scheduleExceptions = sqliteTable(
  "schedule_exceptions",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id").notNull(),
    practitionerId: text("practitioner_id"),
    date: text("date").notNull(),
    /** "closed" removes time; "added" opens an exceptional session. */
    kind: text("kind").notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    reason: text("reason"),
    /** Patients see closures on the booking calendar, so the label is bilingual. */
    reasonAr: text("reason_ar"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("schedule_exceptions_branch_date").on(table.branchId, table.date),
    index("schedule_exceptions_practitioner_date").on(table.practitionerId, table.date),
  ],
);

/**
 * Staff directory, roles and second factor, used by the private deployment.
 *
 * The email is the primary key because identity arrives from the authenticating
 * proxy as an email address and nothing else — there is no local password to key
 * a surrogate id against.
 */
export const staffUsers = sqliteTable("staff_users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /**
   * PBKDF2 hash, salt and cost in one field — see `lib/password.ts`.
   *
   * Null for an account that has not claimed a password yet. Identity used to come
   * entirely from a proxy header, which made the practice dependent on a
   * credential it neither issued nor could rotate; this is the clinic owning its
   * own front door.
   */
  passwordHash: text("password_hash"),
  passwordSetAt: text("password_set_at"),
  /**
   * Set when an owner issues a temporary password. The holder can sign in and do
   * exactly one thing: choose a real one.
   */
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * AES-GCM ciphertext of the TOTP secret, never the secret itself. A TOTP
   * secret is a symmetric key: in the clear, a leaked copy of this table is a
   * permanent second factor for every account, used silently and undetectably.
   */
  totpSecret: text("totp_secret"),
  /** Set when a generated secret has been proved by a code, not merely issued. */
  totpConfirmedAt: text("totp_confirmed_at"),
  /**
   * Highest time step already accepted. RFC 6238 §5.2 requires one code to be
   * usable once, so a replay inside the same window is refused.
   */
  totpLastCounter: integer("totp_last_counter").notNull().default(0),
  /** Consecutive failures, reset by a success. Drives the lockout below. */
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  /**
   * Bumped by an MFA reset or a deactivation, which invalidates every session
   * already issued to this person. Revocation that leaves live sessions running
   * is not revocation.
   */
  sessionEpoch: integer("session_epoch").notNull().default(1),
  invitedBy: text("invited_by"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const staffUserRoles = sqliteTable(
  "staff_user_roles",
  {
    email: text("email").notNull(),
    /** owner | doctor | receptionist | privacy_admin | auditor */
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.email, table.role] })],
);

/**
 * One-time codes for the day a phone is lost.
 *
 * Stored as a SHA-256 digest of a high-entropy generated code, so the table
 * cannot be read back into working codes. Redemption marks the row used rather
 * than deleting it, which is what allows "this account was recovered on the
 * 14th" to be answered afterwards.
 */
export const staffRecoveryCodes = sqliteTable(
  "staff_recovery_codes",
  {
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
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
export const staffSessions = sqliteTable(
  "staff_sessions",
  {
    /** Random id carried inside the signed token, so a session is addressable. */
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    /** SHA-256 of the token, so a leaked row cannot be replayed as a session. */
    tokenDigest: text("token_digest").notNull(),
    /** Coarse device description parsed from the user agent. Never the full UA. */
    device: text("device"),
    /** Truncated hash of the caller IP — enough to spot an anomaly, not to track. */
    clientHash: text("client_hash"),
    issuedAt: text("issued_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
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
 */
export const authThrottle = sqliteTable("auth_throttle", {
  /** Client fingerprint, or an email for account-scoped limits. */
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  /** Set once the limit is hit, so the block outlives the counting window. */
  blockedUntil: text("blocked_until"),
});

/**
 * Why appointments get cancelled.
 *
 * A lookup table rather than free text so the answer can be counted. Free text
 * would give the clinic a thousand ways to write "patient was travelling" and no
 * way to see that travel is why a fifth of its Thursday evenings empty out.
 */
export const cancellationReasons = sqliteTable(
  "cancellation_reasons",
  {
    code: text("code").primaryKey(),
    labelEn: text("label_en").notNull(),
    labelAr: text("label_ar").notNull(),
    /** "patient" | "staff" | "both" — who is offered this reason. */
    audience: text("audience").notNull().default("both"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("cancellation_reasons_audience").on(table.audience, table.active)],
);

/**
 * Authentication and authorisation events, separate from `access_log`.
 *
 * `access_log` answers "who read this patient's record?". This answers "who
 * tried to get in, who was refused, and who changed what somebody else is
 * allowed to do?" — questions whose answers are needed even when no patient
 * record was reached, which is exactly the case during an attack. Holds no
 * patient data, so it is retained on the audit schedule rather than the PII one.
 */
export const securityEvents = sqliteTable(
  "security_events",
  {
    id: text("id").primaryKey(),
    /** Staff email where known; "anonymous" for an unauthenticated attempt. */
    actor: text("actor").notNull(),
    /** mfa_verified | mfa_failed | role_changed | permission_denied | … */
    event: text("event").notNull(),
    /** "allowed" | "denied" | "changed" — the shape of what happened. */
    outcome: text("outcome").notNull(),
    /** Who or what the event was about, when that differs from the actor. */
    subject: text("subject"),
    detail: text("detail"),
    clientHash: text("client_hash"),
    at: text("at").notNull(),
  },
  (table) => [
    index("security_events_actor_at").on(table.actor, table.at),
    index("security_events_event_at").on(table.event, table.at),
    index("security_events_at").on(table.at),
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
 */
export const notificationJobs = sqliteTable(
  "notification_jobs",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    channel: text("channel").notNull(),
    contextJson: text("context_json"),
    /** pending | processing | retrying | blocked | delivered | skipped | dead */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deliveredAt: text("delivered_at"),
  },
  (table) => [
    index("notification_jobs_due").on(table.status, table.nextAttemptAt),
    index("notification_jobs_subject").on(table.subjectType, table.subjectId),
    index("notification_jobs_created").on(table.createdAt),
  ],
);

/** Attempt history contains delivery metadata, never message bodies or PII. */
export const notificationAttempts = sqliteTable(
  "notification_attempts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => notificationJobs.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: text("outcome").notNull(),
    provider: text("provider"),
    statusCode: integer("status_code"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
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
export const pilotSettings = sqliteTable("pilot_settings", {
  id: text("id").primaryKey(),
  /** setup | running | paused | complete */
  status: text("status").notNull().default("setup"),
  /** A running pilot is always bounded to exactly one branch. */
  branchId: text("branch_id"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  /** pending | go | extend | stop */
  decision: text("decision").notNull().default("pending"),
  decisionNote: text("decision_note"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Operational sign-offs required before the pilot can honestly be started. */
export const pilotChecklist = sqliteTable("pilot_checklist", {
  itemKey: text("item_key").primaryKey(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Operational problems noticed during the parallel run. These records contain
 * no patient identifiers; individual patient issues belong on the appointment.
 */
export const pilotIncidents = sqliteTable(
  "pilot_incidents",
  {
    id: text("id").primaryKey(),
    summary: text("summary").notNull(),
    /** low | medium | high | critical */
    severity: text("severity").notNull(),
    /** open | resolved */
    status: text("status").notNull().default("open"),
    openedBy: text("opened_by").notNull(),
    openedAt: text("opened_at").notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: text("resolved_at"),
  },
  (table) => [index("pilot_incidents_status").on(table.status, table.openedAt)],
);

/** Immutable weekly snapshots: the evidence behind a go/no-go decision. */
export const pilotReviews = sqliteTable(
  "pilot_reviews",
  {
    id: text("id").primaryKey(),
    weekStart: text("week_start").notNull(),
    branchId: text("branch_id"),
    bookings: integer("bookings").notNull(),
    completed: integer("completed").notNull(),
    noShows: integer("no_shows").notNull(),
    cancelled: integer("cancelled").notNull(),
    notificationTotal: integer("notification_total").notNull(),
    notificationFailed: integer("notification_failed").notNull(),
    openIncidents: integer("open_incidents").notNull(),
    /** continue | investigate | stop */
    recommendation: text("recommendation").notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("pilot_reviews_week").on(table.weekStart),
    index("pilot_reviews_created").on(table.createdAt),
  ],
);
