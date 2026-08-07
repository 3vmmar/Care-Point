import { database } from "@/db/client";
import {
  REPORTING_CATEGORIES,
  reportingCategoryForService,
  type ReportingCategory,
} from "@/lib/clinic";
import {
  addDays,
  clinicInstant,
  clinicToday,
  daysBetween,
  type DateKey,
} from "@/lib/dates";

export const ANALYTICS_WINDOWS = [30, 90, 180] as const;
export type AnalyticsWindowDays = (typeof ANALYTICS_WINDOWS)[number];

export type AnalyticsStatus =
  | "confirmed"
  | "checked_in"
  | "completed"
  | "no_show"
  | "cancelled";

export type ClinicAnalytics = {
  window: {
    days: AnalyticsWindowDays;
    from: DateKey;
    to: DateKey;
    bucketDays: 1 | 7;
  };
  branch: string | null;
  patients: {
    known: number;
    new: number;
    returning: number;
    /** Contact records older than the retention period cannot be linked. */
    retentionQualified: true;
  };
  trend: Array<{ from: DateKey; to: DateKey; total: number }>;
  statuses: Array<{ status: AnalyticsStatus; total: number }>;
  requestedServices: Array<{ service: string; total: number }>;
  categories: Array<{ category: ReportingCategory; label: string; total: number }>;
  attendance: {
    completed: number;
    noShow: number;
    decided: number;
    attendedRate: number | null;
  };
  sources: Array<{ source: string; total: number }>;
  practitioners: Array<{ practitioner: string | null; total: number }>;
};

type AnalyticsInput = {
  days: AnalyticsWindowDays;
  branch?: string;
  /** Injectable so integration tests do not depend on the wall clock. */
  today?: DateKey;
};

function scheduledWhere(branch?: string) {
  return {
    sql: `status <> 'held' AND slot_date >= ? AND slot_date <= ?${branch ? " AND branch = ?" : ""}`,
    bindings: (from: DateKey, to: DateKey) =>
      branch ? [from, to, branch] : [from, to],
  };
}

function requestedWhere(branch?: string) {
  return {
    sql: `status <> 'held' AND confirmed_at >= ? AND confirmed_at < ?${branch ? " AND branch = ?" : ""}`,
    bindings: (from: string, toExclusive: string) =>
      branch ? [from, toExclusive, branch] : [from, toExclusive],
  };
}

function buildTrend(
  rows: Array<{ date: DateKey; total: number }>,
  from: DateKey,
  to: DateKey,
  bucketDays: 1 | 7,
) {
  const buckets = Array.from(
    { length: Math.ceil((daysBetween(from, to) + 1) / bucketDays) },
    (_, index) => {
      const bucketFrom = addDays(from, index * bucketDays);
      const bucketTo = addDays(
        bucketFrom,
        Math.min(bucketDays - 1, daysBetween(bucketFrom, to)),
      );
      return { from: bucketFrom, to: bucketTo, total: 0 };
    },
  );

  for (const row of rows) {
    const index = Math.floor(daysBetween(from, row.date) / bucketDays);
    if (index >= 0 && index < buckets.length) {
      buckets[index].total += Number(row.total) || 0;
    }
  }
  return buckets;
}

/**
 * Historical Clinic OS analytics derived entirely from persisted appointments.
 *
 * This intentionally does not run as part of the 20-second appointment poll.
 * The query set includes patient cohort and historical groupings, which are
 * useful when somebody opens Insights but wasteful on the reception day view.
 */
export async function getClinicAnalytics(input: AnalyticsInput): Promise<ClinicAnalytics> {
  const db = database();
  const to = input.today ?? clinicToday();
  const from = addDays(to, -(input.days - 1));
  const bucketDays = input.days === 30 ? 1 : 7;
  const scheduled = scheduledWhere(input.branch);
  const requested = requestedWhere(input.branch);
  const confirmedFrom = clinicInstant(from, "00:00").toISOString();
  const confirmedToExclusive = clinicInstant(addDays(to, 1), "00:00").toISOString();

  // The same nine-digit match used by patient history. It joins common Egyptian
  // local and international forms without returning the number to the client.
  // `RIGHT`, not `substr(…, -9)` — see the note on PATIENT_KEY in
  // db/analytics-growth.ts. Postgres does not read a negative start as "last N".
  const patientKey = `RIGHT(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(patient_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''),
    9
  )`;
  const branchPeriodClause = input.branch ? "AND branch = ?" : "";
  const patientBindings: string[] = [from, to];
  if (input.branch) patientBindings.push(input.branch);
  patientBindings.push(from);

  const [patientRow, trendRows, statusRows, serviceRows, sourceRows, practitionerRows] =
    await Promise.all([
      db
        .prepare(
          `WITH retained AS (
             SELECT ${patientKey} AS patientKey, slot_date AS slotDate, branch
             FROM appointments
             WHERE status <> 'held'
               AND patient_phone IS NOT NULL
               AND TRIM(patient_phone) <> ''
           ),
           periodPatients AS (
             SELECT patientKey
             FROM retained
             WHERE slotDate >= ? AND slotDate <= ? ${branchPeriodClause}
             GROUP BY patientKey
           ),
           firstRetainedVisit AS (
             SELECT patientKey, MIN(slotDate) AS firstDate
             FROM retained
             GROUP BY patientKey
           )
           SELECT COUNT(*) AS known,
                  SUM(CASE WHEN firstDate >= ? THEN 1 ELSE 0 END) AS "newPatients"
           FROM periodPatients
           JOIN firstRetainedVisit USING (patientKey)`,
        )
        .bind(...patientBindings)
        .first<{ known: number | null; newPatients: number | null }>(),
      db
        .prepare(
          `SELECT slot_date AS date, COUNT(*) AS total
           FROM appointments
           WHERE ${scheduled.sql}
           GROUP BY slot_date ORDER BY slot_date`,
        )
        .bind(...scheduled.bindings(from, to))
        .all<{ date: DateKey; total: number }>(),
      db
        .prepare(
          `SELECT status, COUNT(*) AS total
           FROM appointments
           WHERE ${scheduled.sql}
           GROUP BY status`,
        )
        .bind(...scheduled.bindings(from, to))
        .all<{ status: AnalyticsStatus; total: number }>(),
      db
        .prepare(
          `SELECT service, COUNT(*) AS total
           FROM appointments
           WHERE ${requested.sql}
           GROUP BY service ORDER BY total DESC, service`,
        )
        .bind(...requested.bindings(confirmedFrom, confirmedToExclusive))
        .all<{ service: string; total: number }>(),
      db
        .prepare(
          `SELECT source, COUNT(*) AS total
           FROM appointments
           WHERE ${requested.sql}
           GROUP BY source ORDER BY total DESC, source`,
        )
        .bind(...requested.bindings(confirmedFrom, confirmedToExclusive))
        .all<{ source: string; total: number }>(),
      db
        .prepare(
          `SELECT practitioner, COUNT(*) AS total
           FROM appointments
           WHERE status IN ('confirmed', 'checked_in', 'completed', 'no_show')
             AND slot_date >= ? AND slot_date <= ?${input.branch ? " AND branch = ?" : ""}
           GROUP BY practitioner ORDER BY total DESC, practitioner`,
        )
        .bind(...scheduled.bindings(from, to))
        .all<{ practitioner: string | null; total: number }>(),
    ]);

  const known = Number(patientRow?.known) || 0;
  const newPatients = Number(patientRow?.newPatients) || 0;
  const statuses = new Map(
    (statusRows.results ?? []).map((row) => [row.status, Number(row.total) || 0]),
  );
  const orderedStatuses: AnalyticsStatus[] = [
    "confirmed",
    "checked_in",
    "completed",
    "no_show",
    "cancelled",
  ];
  const requestedServices = (serviceRows.results ?? []).map((row) => ({
    service: row.service,
    total: Number(row.total) || 0,
  }));
  const categoryTotals = new Map<ReportingCategory, number>(
    REPORTING_CATEGORIES.map((category) => [category.id, 0]),
  );
  for (const row of requestedServices) {
    const category = reportingCategoryForService(row.service);
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + row.total);
  }
  const completed = statuses.get("completed") ?? 0;
  const noShow = statuses.get("no_show") ?? 0;
  const decided = completed + noShow;

  return {
    window: { days: input.days, from, to, bucketDays },
    branch: input.branch ?? null,
    patients: {
      known,
      new: newPatients,
      returning: Math.max(0, known - newPatients),
      retentionQualified: true,
    },
    trend: buildTrend(trendRows.results ?? [], from, to, bucketDays),
    statuses: orderedStatuses.map((status) => ({
      status,
      total: statuses.get(status) ?? 0,
    })),
    requestedServices,
    categories: REPORTING_CATEGORIES.map((category) => ({
      category: category.id,
      label: category.label,
      total: categoryTotals.get(category.id) ?? 0,
    })),
    attendance: {
      completed,
      noShow,
      decided,
      attendedRate: decided > 0 ? Math.round((completed / decided) * 100) : null,
    },
    sources: (sourceRows.results ?? []).map((row) => ({
      source: row.source || "unknown",
      total: Number(row.total) || 0,
    })),
    practitioners: (practitionerRows.results ?? []).map((row) => ({
      practitioner: row.practitioner,
      total: Number(row.total) || 0,
    })),
  };
}
