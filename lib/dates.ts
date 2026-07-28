/**
 * Calendar helpers that operate on clinic-local (Africa/Cairo) days.
 *
 * Appointment dates are plain calendar days, not instants, so they are handled
 * as `YYYY-MM-DD` strings throughout. Deriving them from `toISOString()` would
 * key them to UTC and shift every booking made after 21:00/22:00 Cairo onto the
 * following day, so all conversions go through `Intl` with an explicit zone.
 */

// Explicit extension so these modules can also be run directly by the Node test
// runner's type stripping, which uses real ESM resolution.
import { CLINIC_TIMEZONE, CLOSED_WEEKDAYS } from "./clinic.ts";

/** `YYYY-MM-DD`. */
export type DateKey = string;

const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const keyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLINIC_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLINIC_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

export function isSlotTime(value: unknown): boolean {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

/** The calendar day it currently is at the clinic. */
export function clinicToday(now: Date = new Date()): DateKey {
  return keyFormatter.format(now);
}

/** The wall-clock time it currently is at the clinic, as `HH:mm`. */
export function clinicTimeNow(now: Date = new Date()): string {
  return timeFormatter.format(now);
}

/**
 * A stable instant inside the given calendar day. Noon UTC is 14:00 or 15:00 in
 * Cairo depending on DST, so it always lands on the same calendar day in both
 * zones and is safe to format or do day arithmetic against.
 */
function middayUtc(key: DateKey): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = middayUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** JS day index (0 = Sunday) for a calendar day. */
export function weekdayIndex(key: DateKey): number {
  return middayUtc(key).getUTCDay();
}

export function isOpenDay(key: DateKey): boolean {
  return !CLOSED_WEEKDAYS.includes(weekdayIndex(key));
}

/**
 * The next `count` open days, starting the day after today. Same-day booking is
 * excluded so the clinic always has notice.
 */
export function openDayKeys(count: number, now: Date = new Date()): DateKey[] {
  const days: DateKey[] = [];
  let cursor = clinicToday(now);
  // Bounded so a misconfigured CLOSED_WEEKDAYS can never spin forever.
  for (let step = 0; step < count * 7 + 14 && days.length < count; step += 1) {
    cursor = addDays(cursor, 1);
    if (isOpenDay(cursor)) days.push(cursor);
  }
  return days;
}

export function formatDayLabel(key: DateKey, locale: string) {
  const instant = middayUtc(key);
  return {
    weekday: new Intl.DateTimeFormat(locale, {
      timeZone: CLINIC_TIMEZONE,
      weekday: "short",
    }).format(instant),
    day: new Intl.DateTimeFormat(locale, {
      timeZone: CLINIC_TIMEZONE,
      day: "2-digit",
      month: "short",
    }).format(instant),
  };
}

export function formatFullDate(key: DateKey, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: CLINIC_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(middayUtc(key));
}
