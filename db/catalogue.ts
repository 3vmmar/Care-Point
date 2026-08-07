import { env } from "cloudflare:workers";
import {
  BRANCHES,
  CLINIC_CLOSURES,
  CLINIC_TURNAROUND_MINUTES,
  CONTACT,
  PRACTITIONERS,
  SERVICES,
  SERVICE_CATEGORIES,
  type Branch,
  type Closure,
  type Service,
  type ServiceCategory,
  type Session,
} from "@/lib/clinic";
import { GRID_MINUTES, toMinutes, validateSchedule } from "@/lib/schedule";
import { isDateKey, isSlotTime } from "@/lib/dates";
import { reportError } from "@/lib/observability";

/**
 * The clinic's operational catalogue, in the database rather than the source.
 *
 * Branches, services, the weekly rota and one-off closures used to be constants
 * in `lib/clinic.ts`. That meant the practice could not change its own opening
 * hours without a developer and a deploy — and the hours in the file were
 * acknowledged placeholders, so the first real edit was always going to be
 * somebody else's Tuesday.
 *
 * What moved and what did not:
 *
 * - **Moved:** the rota (`weekly_sessions`), service durations
 *   (`clinic_services`), practitioners, and closures (`schedule_exceptions`).
 *   These change weekly and are what the clinic asked to control.
 * - **Stayed:** branch names, addresses and map links. They change roughly never,
 *   they are already correct, and they are rendered into statically generated
 *   marketing pages where a database read buys nothing.
 *
 * The constants remain the **seed** — a fresh database is populated from them on
 * first read — and the **fallback**, so a D1 outage degrades to the last known
 * good timetable instead of an empty booking calendar.
 */

/** Everything the scheduling engine needs to answer "what is bookable?". */
export type Catalogue = {
  branches: Branch[];
  services: Service[];
  closures: Closure[];
  turnaroundMinutes: number;
  /**
   * Changes whenever the timetable does.
   *
   * The availability endpoint memoises generated days per branch and service,
   * because regenerating them for a flash crowd was measurable in the burst p95.
   * That cache has to be keyed on this, or an edited rota keeps serving the old
   * one until the isolate happens to be recycled.
   */
  revision: string;
  /** False when this came from the constants because D1 was unavailable. */
  live: boolean;
};

export const STATIC_CATALOGUE: Catalogue = {
  branches: BRANCHES,
  services: SERVICES,
  closures: CLINIC_CLOSURES,
  turnaroundMinutes: CLINIC_TURNAROUND_MINUTES,
  revision: "static",
  live: false,
};

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

let catalogueReady: Promise<void> | null = null;

export function ensureCatalogueSchema(): Promise<void> {
  catalogueReady ??= createSchema().catch((error) => {
    catalogueReady = null;
    throw error;
  });
  return catalogueReady;
}

/** Columns added after these tables first shipped unused. */
const ADDED_COLUMNS: Array<[string, string, string]> = [
  ["weekly_sessions", "categories", "TEXT NOT NULL DEFAULT ''"],
  ["schedule_exceptions", "reason_ar", "TEXT"],
];

async function createSchema() {
  const db = database();
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        name_en TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS clinic_branches (
        id TEXT PRIMARY KEY,
        name_en TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        address_en TEXT NOT NULL,
        address_ar TEXT NOT NULL,
        map_url TEXT,
        timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS practitioners (
        id TEXT PRIMARY KEY,
        department_id TEXT NOT NULL,
        name_en TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        title_ar TEXT NOT NULL,
        credentials TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS clinic_services (
        id TEXT PRIMARY KEY,
        department_id TEXT NOT NULL,
        name_en TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        turnaround_minutes INTEGER NOT NULL DEFAULT 10,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS weekly_sessions (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        practitioner_id TEXT NOT NULL,
        weekday INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL DEFAULT 30,
        categories TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS weekly_sessions_branch_day ON weekly_sessions (branch_id, weekday, active)",
    ),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS schedule_exceptions (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        practitioner_id TEXT,
        date TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        reason TEXT,
        reason_ar TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS schedule_exceptions_branch_date ON schedule_exceptions (branch_id, date)",
    ),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS cancellation_reasons (
        code TEXT PRIMARY KEY,
        label_en TEXT NOT NULL,
        label_ar TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT 'both',
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      )
    `),
  ]);

  for (const [table, column, definition] of ADDED_COLUMNS) {
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column/i.test(message)) throw error;
    }
  }

  /**
   * Add newly introduced consultations to an existing catalogue without
   * overwriting anything the clinic has edited. Clinic OS deactivates rows
   * instead of deleting them, so `INSERT OR IGNORE` preserves deliberate
   * removals while making a genuinely new service available after an upgrade as
   * well as on a fresh database.
   */
  const introducedAt = new Date().toISOString();
  await db.batch(
    SERVICES.map((service, index) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO clinic_services
           (id, department_id, name_en, name_ar, duration_minutes,
            turnaround_minutes, active, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(
          service.id,
          service.category,
          service.en,
          service.ar,
          service.durationMinutes,
          CLINIC_TURNAROUND_MINUTES,
          index,
          introducedAt,
          introducedAt,
        ),
    ),
  );
}

/**
 * Populates a never-used catalogue from the constants.
 *
 * Driven from the read path rather than from schema creation, which is memoised
 * per isolate and so would only ever seed once per Worker — leaving a database
 * that lost its rows on the fallback timetable indefinitely.
 *
 * The trigger is `weekly_sessions` being **completely empty, inactive rows
 * included**. Removing a session in Clinic OS deactivates it rather than deleting
 * it, so a clinic that clears its whole rota keeps an empty rota; only a genuinely
 * untouched table gets the defaults installed. That is the difference between
 * "we have not set our hours yet" and "we have no hours on purpose".
 */
/**
 * The starting set of cancellation reasons.
 *
 * A lookup table rather than free text, so the answers can be counted — free text
 * gives a clinic a thousand ways to write "patient was travelling" and no way to
 * see that travel is why a fifth of its Thursday evenings empty out.
 *
 * `patient` reasons are the ones offered on the self-service page and are worded
 * so that choosing one is not an admission of anything. `staff` reasons cover what
 * only reception knows.
 */
export const DEFAULT_CANCELLATION_REASONS: Array<{
  code: string;
  labelEn: string;
  labelAr: string;
  audience: "patient" | "staff" | "both";
}> = [
  { code: "schedule_conflict", labelEn: "The time no longer works", labelAr: "الموعد لم يعد مناسبًا", audience: "both" },
  { code: "rebooking", labelEn: "Booking a different time instead", labelAr: "سأحجز موعدًا آخر", audience: "both" },
  { code: "travelling", labelEn: "Travelling or away", labelAr: "مسافر أو غير متواجد", audience: "both" },
  { code: "unwell", labelEn: "Unwell", labelAr: "ظروف صحية", audience: "both" },
  { code: "changed_mind", labelEn: "No longer going ahead", labelAr: "لم أعد أرغب في المتابعة", audience: "patient" },
  { code: "cost", labelEn: "Cost", labelAr: "التكلفة", audience: "patient" },
  { code: "clinic_closed", labelEn: "Clinic closed or rota changed", labelAr: "العيادة مغلقة أو تغير الجدول", audience: "staff" },
  { code: "practitioner_unavailable", labelEn: "Practitioner unavailable", labelAr: "الطبيب غير متاح", audience: "staff" },
  { code: "duplicate", labelEn: "Duplicate booking", labelAr: "حجز مكرر", audience: "staff" },
  { code: "no_contact", labelEn: "Could not reach the patient", labelAr: "لم نتمكن من التواصل", audience: "staff" },
  { code: "other", labelEn: "Another reason", labelAr: "سبب آخر", audience: "both" },
];

export type CancellationReason = {
  code: string;
  labelEn: string;
  labelAr: string;
  audience: string;
};

/**
 * Reasons offered to one audience.
 *
 * Seeded on first read, like the rest of the catalogue, so a fresh database can
 * record a reason immediately rather than silently storing nothing.
 */
export async function listCancellationReasons(
  audience: "patient" | "staff",
): Promise<CancellationReason[]> {
  await ensureCatalogueSchema();
  const db = database();
  const existing = await db
    .prepare("SELECT COUNT(*) AS total FROM cancellation_reasons")
    .first<{ total: number }>();

  if ((existing?.total ?? 0) === 0) {
    await db.batch(
      DEFAULT_CANCELLATION_REASONS.map((reason, index) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO cancellation_reasons
             (code, label_en, label_ar, audience, sort_order, active)
             VALUES (?, ?, ?, ?, ?, 1)`,
          )
          .bind(reason.code, reason.labelEn, reason.labelAr, reason.audience, index),
      ),
    );
  }

  const result = await db
    .prepare(
      `SELECT code, label_en AS labelEn, label_ar AS labelAr, audience
       FROM cancellation_reasons
       WHERE active = 1 AND audience IN (?, 'both')
       ORDER BY sort_order, code`,
    )
    .bind(audience)
    .all<CancellationReason>();
  return result.results ?? [];
}

/** Whether a submitted code is one this audience was actually offered. */
export async function isValidCancellationReason(
  code: string | null | undefined,
  audience: "patient" | "staff",
): Promise<boolean> {
  if (!code) return false;
  const reasons = await listCancellationReasons(audience);
  return reasons.some((reason) => reason.code === code);
}

async function seedFromConstants() {
  const db = database();
  const now = new Date().toISOString();
  const statements = [];

  for (const [index, category] of SERVICE_CATEGORIES.entries()) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO departments
           (id, name_en, name_ar, active, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(category.id, category.en, category.ar, index, now, now),
    );
  }

  for (const branch of BRANCHES) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO clinic_branches
           (id, name_en, name_ar, address_en, address_ar, map_url, timezone, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'Africa/Cairo', 1, ?, ?)`,
        )
        .bind(
          branch.id,
          branch.en,
          branch.ar,
          branch.addressEn,
          branch.addressAr,
          branch.mapUrl,
          now,
          now,
        ),
    );
  }

  // Practitioner ids are the stable keys the rota points at; the display name is
  // what the appointment row and the day view show.
  for (const [id, name] of Object.entries(PRACTITIONERS)) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO practitioners
           (id, department_id, name_en, name_ar, title_en, title_ar, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, '', '', 1, ?, ?)`,
        )
        .bind(id, id === "dental" ? "dental" : "surgical", name, name, now, now),
    );
  }

  for (const [index, service] of SERVICES.entries()) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO clinic_services
           (id, department_id, name_en, name_ar, duration_minutes, turnaround_minutes, active, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(
          service.id,
          service.category,
          service.en,
          service.ar,
          service.durationMinutes,
          CLINIC_TURNAROUND_MINUTES,
          index,
          now,
          now,
        ),
    );
  }

  const practitionerIds = new Map<string, string>(
    Object.entries(PRACTITIONERS).map(([id, name]) => [name as string, id]),
  );
  for (const branch of BRANCHES) {
    for (const session of branch.sessions) {
      statements.push(
        db
          .prepare(
            `INSERT INTO weekly_sessions
             (id, branch_id, practitioner_id, weekday, start_time, end_time,
              interval_minutes, categories, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            branch.id,
            practitionerIds.get(session.practitioner) ?? session.practitioner,
            session.weekday,
            session.start,
            session.end,
            session.interval,
            session.categories.join(","),
            now,
            now,
          ),
      );
    }
  }

  for (const closure of CLINIC_CLOSURES) {
    statements.push(
      db
        .prepare(
          `INSERT INTO schedule_exceptions
           (id, branch_id, practitioner_id, date, kind, reason, reason_ar, created_by, created_at)
           VALUES (?, '*', NULL, ?, 'closed', ?, ?, 'seed', ?)`,
        )
        .bind(crypto.randomUUID(), closure.date, closure.en, closure.ar, now),
    );
  }

  await db.batch(statements);
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

type SessionRow = {
  id: string;
  branchId: string;
  practitionerId: string;
  practitionerName: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  categories: string;
};

type ServiceRow = {
  id: string;
  departmentId: string;
  nameEn: string;
  nameAr: string;
  durationMinutes: number;
  turnaroundMinutes: number;
};

type BranchRow = {
  id: string;
  nameEn: string;
  nameAr: string;
  addressEn: string;
  addressAr: string;
  mapUrl: string | null;
};

type ClosureRow = { date: string; reason: string | null; reasonAr: string | null };

function parseCategories(value: string): ServiceCategory[] {
  const known = new Set(SERVICE_CATEGORIES.map((category) => category.id));
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is ServiceCategory => known.has(entry as ServiceCategory));
}

async function readCatalogue(attempt = 0): Promise<Catalogue> {
  await ensureCatalogueSchema();
  const db = database();

  const [branches, sessions, services, closures, stamp] = await Promise.all([
    db
      .prepare(
        `SELECT id, name_en AS nameEn, name_ar AS nameAr, address_en AS addressEn,
                address_ar AS addressAr, map_url AS mapUrl
         FROM clinic_branches WHERE active = 1`,
      )
      .all<BranchRow>(),
    db
      .prepare(
        `SELECT s.id, s.branch_id AS branchId, s.practitioner_id AS practitionerId,
                p.name_en AS practitionerName, s.weekday, s.start_time AS startTime,
                s.end_time AS endTime, s.interval_minutes AS intervalMinutes, s.categories
         FROM weekly_sessions s
         LEFT JOIN practitioners p ON p.id = s.practitioner_id
         WHERE s.active = 1
         ORDER BY s.weekday, s.start_time`,
      )
      .all<SessionRow>(),
    db
      .prepare(
        `SELECT id, department_id AS departmentId, name_en AS nameEn, name_ar AS nameAr,
                duration_minutes AS durationMinutes, turnaround_minutes AS turnaroundMinutes
         FROM clinic_services WHERE active = 1 ORDER BY sort_order, id`,
      )
      .all<ServiceRow>(),
    db
      .prepare(
        `SELECT date, reason, reason_ar AS reasonAr FROM schedule_exceptions
         WHERE kind = 'closed' AND practitioner_id IS NULL`,
      )
      .all<ClosureRow>(),
    // One extra aggregate rather than fetching timestamps on every row: enough to
    // change whenever any part of the timetable does, which is all the cache key
    // needs from it.
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM weekly_sessions WHERE active = 1) AS sessions,
           (SELECT COUNT(*) FROM weekly_sessions) AS everSessions,
           (SELECT MAX(updated_at) FROM weekly_sessions) AS sessionsAt,
           (SELECT MAX(updated_at) FROM clinic_services) AS servicesAt,
           (SELECT COUNT(*) FROM schedule_exceptions WHERE kind = 'closed') AS closures,
           (SELECT MAX(created_at) FROM schedule_exceptions) AS closuresAt`,
      )
      .first<{
        sessions: number;
        everSessions: number;
        sessionsAt: string | null;
        servicesAt: string | null;
        closures: number;
        closuresAt: string | null;
      }>(),
  ]);

  const branchRows = branches.results ?? [];
  if (branchRows.length === 0 || (sessions.results ?? []).length === 0) {
    // Never used at all — a fresh database, a developer's, or the first
    // production deploy. Install the defaults so the booking page works, then
    // read the real thing. Bounded to one attempt so a failing seed cannot loop.
    if (attempt === 0 && (stamp?.everSessions ?? 0) === 0) {
      await seedFromConstants();
      return readCatalogue(1);
    }
    // Otherwise the clinic has a deliberately empty rota, or D1 is misbehaving.
    // Better the known-good constants than a page that silently offers nothing.
    return STATIC_CATALOGUE;
  }

  const sessionsByBranch = new Map<string, Session[]>();
  for (const row of sessions.results ?? []) {
    const list = sessionsByBranch.get(row.branchId) ?? [];
    list.push({
      weekday: row.weekday,
      start: row.startTime,
      end: row.endTime,
      interval: row.intervalMinutes,
      // The domain model keys occupancy by practitioner *name*, which is what the
      // appointment row stores, so an id with no matching person falls back to
      // itself rather than becoming an empty string.
      practitioner: row.practitionerName || row.practitionerId,
      categories: parseCategories(row.categories),
    });
    sessionsByBranch.set(row.branchId, list);
  }

  const resolvedBranches: Branch[] = branchRows.map((row) => {
    const fallback = BRANCHES.find((branch) => branch.id === row.id);
    return {
      id: row.id as Branch["id"],
      en: row.nameEn,
      ar: row.nameAr,
      addressEn: row.addressEn,
      addressAr: row.addressAr,
      mapUrl: row.mapUrl ?? fallback?.mapUrl ?? "",
      // Deliberately from constants, not D1: the manager's number is contact
      // configuration like the address, and the main line is the documented
      // fallback for a branch the constants no longer know.
      smsPhone: fallback?.smsPhone ?? CONTACT.phone,
      sessions: sessionsByBranch.get(row.id) ?? [],
    };
  });

  const resolvedServices: Service[] = (services.results ?? []).map((row) => ({
    id: row.id,
    en: row.nameEn,
    ar: row.nameAr,
    category: (parseCategories(row.departmentId)[0] ?? "surgical") as ServiceCategory,
    durationMinutes: row.durationMinutes,
  }));

  return {
    branches: resolvedBranches,
    services: resolvedServices.length > 0 ? resolvedServices : SERVICES,
    closures: (closures.results ?? []).map((row) => ({
      date: row.date,
      en: row.reason ?? "Closed",
      ar: row.reasonAr ?? row.reason ?? "مغلق",
    })),
    // Turnaround is a property of the room, not the service; the first service's
    // value is the clinic-wide setting until there is a reason to vary it.
    turnaroundMinutes:
      (services.results ?? [])[0]?.turnaroundMinutes ?? CLINIC_TURNAROUND_MINUTES,
    revision: [
      stamp?.sessions ?? 0,
      stamp?.sessionsAt ?? "",
      stamp?.servicesAt ?? "",
      stamp?.closures ?? 0,
      stamp?.closuresAt ?? "",
    ].join("|"),
    live: true,
  };
}

/**
 * Cached read.
 *
 * Availability is the hottest endpoint on the site, and the rota changes a few
 * times a month. A one-second window coalesces a burst into a single D1 read
 * while keeping an edit visible almost immediately — the same trade the pilot
 * policy makes, for the same reason.
 */
let cache: { expiresAt: number; value: Promise<Catalogue> } | null = null;

export function getCatalogue(): Promise<Catalogue> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  const value = readCatalogue().catch(async (error) => {
    cache = null;
    await reportError(error, { where: "catalogue: read", level: "warning" });
    // Degrade to the constants rather than failing the booking page. A stale
    // timetable is recoverable; an empty one loses the appointment.
    return STATIC_CATALOGUE;
  });
  cache = { expiresAt: now + 1_000, value };
  return value;
}

/** Drops the cache so a save is visible to the next request in this isolate. */
export function invalidateCatalogue(): void {
  cache = null;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export type SessionInput = {
  id?: string;
  branchId: string;
  practitionerId: string;
  weekday: number;
  start: string;
  end: string;
  interval: number;
  categories: string[];
};

/**
 * Validates one proposed session against the whole resulting rota.
 *
 * Checked *before* the write, and against the timetable as it would be
 * afterwards, so a save that would put a practitioner in two rooms at once is
 * refused rather than discovered by two patients arriving for the same slot.
 * This is the same `validateSchedule` that guards the constants in CI.
 */
async function rejectIfInvalid(input: SessionInput): Promise<void> {
  // Format only. Whether the time falls on a quarter hour is checked by
  // `validateSchedule` below, which names the offending field — claiming to check
  // it here would have been a message that promised more than it delivered.
  if (!isSlotTime(input.start) || !isSlotTime(input.end)) {
    throw new Error("Times must be in HH:mm format.");
  }
  if (toMinutes(input.end) <= toMinutes(input.start)) {
    throw new Error("A session cannot end before it starts.");
  }
  if (input.weekday < 0 || input.weekday > 6) throw new Error("Choose a weekday.");
  if (input.interval <= 0 || input.interval % GRID_MINUTES !== 0) {
    throw new Error(`The interval must be a positive multiple of ${GRID_MINUTES} minutes.`);
  }
  if (input.categories.length === 0) {
    throw new Error("Choose at least one line of care for this session.");
  }

  const practitioner = await practitionerName(input.practitionerId);

  /**
   * Build the rota as it would be *after* this save, then run the real validator.
   *
   * Assembled from the database rows rather than from `getCatalogue()`, because
   * the domain model deliberately carries no ids — and without the id there is no
   * way to exclude the row being edited from its own overlap check. An earlier
   * version tried to match rows by their shape and so reported every edit as
   * colliding with itself, which made shortening a session impossible.
   */
  const rows = await database()
    .prepare(
      `SELECT s.id, s.branch_id AS branchId, s.weekday, s.start_time AS startTime,
              s.end_time AS endTime, s.interval_minutes AS intervalMinutes,
              s.categories, p.name_en AS practitionerName, s.practitioner_id AS practitionerId
       FROM weekly_sessions s
       LEFT JOIN practitioners p ON p.id = s.practitioner_id
       WHERE s.active = 1`,
    )
    .all<SessionRow>();

  const byBranch = new Map<string, Session[]>();
  const add = (branchId: string, session: Session) => {
    const list = byBranch.get(branchId) ?? [];
    list.push(session);
    byBranch.set(branchId, list);
  };

  for (const row of rows.results ?? []) {
    if (input.id && row.id === input.id) continue;
    add(row.branchId, {
      weekday: row.weekday,
      start: row.startTime,
      end: row.endTime,
      interval: row.intervalMinutes,
      practitioner: row.practitionerName || row.practitionerId,
      categories: parseCategories(row.categories),
    });
  }
  add(input.branchId, {
    weekday: input.weekday,
    start: input.start,
    end: input.end,
    interval: input.interval,
    practitioner,
    categories: input.categories as ServiceCategory[],
  });

  const proposed: Branch[] = Array.from(byBranch.entries()).map(([branchId, sessions]) => {
    const known = BRANCHES.find((branch) => branch.id === branchId);
    return {
      id: branchId as Branch["id"],
      en: known?.en ?? branchId,
      ar: known?.ar ?? branchId,
      addressEn: known?.addressEn ?? "",
      addressAr: known?.addressAr ?? "",
      mapUrl: known?.mapUrl ?? "",
      smsPhone: known?.smsPhone ?? CONTACT.phone,
      sessions,
    };
  });

  const problems = validateSchedule(proposed);
  if (problems.length > 0) {
    throw new Error(problems.map((problem) => problem.message).join("; "));
  }
}

async function practitionerName(id: string): Promise<string> {
  const row = await database()
    .prepare("SELECT name_en AS name FROM practitioners WHERE id = ?")
    .bind(id)
    .first<{ name: string }>();
  if (!row?.name) throw new Error("That practitioner is not in the directory.");
  return row.name;
}

export async function saveSession(input: SessionInput & { actor: string }): Promise<void> {
  await ensureCatalogueSchema();
  await rejectIfInvalid(input);

  const now = new Date().toISOString();
  const db = database();
  if (input.id) {
    await db
      .prepare(
        `UPDATE weekly_sessions
         SET branch_id = ?, practitioner_id = ?, weekday = ?, start_time = ?,
             end_time = ?, interval_minutes = ?, categories = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.branchId,
        input.practitionerId,
        input.weekday,
        input.start,
        input.end,
        input.interval,
        input.categories.join(","),
        now,
        input.id,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO weekly_sessions
         (id, branch_id, practitioner_id, weekday, start_time, end_time,
          interval_minutes, categories, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.branchId,
        input.practitionerId,
        input.weekday,
        input.start,
        input.end,
        input.interval,
        input.categories.join(","),
        now,
        now,
      )
      .run();
  }
  invalidateCatalogue();
}

/**
 * Removes a sitting from the rota.
 *
 * Deactivates rather than deletes, so an accidental removal can be reversed and
 * so appointments already booked into it keep a row that explains where they came
 * from. Existing bookings are deliberately untouched: the clinic honours what it
 * already promised, and the slot simply stops being offered.
 */
export async function removeSession(id: string): Promise<boolean> {
  await ensureCatalogueSchema();
  const result = await database()
    .prepare("UPDATE weekly_sessions SET active = 0, updated_at = ? WHERE id = ? AND active = 1")
    .bind(new Date().toISOString(), id)
    .run();
  invalidateCatalogue();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Adds or updates a practitioner.
 *
 * The plan lists multi-practitioner support as a serious gap, and it was: the rota
 * treated practitioners as first-class from the start, but only the two seeded
 * people existed and nothing could create a third. A practice taking on an
 * associate or a second dentist could not roster them at all.
 *
 * The id is the stable key the rota points at; the English name is what the
 * appointment row and the day view show, and what the occupancy grid keys on.
 */
export async function savePractitioner(input: {
  id?: string;
  nameEn: string;
  nameAr?: string;
  departmentId: string;
  titleEn?: string;
  titleAr?: string;
  actor: string;
}): Promise<string> {
  await ensureCatalogueSchema();
  const nameEn = input.nameEn.trim().slice(0, 120);
  if (!nameEn) throw new Error("A practitioner needs a name.");
  if (!SERVICE_CATEGORIES.some((category) => category.id === input.departmentId)) {
    throw new Error("Choose a line of care for this practitioner.");
  }

  const db = database();
  const now = new Date().toISOString();

  if (input.id) {
    /**
     * Renaming has a consequence worth knowing: the occupancy grid keys cells by
     * practitioner *name*, so rows already written keep the old one. Existing
     * appointments therefore stay protected under the name they were booked
     * against, and only new bookings use the new name. That is the safe direction
     * — the alternative is rewriting historical occupancy rows.
     */
    const result = await db
      .prepare(
        `UPDATE practitioners
         SET name_en = ?, name_ar = ?, department_id = ?, title_en = ?, title_ar = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        nameEn,
        input.nameAr?.trim().slice(0, 120) || nameEn,
        input.departmentId,
        input.titleEn?.trim().slice(0, 120) ?? "",
        input.titleAr?.trim().slice(0, 120) ?? "",
        now,
        input.id,
      )
      .run();
    if ((result.meta.changes ?? 0) === 0) {
      throw new Error("That practitioner is not in the directory.");
    }
    invalidateCatalogue();
    return input.id;
  }

  // A readable id derived from the name, so the rota rows stay legible in the
  // database rather than being a wall of UUIDs.
  const base =
    nameEn
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "practitioner";
  let id = base;
  for (let suffix = 2; suffix < 50; suffix += 1) {
    const clash = await db
      .prepare("SELECT 1 AS present FROM practitioners WHERE id = ?")
      .bind(id)
      .first<{ present: number }>();
    if (!clash) break;
    id = `${base}-${suffix}`;
  }

  await db
    .prepare(
      `INSERT INTO practitioners
       (id, department_id, name_en, name_ar, title_en, title_ar, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.departmentId,
      nameEn,
      input.nameAr?.trim().slice(0, 120) || nameEn,
      input.titleEn?.trim().slice(0, 120) ?? "",
      input.titleAr?.trim().slice(0, 120) ?? "",
      now,
      now,
    )
    .run();
  invalidateCatalogue();
  return id;
}

/**
 * Takes a practitioner off the rota.
 *
 * Refused while they still hold sessions, rather than cascading. Silently
 * deleting their sittings would withdraw every slot inside them from the booking
 * page as a side effect of an unrelated action — the clinic should remove the
 * sessions deliberately and see what that costs them first.
 */
export async function deactivatePractitioner(id: string): Promise<void> {
  await ensureCatalogueSchema();
  const db = database();
  const sessions = await db
    .prepare("SELECT COUNT(*) AS total FROM weekly_sessions WHERE practitioner_id = ? AND active = 1")
    .bind(id)
    .first<{ total: number }>();
  if ((sessions?.total ?? 0) > 0) {
    throw new Error(
      `Remove this practitioner's ${sessions!.total} session(s) from the rota first.`,
    );
  }
  const result = await db
    .prepare("UPDATE practitioners SET active = 0, updated_at = ? WHERE id = ? AND active = 1")
    .bind(new Date().toISOString(), id)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new Error("That practitioner is not in the directory.");
  }
  invalidateCatalogue();
}

export async function saveServiceDuration(input: {
  id: string;
  durationMinutes: number;
  turnaroundMinutes?: number;
}): Promise<void> {
  await ensureCatalogueSchema();
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    input.durationMinutes % GRID_MINUTES !== 0
  ) {
    throw new Error(`A duration must be a positive multiple of ${GRID_MINUTES} minutes.`);
  }
  if (input.durationMinutes > 480) throw new Error("That duration is longer than a clinic day.");

  const turnaround = input.turnaroundMinutes;
  if (turnaround !== undefined && (turnaround < 0 || turnaround % GRID_MINUTES !== 0)) {
    throw new Error(`Turnaround must be a multiple of ${GRID_MINUTES} minutes.`);
  }

  const result = await database()
    .prepare(
      `UPDATE clinic_services
       SET duration_minutes = ?,
           turnaround_minutes = COALESCE(?, turnaround_minutes),
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(input.durationMinutes, turnaround ?? null, new Date().toISOString(), input.id)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new Error("That consultation type does not exist.");
  invalidateCatalogue();
}

export async function saveClosure(input: {
  date: string;
  en: string;
  ar: string;
  actor: string;
}): Promise<void> {
  await ensureCatalogueSchema();
  if (!isDateKey(input.date)) throw new Error("A closure date must be YYYY-MM-DD.");
  const en = input.en.trim().slice(0, 120);
  const ar = input.ar.trim().slice(0, 120);
  if (!en || !ar) throw new Error("A closure needs a reason in both English and Arabic.");

  const db = database();
  await db.batch([
    // One closure per date: re-saving corrects the label rather than stacking.
    db
      .prepare(
        "DELETE FROM schedule_exceptions WHERE date = ? AND kind = 'closed' AND practitioner_id IS NULL",
      )
      .bind(input.date),
    db
      .prepare(
        `INSERT INTO schedule_exceptions
         (id, branch_id, practitioner_id, date, kind, reason, reason_ar, created_by, created_at)
         VALUES (?, '*', NULL, ?, 'closed', ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), input.date, en, ar, input.actor, new Date().toISOString()),
  ]);
  invalidateCatalogue();
}

export async function removeClosure(date: string): Promise<boolean> {
  await ensureCatalogueSchema();
  const result = await database()
    .prepare(
      "DELETE FROM schedule_exceptions WHERE date = ? AND kind = 'closed' AND practitioner_id IS NULL",
    )
    .bind(date)
    .run();
  invalidateCatalogue();
  return (result.meta.changes ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* Editor view                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The catalogue with database ids attached, for the Clinic OS editor.
 *
 * `getCatalogue()` returns the domain model the scheduling engine consumes, which
 * deliberately has no ids. The editor needs them to know which row a change
 * applies to.
 */
export async function getCatalogueForEditing() {
  await ensureCatalogueSchema();
  const db = database();
  const [sessions, services, practitioners, closures, branches] = await Promise.all([
    db
      .prepare(
        `SELECT s.id, s.branch_id AS branchId, s.practitioner_id AS practitionerId,
                p.name_en AS practitionerName, s.weekday, s.start_time AS startTime,
                s.end_time AS endTime, s.interval_minutes AS intervalMinutes, s.categories
         FROM weekly_sessions s
         LEFT JOIN practitioners p ON p.id = s.practitioner_id
         WHERE s.active = 1
         ORDER BY s.branch_id, s.weekday, s.start_time`,
      )
      .all<SessionRow>(),
    db
      .prepare(
        `SELECT id, department_id AS departmentId, name_en AS nameEn, name_ar AS nameAr,
                duration_minutes AS durationMinutes, turnaround_minutes AS turnaroundMinutes
         FROM clinic_services WHERE active = 1 ORDER BY sort_order, id`,
      )
      .all<ServiceRow>(),
    db
      .prepare(
        `SELECT id, name_en AS name, department_id AS departmentId
         FROM practitioners WHERE active = 1 ORDER BY name_en`,
      )
      .all<{ id: string; name: string; departmentId: string }>(),
    db
      .prepare(
        `SELECT date, reason, reason_ar AS reasonAr FROM schedule_exceptions
         WHERE kind = 'closed' AND practitioner_id IS NULL ORDER BY date`,
      )
      .all<ClosureRow>(),
    db
      .prepare("SELECT id, name_en AS name FROM clinic_branches WHERE active = 1 ORDER BY id")
      .all<{ id: string; name: string }>(),
  ]);

  const live = await getCatalogue();
  return {
    branches: branches.results ?? [],
    practitioners: practitioners.results ?? [],
    categories: SERVICE_CATEGORIES,
    sessions: (sessions.results ?? []).map((row) => ({
      id: row.id,
      branchId: row.branchId,
      practitionerId: row.practitionerId,
      practitionerName: row.practitionerName ?? row.practitionerId,
      weekday: row.weekday,
      start: row.startTime,
      end: row.endTime,
      interval: row.intervalMinutes,
      categories: parseCategories(row.categories),
    })),
    services: (services.results ?? []).map((row) => ({
      id: row.id,
      en: row.nameEn,
      ar: row.nameAr,
      category: row.departmentId,
      durationMinutes: row.durationMinutes,
      turnaroundMinutes: row.turnaroundMinutes,
    })),
    closures: (closures.results ?? []).map((row) => ({
      date: row.date,
      en: row.reason ?? "",
      ar: row.reasonAr ?? "",
    })),
    /**
     * Structural problems in the timetable as it currently stands.
     *
     * Normally empty, because every save is validated. Non-empty means a row was
     * written before this validation existed, or directly against the database —
     * worth showing rather than discovering when a patient double-books.
     */
    problems: validateSchedule(live.branches),
    /** False when the reads above fell back to the constants. */
    live: live.live,
  };
}
