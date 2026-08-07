import { env } from "cloudflare:workers";
import { ensureBookingSchema } from "@/db/bookings";
import { dayCapacity, type ScheduleContext } from "@/lib/schedule";
import { addDays, clinicInstant, clinicToday, isOpenDay, type DateKey } from "@/lib/dates";

/**
 * Growth, demand and operational analytics for the Clinic OS executive view.
 *
 * Separate from `getClinicAnalytics` on purpose: that one answers "what does
 * this reporting window look like" for the Insights page, and is already six
 * parallel queries. This one answers "is the practice growing, and when is it
 * busy", which nobody needs while reading the Insights panel and which is
 * wasteful to compute on a page that does not show it.
 *
 * EVERY METRIC CARRIES ITS OWN SUFFICIENCY. A clinic that has taken four
 * bookings does not have a no-show rate, and rendering one as a confident
 * "0%" is worse than rendering nothing — it invites a decision the data cannot
 * support. Callers are expected to show the shortfall, not the number.
 *
 * WHAT THIS DELIBERATELY DOES NOT MEASURE, because the data does not exist:
 *
 *  - Revenue. There is no price, payment or invoice anywhere in the schema.
 *  - Booking funnel / abandonment. `releaseExpiredHolds` DELETEs expired holds
 *    every ten minutes, so abandoned bookings are not retained to be counted.
 *  - Waiting time. There is a check-in timestamp and a completion timestamp,
 *    but no "consultation started" event, so the gap a patient actually waits
 *    in the waiting room is not recorded. `punctuality` below measures
 *    something real and different: how close to the appointed time people
 *    arrive.
 */

/** How far back patient identity can be linked at all. Contact details are
 *  cleared by the retention job, and a purged row has no phone number, so it
 *  cannot be matched to the person's later visits. A patient of four years
 *  therefore reappears as "new" once their early visits age out. This is a
 *  property of the privacy policy, not a bug, and it bounds every cohort
 *  number on this page. */
export const IDENTITY_HORIZON_DAYS = 540;

export type Sufficiency = {
  ok: boolean;
  /** How many records the figure is actually derived from. */
  sample: number;
  required: number;
  reason?: string;
};

const sufficiency = (sample: number, required: number, reason?: string): Sufficiency => ({
  ok: sample >= required,
  sample,
  required,
  ...(sample >= required ? {} : { reason }),
});

export type PeriodComparison = {
  current: { from: DateKey; to: DateKey; total: number };
  previous: { from: DateKey; to: DateKey; total: number };
  /** Null when the previous period is zero — 0 → 5 is not "infinite growth",
   *  and a percentage there is a number that cannot be reasoned about. */
  changePercent: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  sufficiency: Sufficiency;
};

export type ClinicGrowth = {
  window: { days: number; from: DateKey; to: DateKey };
  branch: string | null;
  appointments: PeriodComparison;
  newPatients: PeriodComparison;
  months: Array<{
    month: string;
    total: number;
    /** Distinct PEOPLE whose first linkable visit fell in this month. */
    newPatients: number;
    /** APPOINTMENTS that were someone's first, and someone's return. These two
     *  are row counts and sum to `total`; `newPatients` is a head count and
     *  deliberately does not. */
    newVisits: number;
    returning: number;
    /** True once the month is entirely in the past. A month still running
     *  looks like a collapse next to its neighbours unless it says so. */
    complete: boolean;
  }>;
  monthsSufficiency: Sufficiency;
  demandByHour: Array<{ hour: number; total: number }>;
  demandByWeekday: Array<{ weekday: number; total: number }>;
  leadTime: {
    buckets: Array<{ label: string; minDays: number; maxDays: number | null; total: number }>;
    medianDays: number | null;
    sufficiency: Sufficiency;
  };
  utilisation: {
    days: Array<{ date: DateKey; booked: number; capacity: number; percent: number }>;
    averagePercent: number | null;
    sufficiency: Sufficiency;
  };
  punctuality: {
    /** Minutes relative to the appointed time. Negative is early. */
    medianMinutes: number | null;
    earlyOrOnTime: number;
    late: number;
    sufficiency: Sufficiency;
  };
  consultation: {
    medianMinutes: number | null;
    sufficiency: Sufficiency;
  };
  /**
   * How scheduled visits actually ended. Separate from `appointments`, which
   * counts what was booked: a practice can be growing and losing a fifth of
   * its slots to no-shows at the same time, and only one of those two numbers
   * tells them to start reminding people.
   */
  outcomes: {
    completed: number;
    /**
     * Checked in but not yet marked completed. These patients demonstrably
     * turned up: excluding them from the denominator was a real defect, and it
     * failed in the worst direction — a desk that checks people in but never
     * presses Completed would have been told its no-show rate was four times
     * what it is, on the same screen that shows their arrival times.
     */
    checkedIn: number;
    noShow: number;
    cancelled: number;
    /** Turned up: completed + checked in. */
    arrived: number;
    /** Arrived + no-show: every visit whose attendance is actually known. */
    decided: number;
    noShowRate: number | null;
    sufficiency: Sufficiency;
  };
  identityHorizonDays: number;
};

type GrowthInput = {
  days: number;
  branch?: string;
  today?: DateKey;
  /** Passed in rather than read here. A db module that reaches for request
   *  context cannot be loaded by the Workers test pool — that mistake once
   *  made the whole integration suite silently run zero tests. */
  schedule?: ScheduleContext;
  /** Services counted toward published capacity, from the live catalogue. */
  capacityServices?: string[];
};

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

/** The nine-digit match used everywhere patient identity is joined. It folds
 *  the local and international forms of an Egyptian mobile into one key
 *  without ever returning the number itself. */
const PATIENT_KEY = `substr(
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(patient_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''),
  -9
)`;

/** Statuses that represent a real appointment. `held` is excluded everywhere:
 *  a hold is an intention, not a booking, and expired ones are deleted. */
const REAL = `status <> 'held'`;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
};

function compare(
  currentTotal: number,
  previousTotal: number,
  current: { from: DateKey; to: DateKey },
  previous: { from: DateKey; to: DateKey },
  required: number,
  reason: string,
): PeriodComparison {
  const changePercent =
    previousTotal > 0
      ? Math.round(((currentTotal - previousTotal) / previousTotal) * 1000) / 10
      : null;
  return {
    current: { ...current, total: currentTotal },
    previous: { ...previous, total: previousTotal },
    changePercent,
    direction:
      changePercent === null
        ? "unknown"
        : changePercent > 0
          ? "up"
          : changePercent < 0
            ? "down"
            : "flat",
    sufficiency: sufficiency(currentTotal + previousTotal, required, reason),
  };
}

/** Patients whose first linkable visit falls inside a period. */
function newPatientCount(
  db: D1Database,
  periodFrom: DateKey,
  periodTo: DateKey,
  branch: string | undefined,
  bind: (...values: unknown[]) => unknown[],
) {
  return db
    .prepare(
      `WITH retained AS (
         SELECT ${PATIENT_KEY} AS patientKey, slot_date AS slotDate, branch
         FROM appointments
         WHERE ${REAL} AND patient_phone IS NOT NULL AND TRIM(patient_phone) <> ''
       ),
       firstVisit AS (
         SELECT patientKey, MIN(slotDate) AS firstDate FROM retained GROUP BY patientKey
       )
       SELECT COUNT(*) AS total FROM firstVisit
       WHERE firstDate BETWEEN ? AND ?
         ${branch ? "AND patientKey IN (SELECT patientKey FROM retained WHERE branch = ?)" : ""}`,
    )
    .bind(...bind(periodFrom, periodTo))
    .first<{ total: number }>();
}

export async function getClinicGrowth(input: GrowthInput): Promise<ClinicGrowth> {
  await ensureBookingSchema();
  const db = database();

  const to = input.today ?? clinicToday();
  const from = addDays(to, -(input.days - 1));
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(input.days - 1));
  const branch = input.branch;
  const branchClause = branch ? " AND branch = ?" : "";
  const bind = (...values: unknown[]) => (branch ? [...values, branch] : values);

  // Twelve months back, or the identity horizon, whichever is shorter — past
  // that point cohort membership is an artefact of the retention job.
  const monthsFrom = addDays(to, -Math.min(365, IDENTITY_HORIZON_DAYS));

  const [
    currentRow,
    previousRow,
    newCurrentRow,
    newPreviousRow,
    monthRows,
    hourRows,
    weekdayRows,
    leadRows,
    bookedRows,
    punctualityRows,
    durationRows,
    outcomeRows,
  ] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM appointments WHERE ${REAL} AND slot_date BETWEEN ? AND ?${branchClause}`)
      .bind(...bind(from, to))
      .first<{ total: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM appointments WHERE ${REAL} AND slot_date BETWEEN ? AND ?${branchClause}`)
      .bind(...bind(previousFrom, previousTo))
      .first<{ total: number }>(),

    // A patient is "new in this period" when their first linkable visit falls
    // inside it. Computed against every retained row, not just the window, or
    // everyone looks new. Written out twice rather than mapped: a spread
    // inside Promise.all collapses the tuple to a union and every row below
    // loses its type.
    newPatientCount(db, from, to, branch, bind),
    newPatientCount(db, previousFrom, previousTo, branch, bind),

    /**
     * Three counts that mean three different things, and used to mean two.
     *
     * `returningVisits` was previously derived as total - newPatients, which
     * subtracted a count of PEOPLE from a count of ROWS: a first-time patient
     * booked for a consultation and a same-day laser session produced one
     * "returning" visit out of thin air, and the clamp guarding it meant the
     * error only ever flattered retention. Both visit counts are row counts
     * now and sum to `total` by construction; `newPatients` stays a head count
     * because the growth comparison is about people, not appointments.
     */
    db
      .prepare(
        `WITH retained AS (
           SELECT ${PATIENT_KEY} AS patientKey, slot_date AS slotDate, branch
           FROM appointments
           WHERE ${REAL} AND patient_phone IS NOT NULL AND TRIM(patient_phone) <> ''
         ),
         firstVisit AS (
           SELECT patientKey, MIN(slotDate) AS firstDate FROM retained GROUP BY patientKey
         )
         SELECT substr(a.slot_date, 1, 7) AS month,
                COUNT(*) AS total,
                SUM(CASE WHEN f.firstDate = a.slot_date THEN 1 ELSE 0 END) AS newVisits,
                SUM(CASE WHEN f.firstDate = a.slot_date THEN 0 ELSE 1 END) AS returningVisits,
                COUNT(DISTINCT CASE
                  WHEN f.firstDate = a.slot_date THEN ${PATIENT_KEY} END) AS newPatients
         FROM appointments a
         LEFT JOIN firstVisit f ON f.patientKey = ${PATIENT_KEY}
         WHERE ${REAL} AND a.slot_date BETWEEN ? AND ?${branchClause}
         GROUP BY month ORDER BY month`,
      )
      .bind(...bind(monthsFrom, to))
      .all<{
        month: string;
        total: number;
        newVisits: number;
        returningVisits: number;
        newPatients: number;
      }>(),

    db
      .prepare(
        `SELECT CAST(substr(slot_time, 1, 2) AS INTEGER) AS hour, COUNT(*) AS total
         FROM appointments WHERE ${REAL} AND slot_date BETWEEN ? AND ?${branchClause}
         GROUP BY hour ORDER BY hour`,
      )
      .bind(...bind(from, to))
      .all<{ hour: number; total: number }>(),

    db
      .prepare(
        `SELECT CAST(strftime('%w', slot_date) AS INTEGER) AS weekday, COUNT(*) AS total
         FROM appointments WHERE ${REAL} AND slot_date BETWEEN ? AND ?${branchClause}
         GROUP BY weekday ORDER BY weekday`,
      )
      .bind(...bind(from, to))
      .all<{ weekday: number; total: number }>(),

    // How far ahead people book. Uses confirmed_at, because that is when the
    // decision was made; created_at is when the hold opened.
    db
      .prepare(
        `SELECT CAST(julianday(slot_date) - julianday(substr(confirmed_at, 1, 10)) AS INTEGER) AS leadDays
         FROM appointments
         WHERE ${REAL} AND confirmed_at IS NOT NULL
           AND slot_date BETWEEN ? AND ?${branchClause}`,
      )
      .bind(...bind(from, to))
      .all<{ leadDays: number }>(),

    db
      .prepare(
        `SELECT slot_date AS date, COUNT(*) AS booked
         FROM appointments
         WHERE status IN ('confirmed','checked_in','completed','no_show')
           AND slot_date BETWEEN ? AND ?${branchClause}
         GROUP BY slot_date ORDER BY slot_date`,
      )
      .bind(...bind(from, to))
      .all<{ date: DateKey; booked: number }>(),

    db
      .prepare(
        `SELECT slot_date AS slotDate, slot_time AS slotTime, checked_in_at AS checkedInAt
         FROM appointments
         WHERE checked_in_at IS NOT NULL AND slot_date BETWEEN ? AND ?${branchClause}`,
      )
      .bind(...bind(from, to))
      .all<{ slotDate: DateKey; slotTime: string; checkedInAt: string }>(),

    // Duration is check-in to completion. Only meaningful where staff pressed
    // both buttons as it happened; a visit completed retrospectively at the
    // end of the day would report hours. Outliers are filtered below.
    db
      .prepare(
        `SELECT checked_in_at AS checkedInAt, status_updated_at AS completedAt
         FROM appointments
         WHERE status = 'completed' AND checked_in_at IS NOT NULL
           AND status_updated_at IS NOT NULL
           AND slot_date BETWEEN ? AND ?${branchClause}`,
      )
      .bind(...bind(from, to))
      .all<{ checkedInAt: string; completedAt: string }>(),

    // How the window's visits ended. Grouped rather than five COUNT(*)s so
    // this stays one scan of the same index the other date-ranged reads use.
    db
      .prepare(
        `SELECT status, COUNT(*) AS total
         FROM appointments
         WHERE ${REAL} AND slot_date BETWEEN ? AND ?${branchClause}
         GROUP BY status`,
      )
      .bind(...bind(from, to))
      .all<{ status: string; total: number }>(),
  ]);

  // ---------------------------------------------------------------- months
  const monthTotals = (monthRows.results ?? []).map((row) => {
    const total = Number(row.total) || 0;
    return {
      month: row.month,
      total,
      /** Distinct people whose first linkable visit fell in this month. */
      newPatients: Number(row.newPatients) || 0,
      /** Appointments belonging to a first visit, and to a later one. Both are
       *  row counts, so newVisits + returning === total. */
      newVisits: Number(row.newVisits) || 0,
      returning: Number(row.returningVisits) || 0,
      complete: row.month < to.slice(0, 7),
    };
  });

  // ------------------------------------------------------------- lead time
  const leadValues = (leadRows.results ?? [])
    .map((row) => Number(row.leadDays))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const LEAD_BUCKETS: Array<{ label: string; minDays: number; maxDays: number | null }> = [
    { label: "Same day", minDays: 0, maxDays: 0 },
    { label: "1–2 days", minDays: 1, maxDays: 2 },
    { label: "3–7 days", minDays: 3, maxDays: 7 },
    { label: "8–14 days", minDays: 8, maxDays: 14 },
    { label: "15+ days", minDays: 15, maxDays: null },
  ];

  // ----------------------------------------------------------- utilisation
  const bookedByDate = new Map(
    (bookedRows.results ?? []).map((row) => [row.date, Number(row.booked) || 0]),
  );
  const utilisationDays: ClinicGrowth["utilisation"]["days"] = [];
  const capacityServices = input.capacityServices ?? [];
  if (capacityServices.length > 0) {
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      // Closures come from the live catalogue when one was supplied, so an
      // edited rota is reflected here rather than in the constants it seeded.
      if (!isOpenDay(cursor, input.schedule?.closures)) continue;
      const capacity = capacityServices.reduce(
        (sum, service) => sum + dayCapacity(cursor, service, branch, input.schedule),
        0,
      );
      if (capacity <= 0) continue;
      const booked = bookedByDate.get(cursor) ?? 0;
      utilisationDays.push({
        date: cursor,
        booked,
        capacity,
        percent: Math.round((booked / capacity) * 100),
      });
    }
  }
  /**
   * The AGGREGATE share of capacity, not the mean of per-day shares.
   *
   * Those differ whenever days vary in size, and both cards that read this
   * claim the aggregate ("X% of published capacity is being used"). A mean of
   * ratios over-weights a quiet four-slot day against a full sixteen-slot one,
   * so the headline was asserting something its own denominator did not say.
   */
  const capacityTotals = utilisationDays.reduce(
    (sum, day) => ({ booked: sum.booked + day.booked, capacity: sum.capacity + day.capacity }),
    { booked: 0, capacity: 0 },
  );
  const averagePercent =
    capacityTotals.capacity > 0
      ? Math.round((capacityTotals.booked / capacityTotals.capacity) * 100)
      : null;

  // ----------------------------------------------------------- punctuality
  const punctualityValues: number[] = [];
  for (const row of punctualityRows.results ?? []) {
    const appointed = clinicInstant(row.slotDate, row.slotTime).getTime();
    const arrived = Date.parse(row.checkedInAt);
    if (!Number.isFinite(arrived)) continue;
    const minutes = Math.round((arrived - appointed) / 60000);
    // Beyond four hours either side this is a retrospective correction by a
    // receptionist tidying the day, not a record of when somebody walked in.
    if (Math.abs(minutes) > 240) continue;
    punctualityValues.push(minutes);
  }

  // ------------------------------------------------------------- duration
  const durationValues: number[] = [];
  for (const row of durationRows.results ?? []) {
    const start = Date.parse(row.checkedInAt);
    const end = Date.parse(row.completedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const minutes = Math.round((end - start) / 60000);
    if (minutes <= 0 || minutes > 240) continue;
    durationValues.push(minutes);
  }

  const currentTotal = Number(currentRow?.total) || 0;
  const previousTotal = Number(previousRow?.total) || 0;

  return {
    window: { days: input.days, from, to },
    branch: branch ?? null,
    appointments: compare(
      currentTotal,
      previousTotal,
      { from, to },
      { from: previousFrom, to: previousTo },
      20,
      "Fewer than 20 appointments across both periods — a percentage swing here reflects individual bookings rather than a trend.",
    ),
    newPatients: compare(
      Number(newCurrentRow?.total) || 0,
      Number(newPreviousRow?.total) || 0,
      { from, to },
      { from: previousFrom, to: previousTo },
      10,
      "Fewer than 10 first-time patients across both periods.",
    ),
    months: monthTotals,
    monthsSufficiency: sufficiency(
      monthTotals.filter((month) => month.complete && month.total > 0).length,
      2,
      "At least two complete months are needed before a trend line means anything.",
    ),
    demandByHour: (hourRows.results ?? []).map((row) => ({
      hour: Number(row.hour) || 0,
      total: Number(row.total) || 0,
    })),
    demandByWeekday: (weekdayRows.results ?? []).map((row) => ({
      weekday: Number(row.weekday) || 0,
      total: Number(row.total) || 0,
    })),
    leadTime: {
      buckets: LEAD_BUCKETS.map((bucket) => ({
        ...bucket,
        total: leadValues.filter(
          (value) =>
            value >= bucket.minDays && (bucket.maxDays === null || value <= bucket.maxDays),
        ).length,
      })),
      medianDays: median(leadValues),
      sufficiency: sufficiency(
        leadValues.length,
        10,
        "Fewer than 10 confirmed bookings carry a booking date in this window.",
      ),
    },
    utilisation: {
      days: utilisationDays,
      averagePercent,
      sufficiency: sufficiency(
        utilisationDays.length,
        3,
        capacityServices.length === 0
          ? "No consultation types were supplied, so published capacity cannot be derived."
          : "Fewer than 3 open days with published capacity fall in this window.",
      ),
    },
    punctuality: {
      medianMinutes: median(punctualityValues),
      earlyOrOnTime: punctualityValues.filter((value) => value <= 0).length,
      late: punctualityValues.filter((value) => value > 0).length,
      sufficiency: sufficiency(
        punctualityValues.length,
        10,
        "Fewer than 10 visits have been checked in. This measures arrival against the appointed time, and only exists where reception checks patients in as they arrive.",
      ),
    },
    consultation: {
      medianMinutes: median(durationValues),
      sufficiency: sufficiency(
        durationValues.length,
        10,
        "Fewer than 10 visits carry both a check-in and a completion time. This is derived from when staff pressed those buttons, so it measures room time only where the dashboard is used live.",
      ),
    },
    outcomes: (() => {
      const byStatus = new Map(
        (outcomeRows.results ?? []).map((row) => [row.status, Number(row.total) || 0]),
      );
      const completed = byStatus.get("completed") ?? 0;
      const checkedIn = byStatus.get("checked_in") ?? 0;
      const noShow = byStatus.get("no_show") ?? 0;
      const cancelled = byStatus.get("cancelled") ?? 0;
      const arrived = completed + checkedIn;
      const decided = arrived + noShow;
      return {
        completed,
        checkedIn,
        noShow,
        cancelled,
        arrived,
        decided,
        // Denominator is decided visits, not everything booked: a future
        // appointment has not failed to show up yet, and counting it as
        // attended would flatter the rate every single day.
        noShowRate: decided > 0 ? Math.round((noShow / decided) * 1000) / 10 : null,
        sufficiency: sufficiency(
          decided,
          10,
          "Fewer than 10 visits have a known outcome, so a rate here would move by ten points on one patient.",
        ),
      };
    })(),
    identityHorizonDays: IDENTITY_HORIZON_DAYS,
  };
}
