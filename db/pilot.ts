import { env } from "cloudflare:workers";
import { addDays, clinicToday, isDateKey, weekdayIndex } from "@/lib/dates";

export const PILOT_CHECKLIST = [
  {
    key: "real_schedule",
    label: "Real hours and rota approved",
    detail: "The pilot branch schedule and closures match the clinic's operating book.",
  },
  {
    key: "notifications_verified",
    label: "Two notification paths verified",
    detail: "A real patient and reception test reached two independent channels.",
  },
  {
    key: "staff_trained",
    label: "Pilot staff trained",
    detail: "Reception can book, check in, cancel, retry delivery and find the fallback.",
  },
  {
    key: "runbook_at_reception",
    label: "Runbook is at reception",
    detail: "The printed fallback and escalation contacts are available during every shift.",
  },
  {
    key: "fallback_ready",
    label: "Fallback appointment sheet ready",
    detail: "Reception can keep taking bookings if the system or internet is unavailable.",
  },
  {
    key: "content_legal_approved",
    label: "Clinical, Arabic and legal approvals recorded",
    detail: "The separate production approval manifest is complete and evidenced.",
  },
] as const;

/**
 * Minimum evidence before a rate means anything.
 *
 * Without these a pilot that has taken no bookings reports a 0% no-show rate
 * and passes every gate — the most dangerous possible failure, because it looks
 * like success. Below these counts a gate reports `unknown`, not `pass`.
 */
export const MIN_ATTENDED_FOR_RATE = 10;
export const MIN_NOTIFICATIONS_FOR_RATE = 20;
export const MIN_BOOKINGS_FOR_SIGNAL = 5;

export type PilotStatus = "setup" | "running" | "paused" | "complete";
export type PilotDecision = "pending" | "go" | "extend" | "stop";
export type PilotRecommendation = "continue" | "investigate" | "stop";
export type PilotSeverity = "low" | "medium" | "high" | "critical";

export type PilotSettings = {
  status: PilotStatus;
  branchId: string | null;
  startDate: string | null;
  endDate: string | null;
  decision: PilotDecision;
  decisionNote: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type PilotMetrics = {
  weekStart: string;
  bookings: number;
  websiteBookings: number;
  completed: number;
  noShows: number;
  noShowRate: number;
  cancelled: number;
  notificationTotal: number;
  notificationFailed: number;
  notificationFailureRate: number;
  openIncidents: number;
  criticalIncidents: number;
  /** completed + no_show: the only appointments a no-show rate can be drawn from. */
  attended: number;
  /**
   * Non-cancelled appointments holding no occupancy cells.
   *
   * The cells table is what makes double-booking impossible, so an appointment
   * without them is unprotected: another booking can be written over its time.
   * This is the integrity check behind the "double-booking incidents" measure —
   * it audits the book rather than waiting for the clinic to notice.
   */
  unprotectedAppointments: number;
};

const DEFAULT_SETTINGS: PilotSettings = {
  status: "setup",
  branchId: null,
  startDate: null,
  endDate: null,
  decision: "pending",
  decisionNote: null,
  updatedBy: null,
  updatedAt: null,
};

const VALID_STATUSES: PilotStatus[] = ["setup", "running", "paused", "complete"];
const VALID_DECISIONS: PilotDecision[] = ["pending", "go", "extend", "stop"];
const VALID_RECOMMENDATIONS: PilotRecommendation[] = ["continue", "investigate", "stop"];
const VALID_SEVERITIES: PilotSeverity[] = ["low", "medium", "high", "critical"];

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

let pilotReady: Promise<void> | null = null;

export function ensurePilotSchema(): Promise<void> {
  pilotReady ??= createSchema().catch((error) => {
    pilotReady = null;
    throw error;
  });
  return pilotReady;
}

async function createSchema() {
  const db = database();
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pilot_settings (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'setup',
        branch_id TEXT,
        start_date TEXT,
        end_date TEXT,
        decision TEXT NOT NULL DEFAULT 'pending',
        decision_note TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pilot_checklist (
        item_key TEXT PRIMARY KEY,
        completed INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pilot_incidents (
        id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        opened_by TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        resolved_by TEXT,
        resolved_at TEXT
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS pilot_incidents_status ON pilot_incidents (status, opened_at)",
    ),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pilot_reviews (
        id TEXT PRIMARY KEY,
        week_start TEXT NOT NULL,
        branch_id TEXT,
        bookings INTEGER NOT NULL,
        completed INTEGER NOT NULL,
        no_shows INTEGER NOT NULL,
        cancelled INTEGER NOT NULL,
        notification_total INTEGER NOT NULL,
        notification_failed INTEGER NOT NULL,
        open_incidents INTEGER NOT NULL,
        recommendation TEXT NOT NULL,
        note TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS pilot_reviews_week ON pilot_reviews (week_start)"),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS pilot_reviews_created ON pilot_reviews (created_at)",
    ),
  ]);
}

type SettingsRow = {
  status: PilotStatus;
  branchId: string | null;
  startDate: string | null;
  endDate: string | null;
  decision: PilotDecision;
  decisionNote: string | null;
  updatedBy: string;
  updatedAt: string;
};

export async function getPilotSettings(): Promise<PilotSettings> {
  await ensurePilotSchema();
  const row = await database()
    .prepare(
      `SELECT status, branch_id AS branchId, start_date AS startDate,
              end_date AS endDate, decision, decision_note AS decisionNote,
              updated_by AS updatedBy, updated_at AS updatedAt
       FROM pilot_settings WHERE id = 'primary'`,
    )
    .first<SettingsRow>();
  return row ?? DEFAULT_SETTINGS;
}

/** Lean policy used by the public availability endpoint. */
let policyCache:
  | {
      expiresAt: number;
      value: Promise<{
        status: PilotStatus;
        branchId: string | null;
        restrictsBooking: boolean;
        bookingPaused: boolean;
      }>;
    }
  | null = null;

export async function getPilotPolicy() {
  const now = Date.now();
  if (policyCache && policyCache.expiresAt > now) return policyCache.value;

  const value = getPilotSettings()
    .then((settings) => ({
      status: settings.status,
      branchId: settings.branchId,
      restrictsBooking: settings.status === "running" && Boolean(settings.branchId),
      bookingPaused: settings.status === "paused",
    }))
    .catch((error) => {
      policyCache = null;
      throw error;
    });
  // Coalesce a burst into one D1 read. A different edge isolate can retain the
  // old policy for at most one second, which keeps emergency pause bounded
  // without adding a database round trip to every availability request.
  policyCache = { expiresAt: now + 1_000, value };
  return value;
}

export async function getPilotChecklist() {
  await ensurePilotSchema();
  const result = await database()
    .prepare(
      `SELECT item_key AS itemKey, completed, note,
              updated_by AS updatedBy, updated_at AS updatedAt
       FROM pilot_checklist`,
    )
    .all<{
      itemKey: string;
      completed: number;
      note: string | null;
      updatedBy: string;
      updatedAt: string;
    }>();
  const rows = new Map((result.results ?? []).map((row) => [row.itemKey, row]));
  return PILOT_CHECKLIST.map((definition) => {
    const row = rows.get(definition.key);
    return {
      ...definition,
      completed: Boolean(row?.completed),
      note: row?.note ?? null,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function updatePilotChecklist(input: {
  key: string;
  completed: boolean;
  note?: string | null;
  actor: string;
}) {
  if (!PILOT_CHECKLIST.some((item) => item.key === input.key)) {
    throw new Error("Unknown pilot checklist item.");
  }
  await ensurePilotSchema();
  const timestamp = new Date().toISOString();
  await database()
    .prepare(
      `INSERT INTO pilot_checklist
       (item_key, completed, note, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_key) DO UPDATE SET
         completed = excluded.completed,
         note = excluded.note,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.key,
      input.completed ? 1 : 0,
      input.note?.trim().slice(0, 500) || null,
      input.actor,
      timestamp,
    )
    .run();
  return getPilotChecklist();
}

export async function updatePilotSettings(input: {
  status: PilotStatus;
  branchId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  decision?: PilotDecision;
  decisionNote?: string | null;
  actor: string;
}) {
  if (!VALID_STATUSES.includes(input.status)) throw new Error("Invalid pilot status.");
  const decision = input.decision ?? "pending";
  if (!VALID_DECISIONS.includes(decision)) throw new Error("Invalid pilot decision.");
  const startDate = input.startDate || null;
  const endDate = input.endDate || null;
  if ((startDate && !isDateKey(startDate)) || (endDate && !isDateKey(endDate))) {
    throw new Error("Pilot dates must use YYYY-MM-DD.");
  }
  if (startDate && endDate && endDate < startDate) {
    throw new Error("Pilot end date cannot be before its start date.");
  }
  if ((input.status === "running" || input.status === "paused") && !input.branchId) {
    throw new Error("Choose one pilot branch before starting or pausing the pilot.");
  }
  if (input.status === "running" && (!startDate || !endDate)) {
    throw new Error("Choose both pilot dates before starting the pilot.");
  }
  if (
    input.status === "complete" &&
    (decision === "pending" || !input.decisionNote?.trim())
  ) {
    throw new Error("Record the final decision and its evidence before completing the pilot.");
  }
  if (input.status === "running") {
    const checklist = await getPilotChecklist();
    if (checklist.some((item) => !item.completed)) {
      throw new Error("Complete every readiness sign-off before starting the pilot.");
    }
  }

  await ensurePilotSchema();
  const timestamp = new Date().toISOString();
  await database()
    .prepare(
      `INSERT INTO pilot_settings
       (id, status, branch_id, start_date, end_date, decision, decision_note, updated_by, updated_at)
       VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         branch_id = excluded.branch_id,
         start_date = excluded.start_date,
         end_date = excluded.end_date,
         decision = excluded.decision,
         decision_note = excluded.decision_note,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.status,
      input.branchId || null,
      startDate,
      endDate,
      decision,
      input.decisionNote?.trim().slice(0, 1000) || null,
      input.actor,
      timestamp,
    )
    .run();
  // The same isolate sees a start/pause action immediately; other isolates
  // expire their one-second read cache independently.
  policyCache = null;
  return getPilotSettings();
}

function weekStart(date = clinicToday()) {
  return addDays(date, -weekdayIndex(date));
}

export async function getPilotMetrics(settings?: PilotSettings): Promise<PilotMetrics> {
  const resolvedSettings = settings ?? (await getPilotSettings());
  await ensurePilotSchema();
  const db = database();
  const start = weekStart();
  const startIso = `${start}T00:00:00.000Z`;
  const branchClause = resolvedSettings.branchId ? " AND branch = ?" : "";
  const branchBindings = resolvedSettings.branchId ? [resolvedSettings.branchId] : [];

  const [appointments, notifications, incidents, integrity] = await Promise.all([
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN confirmed_at >= ? THEN 1 ELSE 0 END) AS bookings,
           SUM(CASE WHEN confirmed_at >= ? AND source = 'website' THEN 1 ELSE 0 END) AS websiteBookings,
           SUM(CASE WHEN slot_date >= ? AND status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN slot_date >= ? AND status = 'no_show' THEN 1 ELSE 0 END) AS noShows,
           SUM(CASE WHEN slot_date >= ? AND status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
         FROM appointments
         WHERE status <> 'held'${branchClause}`,
      )
      .bind(startIso, startIso, start, start, start, ...branchBindings)
      .first<{
        bookings: number | null;
        websiteBookings: number | null;
        completed: number | null;
        noShows: number | null;
        cancelled: number | null;
      }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('blocked', 'dead') THEN 1 ELSE 0 END) AS failed
         FROM notification_jobs
         WHERE created_at >= ?
           AND subject_type = 'appointment'
           ${resolvedSettings.branchId ? "AND subject_id IN (SELECT id FROM appointments WHERE branch = ?)" : ""}`,
      )
      .bind(startIso, ...branchBindings)
      .first<{ total: number; failed: number | null }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS openIncidents,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS criticalIncidents
         FROM pilot_incidents WHERE status = 'open'`,
      )
      .first<{ openIncidents: number; criticalIncidents: number | null }>(),
    /**
     * Integrity audit for the "double-booking incidents" measure.
     *
     * A live appointment with no occupancy cells is not protected by the
     * uniqueness constraint, so another booking can be written across its time.
     * Counting them audits the appointment book directly rather than waiting
     * for two patients to arrive for the same slot.
     */
    db
      .prepare(
        `SELECT COUNT(*) AS unprotected
         FROM appointments a
         WHERE a.status NOT IN ('cancelled', 'held')
           AND a.slot_date >= ?
           AND NOT EXISTS (
             SELECT 1 FROM appointment_cells c WHERE c.appointment_id = a.id
           )`,
      )
      .bind(start)
      .first<{ unprotected: number | null }>(),
  ]);

  const completed = appointments?.completed ?? 0;
  const noShows = appointments?.noShows ?? 0;
  const attended = completed + noShows;
  const notificationTotal = notifications?.total ?? 0;
  const notificationFailed = notifications?.failed ?? 0;
  return {
    weekStart: start,
    bookings: appointments?.bookings ?? 0,
    websiteBookings: appointments?.websiteBookings ?? 0,
    completed,
    noShows,
    noShowRate: attended ? Math.round((noShows / attended) * 100) : 0,
    cancelled: appointments?.cancelled ?? 0,
    notificationTotal,
    notificationFailed,
    notificationFailureRate: notificationTotal
      ? Math.round((notificationFailed / notificationTotal) * 100)
      : 0,
    openIncidents: incidents?.openIncidents ?? 0,
    criticalIncidents: incidents?.criticalIncidents ?? 0,
    attended,
    unprotectedAppointments: integrity?.unprotected ?? 0,
  };
}

export type PilotCheckState = "pass" | "fail" | "unknown";

export type PilotCheck = {
  key: string;
  label: string;
  state: PilotCheckState;
  /** Kept so existing callers reading a boolean still work. */
  pass: boolean;
  detail: string;
};

export type PilotConfiguration = {
  notifications: boolean;
  proxyVerification: boolean;
  staffAllowlist: boolean;
  /**
   * Staff authentication is genuinely enforced: MFA required, and both the
   * secret-encryption key and the session signing secret present. Without all
   * three, the dashboard is guarded by an email address in a header.
   */
  staffMfa: boolean;
};

/**
 * The go/no-go decision.
 *
 * Every gate can return `unknown`, and that is the point. The previous version
 * only returned pass/fail, so a pilot that had taken no bookings reported a 0%
 * no-show rate, a 0% delivery-failure rate, and recommended "continue" — the
 * most dangerous output available, because an empty pilot looked like a
 * successful one. A rate computed from nothing is not evidence of safety.
 */
export function evaluatePilot(
  metrics: PilotMetrics,
  checklistComplete: boolean,
  configuration?: PilotConfiguration,
) {
  const checks: PilotCheck[] = [];

  const add = (key: string, label: string, state: PilotCheckState, detail: string) =>
    checks.push({ key, label, state, pass: state === "pass", detail });

  add(
    "readiness",
    "All readiness sign-offs",
    checklistComplete ? "pass" : "fail",
    checklistComplete
      ? "Every pre-pilot sign-off is recorded."
      : "Some sign-offs are still outstanding.",
  );

  // Infrastructure the pilot silently depends on. A pilot cannot be judged on
  // notification delivery if no provider was ever configured — the failure rate
  // would read 0% because nothing was ever attempted.
  if (configuration) {
    const infra: string[] = [];
    if (!configuration.notifications) infra.push("no notification provider");
    if (!configuration.proxyVerification) infra.push("no proxy verification secret");
    if (!configuration.staffAllowlist) infra.push("no staff allowlist");
    if (!configuration.staffMfa) infra.push("staff MFA not enforced");
    add(
      "infrastructure",
      "Production configuration in place",
      infra.length === 0 ? "pass" : "fail",
      infra.length === 0
        ? "Notifications, staff authentication and proxy verification are configured."
        : `Missing: ${infra.join(", ")}.`,
    );
  }

  // Integrity is never "unknown": zero live appointments means zero unprotected
  // ones, which is genuinely correct rather than merely unmeasured.
  add(
    "integrity",
    "No unprotected appointments",
    metrics.unprotectedAppointments === 0 ? "pass" : "fail",
    metrics.unprotectedAppointments === 0
      ? "Every live appointment holds its occupancy cells."
      : `${metrics.unprotectedAppointments} appointment(s) are not protected against double-booking.`,
  );

  add(
    "delivery",
    "Delivery failures at or below 5%",
    metrics.notificationTotal < MIN_NOTIFICATIONS_FOR_RATE
      ? "unknown"
      : metrics.notificationFailureRate <= 5
        ? "pass"
        : "fail",
    metrics.notificationTotal < MIN_NOTIFICATIONS_FOR_RATE
      ? `Only ${metrics.notificationTotal} message(s) attempted; ${MIN_NOTIFICATIONS_FOR_RATE} needed before a rate means anything.`
      : `${metrics.notificationFailureRate}% of ${metrics.notificationTotal} attempts failed.`,
  );

  add(
    "attendance",
    "No-show rate at or below 15%",
    metrics.attended < MIN_ATTENDED_FOR_RATE
      ? "unknown"
      : metrics.noShowRate <= 15
        ? "pass"
        : "fail",
    metrics.attended < MIN_ATTENDED_FOR_RATE
      ? `Only ${metrics.attended} appointment(s) have been marked completed or no-show; ${MIN_ATTENDED_FOR_RATE} needed.`
      : `${metrics.noShowRate}% of ${metrics.attended} attended appointments were no-shows.`,
  );

  add(
    "volume",
    "Enough bookings to judge",
    metrics.bookings >= MIN_BOOKINGS_FOR_SIGNAL ? "pass" : "unknown",
    metrics.bookings >= MIN_BOOKINGS_FOR_SIGNAL
      ? `${metrics.bookings} booking(s) taken this week.`
      : `Only ${metrics.bookings} booking(s) taken; ${MIN_BOOKINGS_FOR_SIGNAL} needed for the week to carry signal.`,
  );

  add(
    "critical",
    "No open critical incidents",
    metrics.criticalIncidents === 0 ? "pass" : "fail",
    metrics.criticalIncidents === 0
      ? "No critical incidents are open."
      : `${metrics.criticalIncidents} critical incident(s) open.`,
  );

  const failed = checks.filter((check) => check.state === "fail");
  const unknown = checks.filter((check) => check.state === "unknown");

  const recommendation =
    metrics.criticalIncidents > 0 || metrics.unprotectedAppointments > 0
      ? ("stop" as const)
      : failed.length > 0
        ? ("investigate" as const)
        : unknown.length > 0
          ? ("insufficient-data" as const)
          : ("continue" as const);

  return { checks, recommendation, failed: failed.length, unknown: unknown.length };
}

export async function listPilotIncidents() {
  await ensurePilotSchema();
  const result = await database()
    .prepare(
      `SELECT id, summary, severity, status, opened_by AS openedBy,
              opened_at AS openedAt, resolved_by AS resolvedBy,
              resolved_at AS resolvedAt
       FROM pilot_incidents ORDER BY
         CASE status WHEN 'open' THEN 0 ELSE 1 END,
         opened_at DESC LIMIT 50`,
    )
    .all();
  return result.results ?? [];
}

export async function createPilotIncident(input: {
  summary: string;
  severity: PilotSeverity;
  actor: string;
}) {
  const summary = input.summary.trim();
  if (!summary || summary.length > 240) throw new Error("Incident summary is required.");
  if (!VALID_SEVERITIES.includes(input.severity)) throw new Error("Invalid incident severity.");
  await ensurePilotSchema();
  await database()
    .prepare(
      `INSERT INTO pilot_incidents
       (id, summary, severity, status, opened_by, opened_at)
       VALUES (?, ?, ?, 'open', ?, ?)`,
    )
    .bind(crypto.randomUUID(), summary, input.severity, input.actor, new Date().toISOString())
    .run();
  return listPilotIncidents();
}

export async function resolvePilotIncident(id: string, actor: string) {
  await ensurePilotSchema();
  const result = await database()
    .prepare(
      `UPDATE pilot_incidents SET status = 'resolved', resolved_by = ?, resolved_at = ?
       WHERE id = ? AND status = 'open'`,
    )
    .bind(actor, new Date().toISOString(), id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listPilotReviews() {
  await ensurePilotSchema();
  const result = await database()
    .prepare(
      `SELECT id, week_start AS weekStart, branch_id AS branchId, bookings,
              completed, no_shows AS noShows, cancelled,
              notification_total AS notificationTotal,
              notification_failed AS notificationFailed,
              open_incidents AS openIncidents, recommendation, note,
              created_by AS createdBy, created_at AS createdAt
       FROM pilot_reviews ORDER BY created_at DESC LIMIT 20`,
    )
    .all();
  return result.results ?? [];
}

export async function createPilotReview(input: {
  recommendation: PilotRecommendation;
  note?: string | null;
  actor: string;
}) {
  if (!VALID_RECOMMENDATIONS.includes(input.recommendation)) {
    throw new Error("Invalid weekly recommendation.");
  }
  const settings = await getPilotSettings();
  const metrics = await getPilotMetrics(settings);
  await database()
    .prepare(
      `INSERT INTO pilot_reviews
       (id, week_start, branch_id, bookings, completed, no_shows, cancelled,
        notification_total, notification_failed, open_incidents, recommendation,
        note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      metrics.weekStart,
      settings.branchId,
      metrics.bookings,
      metrics.completed,
      metrics.noShows,
      metrics.cancelled,
      metrics.notificationTotal,
      metrics.notificationFailed,
      metrics.openIncidents,
      input.recommendation,
      input.note?.trim().slice(0, 1000) || null,
      input.actor,
      new Date().toISOString(),
    )
    .run();
  return listPilotReviews();
}

/**
 * Configuration is passed in rather than read here. `lib/auth` reaches into
 * `next/headers`, which does not resolve inside the Workers test pool — and a
 * database module has no business knowing how HTTP identity works anyway.
 */
export async function getPilotDashboard(configuration?: PilotConfiguration) {
  const settings = await getPilotSettings();
  const [checklist, metrics, incidents, reviews] = await Promise.all([
    getPilotChecklist(),
    getPilotMetrics(settings),
    listPilotIncidents(),
    listPilotReviews(),
  ]);
  const checklistComplete = checklist.every((item) => item.completed);
  return {
    settings,
    checklist,
    metrics,
    incidents,
    reviews,
    evaluation: evaluatePilot(metrics, checklistComplete, configuration),
    readyToStart:
      checklistComplete &&
      Boolean(settings.branchId && settings.startDate && settings.endDate) &&
      // Starting a pilot with no notification provider means patients book and
      // hear nothing back, which is worse than not running one at all.
      (configuration?.notifications ?? false),
  };
}
