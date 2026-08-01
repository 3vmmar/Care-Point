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
import {
  BOOKING_LEAD_HOURS,
  CLINIC_TIMEZONE,
  CLOSED_WEEKDAYS,
  isClosureDate,
} from "./clinic.ts";

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
  hourCycle: "h23",
});

/** Used to recover the clinic's UTC offset at a given instant, DST included. */
const offsetProbe = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLINIC_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
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

/** Milliseconds the clinic is ahead of UTC at `instant` (+2h EET, +3h EEST). */
function clinicOffsetMs(instant: Date): number {
  const parts = offsetProbe.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  // Sub-second precision is irrelevant here and would only add jitter.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The exact instant a clinic-local `YYYY-MM-DD HH:mm` falls on.
 *
 * The offset has to be probed twice: the first probe uses a guessed instant,
 * and near a DST transition that guess can land on the wrong side of the jump.
 * Re-probing with the corrected instant settles it.
 */
export function clinicInstant(key: DateKey, time: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);

  const firstGuess = naive - clinicOffsetMs(new Date(naive));
  const secondOffset = clinicOffsetMs(new Date(firstGuess));
  return new Date(naive - secondOffset);
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

/** Whole days from `from` to `to`, negative when `to` is in the past. */
export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round(
    (middayUtc(to).getTime() - middayUtc(from).getTime()) / 86_400_000,
  );
}

/** JS day index (0 = Sunday) for a calendar day. */
export function weekdayIndex(key: DateKey): number {
  return middayUtc(key).getUTCDay();
}

/**
 * True when the clinic trades on this day: not a closed weekday, not a closure.
 *
 * `closures` overrides the static list in `lib/clinic.ts` — the clinic's real
 * holiday calendar now lives in D1 so reception can add Eid without a deploy.
 * Omitting it falls back to the constants, which keeps every existing caller and
 * the pure tests working unchanged.
 */
export function isOpenDay(
  key: DateKey,
  closures?: readonly { date: string }[],
): boolean {
  if (CLOSED_WEEKDAYS.includes(weekdayIndex(key))) return false;
  return closures
    ? !closures.some((closure) => closure.date === key)
    : !isClosureDate(key);
}

/**
 * The next `count` open days, starting with today.
 *
 * Today is included because same-day booking is governed by lead time per slot
 * (`isSlotBookable`) rather than by discarding the whole day — a clinic that
 * opens until 20:30 should still be able to take an 18:00 booking at midday.
 */
export function openDayKeys(
  count: number,
  now: Date = new Date(),
  closures?: readonly { date: string }[],
): DateKey[] {
  const days: DateKey[] = [];
  let cursor = clinicToday(now);
  if (isOpenDay(cursor, closures)) days.push(cursor);
  // Bounded so a misconfigured CLOSED_WEEKDAYS can never spin forever.
  for (let step = 0; step < count * 7 + 30 && days.length < count; step += 1) {
    cursor = addDays(cursor, 1);
    if (isOpenDay(cursor, closures)) days.push(cursor);
  }
  return days;
}

/**
 * Whether a slot is far enough in the future to be offered. This is the single
 * rule the availability API and the hold endpoint both apply, so the UI can
 * never show a time the server would then refuse.
 */
export function isSlotBookable(
  key: DateKey,
  time: string,
  now: Date = new Date(),
  leadHours: number = BOOKING_LEAD_HOURS,
): boolean {
  if (!isDateKey(key) || !isSlotTime(time) || !isOpenDay(key)) return false;
  const start = clinicInstant(key, time).getTime();
  return start - now.getTime() >= leadHours * 3_600_000;
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

/** `Sat 01 Aug` — the compact form the dashboard uses in tables and headers. */
export function formatShortDate(key: DateKey, locale = "en-GB") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(middayUtc(key));
}

/** `15:00` → `3:00 PM`, for staff-facing surfaces where 12h reads faster. */
export function formatSlotTime(time: string, locale = "en-GB") {
  if (!isSlotTime(time)) return time;
  const [hour, minute] = time.split(":").map(Number);
  // The value is already clinic-local wall-clock time, so the anchor instant is
  // read back in UTC. Without this the viewer's own zone shifts the label.
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

/** The slot time `minutes` after `time`, used to close a calendar invite. */
export function addMinutesToSlot(time: string, minutes: number): string {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(
    wrapped % 60,
  ).padStart(2, "0")}`;
}
