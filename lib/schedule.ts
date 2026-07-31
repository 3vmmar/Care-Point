/**
 * Clinic scheduling.
 *
 * The prototype modelled availability as one flat list of times per branch,
 * identical every day of the week. Real practices do not work that way: a
 * surgeon is at Maadi on Monday evening and Mohandessin on Tuesday morning,
 * a rhinoplasty consultation needs longer than a laser follow-up, and rooms
 * need turning around between patients.
 *
 * This module is the whole scheduling rule set, expressed as pure functions so
 * every case can be tested without a database or a network. Nothing here reads
 * the clock unless it is handed one.
 *
 *   sessions  →  when a practitioner is physically at a branch
 *   slots     →  the start times a given service can be offered in a session
 *   cells     →  the grid squares a booking occupies, used to detect overlap
 */

import {
  BRANCHES,
  CLINIC_TURNAROUND_MINUTES,
  findBranch,
  findService,
  serviceDuration,
  type Branch,
  type Session,
} from "./clinic.ts";
import { isOpenDay, isSlotTime, weekdayIndex, type DateKey } from "./dates.ts";

/**
 * The resolution occupancy is tracked at.
 *
 * Every session boundary, slot interval and service duration must be a multiple
 * of this, which `validateSchedule` enforces. Fifteen minutes is small enough
 * for real clinic granularity and large enough that an hour-long appointment
 * only occupies four rows.
 */
export const GRID_MINUTES = 15;

/* -------------------------------------------------------------------------- */
/* Time helpers — minutes since midnight, clinic-local                        */
/* -------------------------------------------------------------------------- */

export function toMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function toTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(
    wrapped % 60,
  ).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

/** The sessions a branch runs on a given calendar day. */
export function sessionsOn(branch: Branch, date: DateKey): Session[] {
  if (!isOpenDay(date)) return [];
  const weekday = weekdayIndex(date);
  return branch.sessions.filter((session) => session.weekday === weekday);
}

/** Every practitioner consulting at a branch on a given day. */
export function practitionersOn(branch: Branch, date: DateKey): string[] {
  return Array.from(new Set(sessionsOn(branch, date).map((s) => s.practitioner)));
}

/* -------------------------------------------------------------------------- */
/* Slot generation                                                             */
/* -------------------------------------------------------------------------- */

export type Slot = {
  /** Clinic-local start, `HH:mm`. */
  time: string;
  /** Who is consulting. */
  practitioner: string;
  /** Chair time in minutes, excluding turnaround. */
  durationMinutes: number;
};

/**
 * Start times a service can be booked at, on one day, at one branch.
 *
 * A slot is offered only when the appointment *and* its turnaround fit entirely
 * inside the session. Offering a 19:45 start for a 60-minute consultation in a
 * session that ends at 20:00 is how a clinic ends up running 45 minutes late.
 */
export function generateSlots(
  branch: Branch,
  date: DateKey,
  service: string,
  turnaround: number = CLINIC_TURNAROUND_MINUTES,
): Slot[] {
  const category = findService(service)?.category;
  if (!category) return [];

  const duration = serviceDuration(service);
  const slots: Slot[] = [];

  // A dental appointment cannot be booked into the surgeon's session, and vice
  // versa — they are different people in different rooms.
  for (const session of sessionsOn(branch, date).filter((s) =>
    s.categories.includes(category),
  )) {
    const start = toMinutes(session.start);
    const end = toMinutes(session.end);

    /**
     * Offered starts must not overlap each other.
     *
     * The session's `interval` is the clinic's preferred grid, but a 45-minute
     * consultation on a 30-minute grid would offer 16:00 and 16:30 as if both
     * were available when taking either destroys the other. The step is rounded
     * up to the next whole interval that actually clears the appointment and
     * its turnaround, so every offered time is independently bookable.
     */
    const needed = duration + turnaround;
    const step = Math.ceil(needed / session.interval) * session.interval;

    for (let cursor = start; cursor + needed <= end; cursor += step) {
      slots.push({
        time: toTime(cursor),
        practitioner: session.practitioner,
        durationMinutes: duration,
      });
    }
  }

  // Two sessions can legitimately produce the same start time for different
  // practitioners, so ordering is by time then practitioner rather than unique.
  return slots.sort(
    (a, b) => a.time.localeCompare(b.time) || a.practitioner.localeCompare(b.practitioner),
  );
}

/**
 * Whether a specific start is a real offer.
 *
 * The hold endpoint regenerates the day and checks membership rather than
 * trusting the client, so this is the single definition of "bookable" that both
 * the patient UI and the API answer to.
 */
export function isOfferedSlot(
  branch: Branch,
  date: DateKey,
  service: string,
  time: string,
  practitioner?: string,
): boolean {
  if (!isSlotTime(time)) return false;
  return generateSlots(branch, date, service).some(
    (slot) =>
      slot.time === time && (practitioner ? slot.practitioner === practitioner : true),
  );
}

/* -------------------------------------------------------------------------- */
/* Occupancy                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The grid cells an appointment occupies, including its turnaround.
 *
 * This is what makes variable durations safe. Exact-start uniqueness was enough
 * when every appointment was the same length; it is not enough once a 16:00
 * 60-minute booking and a 16:30 30-minute booking can both exist without
 * sharing a start time. Both map onto the 16:30 cell, so both cannot be
 * written.
 *
 * Returned as `HH:mm` strings because that is what the database column holds.
 */
export function occupiedCells(
  time: string,
  durationMinutes: number,
  turnaround: number = CLINIC_TURNAROUND_MINUTES,
): string[] {
  const start = toMinutes(time);
  const span = durationMinutes + turnaround;
  const cells: string[] = [];

  // Anchored to the grid so a start that is not itself grid-aligned still
  // reserves the cell it sits inside.
  const first = Math.floor(start / GRID_MINUTES) * GRID_MINUTES;
  for (let cursor = first; cursor < start + span; cursor += GRID_MINUTES) {
    cells.push(toTime(cursor));
  }
  return cells;
}

/** Do two appointments at the same branch and practitioner overlap? */
export function overlaps(
  a: { time: string; durationMinutes: number },
  b: { time: string; durationMinutes: number },
  turnaround: number = CLINIC_TURNAROUND_MINUTES,
): boolean {
  const aCells = new Set(occupiedCells(a.time, a.durationMinutes, turnaround));
  return occupiedCells(b.time, b.durationMinutes, turnaround).some((cell) =>
    aCells.has(cell),
  );
}

/* -------------------------------------------------------------------------- */
/* Capacity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How many appointments of a given service a day could hold at full occupancy.
 *
 * Used by the dashboard so "how full are we" is measured against what the
 * clinic can actually deliver, rather than against a hardcoded number that goes
 * stale the moment opening hours change.
 */
export function dayCapacity(
  date: DateKey,
  service = "aesthetic",
  branchId?: string,
): number {
  const branches = branchId ? [findBranch(branchId)].filter(Boolean) : BRANCHES;
  return (branches as Branch[]).reduce(
    (total, branch) => total + generateSlots(branch, date, service).length,
    0,
  );
}

/* -------------------------------------------------------------------------- */
/* Configuration validation                                                    */
/* -------------------------------------------------------------------------- */

export type ScheduleProblem = { branch: string; message: string };

/**
 * Checks the hand-edited schedule in `lib/clinic.ts` for the mistakes that are
 * easy to make and expensive to discover: a session that ends before it starts,
 * times off the grid, or two practitioners double-booked into one room.
 *
 * Run as a test, so a bad edit fails CI rather than the clinic's Tuesday.
 */
export function validateSchedule(branches: Branch[] = BRANCHES): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];

  for (const branch of branches) {
    if (branch.sessions.length === 0) {
      problems.push({ branch: branch.id, message: "has no sessions at all" });
    }

    for (const session of branch.sessions) {
      const label = `${dayName(session.weekday)} ${session.start}–${session.end} (${session.practitioner})`;

      if (!isSlotTime(session.start) || !isSlotTime(session.end)) {
        problems.push({ branch: branch.id, message: `${label}: times must be HH:mm` });
        continue;
      }
      if (session.weekday < 0 || session.weekday > 6) {
        problems.push({ branch: branch.id, message: `${label}: weekday out of range` });
      }
      if (toMinutes(session.end) <= toMinutes(session.start)) {
        problems.push({ branch: branch.id, message: `${label}: ends before it starts` });
      }
      for (const [name, value] of [
        ["start", session.start],
        ["end", session.end],
      ] as const) {
        if (toMinutes(value) % GRID_MINUTES !== 0) {
          problems.push({
            branch: branch.id,
            message: `${label}: ${name} must fall on a ${GRID_MINUTES}-minute boundary`,
          });
        }
      }
      if (session.interval % GRID_MINUTES !== 0 || session.interval <= 0) {
        problems.push({
          branch: branch.id,
          message: `${label}: interval must be a positive multiple of ${GRID_MINUTES}`,
        });
      }
      if (!session.practitioner.trim()) {
        problems.push({ branch: branch.id, message: `${label}: missing practitioner` });
      }
    }

    // Two sessions for the same practitioner on the same day must not overlap —
    // nobody is in two rooms at once.
    for (let i = 0; i < branch.sessions.length; i += 1) {
      for (let j = i + 1; j < branch.sessions.length; j += 1) {
        const a = branch.sessions[i];
        const b = branch.sessions[j];
        if (a.weekday !== b.weekday || a.practitioner !== b.practitioner) continue;
        if (toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)) {
          problems.push({
            branch: branch.id,
            message: `${a.practitioner} has overlapping sessions on ${dayName(a.weekday)}`,
          });
        }
      }
    }
  }

  // A practitioner cannot be at two branches at once either.
  const seen = new Map<string, { branch: string; start: number; end: number }[]>();
  for (const branch of branches) {
    for (const session of branch.sessions) {
      const key = `${session.practitioner}|${session.weekday}`;
      const existing = seen.get(key) ?? [];
      for (const other of existing) {
        if (
          other.branch !== branch.id &&
          toMinutes(session.start) < other.end &&
          other.start < toMinutes(session.end)
        ) {
          problems.push({
            branch: branch.id,
            message: `${session.practitioner} is also at ${other.branch} on ${dayName(session.weekday)} at the same time`,
          });
        }
      }
      existing.push({
        branch: branch.id,
        start: toMinutes(session.start),
        end: toMinutes(session.end),
      });
      seen.set(key, existing);
    }
  }

  return problems;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function dayName(weekday: number): string {
  return DAY_NAMES[weekday] ?? `day ${weekday}`;
}
