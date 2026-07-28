import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  clinicToday,
  formatDayLabel,
  isDateKey,
  isOpenDay,
  isSlotTime,
  openDayKeys,
  weekdayIndex,
} from "../lib/dates.ts";
import { AVAILABILITY_WINDOW_DAYS, CLOSED_WEEKDAYS } from "../lib/clinic.ts";

test("clinic days are derived in Cairo, not UTC", () => {
  // 22:30 UTC on 1 March is already 2 March in Cairo (UTC+2). Deriving the day
  // from toISOString() would file a late-evening booking under the wrong date.
  const lateEvening = new Date("2026-03-01T22:30:00.000Z");
  assert.equal(lateEvening.toISOString().slice(0, 10), "2026-03-01");
  assert.equal(clinicToday(lateEvening), "2026-03-02");
});

test("clinic days stay correct across the DST boundary", () => {
  // Egypt observes DST; the offset is +03:00 in summer.
  const summerEvening = new Date("2026-07-28T21:30:00.000Z");
  assert.equal(clinicToday(summerEvening), "2026-07-29");
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("weekdayIndex matches the calendar", () => {
  assert.equal(weekdayIndex("2026-07-26"), 0); // Sunday
  assert.equal(weekdayIndex("2026-07-31"), 5); // Friday
});

test("closed days are excluded from the booking window", () => {
  const days = openDayKeys(AVAILABILITY_WINDOW_DAYS, new Date("2026-07-28T09:00:00.000Z"));
  assert.equal(days.length, AVAILABILITY_WINDOW_DAYS);
  for (const day of days) {
    assert.ok(isOpenDay(day), `${day} should be an open day`);
    assert.ok(!CLOSED_WEEKDAYS.includes(weekdayIndex(day)));
  }
});

test("the booking window starts tomorrow and is strictly increasing", () => {
  const now = new Date("2026-07-28T09:00:00.000Z");
  const days = openDayKeys(AVAILABILITY_WINDOW_DAYS, now);
  assert.ok(days[0] > clinicToday(now), "same-day booking must not be offered");
  for (let index = 1; index < days.length; index += 1) {
    assert.ok(days[index] > days[index - 1], "days must be ordered and unique");
  }
});

test("date keys and slot times are validated strictly", () => {
  assert.ok(isDateKey("2026-07-28"));
  assert.ok(!isDateKey("2026-7-28"));
  assert.ok(!isDateKey("not-a-date"));
  assert.ok(!isDateKey(20260728));

  assert.ok(isSlotTime("09:00"));
  assert.ok(isSlotTime("23:59"));
  assert.ok(!isSlotTime("24:00"));
  assert.ok(!isSlotTime("9:00"));
  assert.ok(!isSlotTime("11:60"));
});

test("day labels render in the requested locale", () => {
  const english = formatDayLabel("2026-07-29", "en-GB");
  assert.equal(english.weekday, "Wed");
  assert.match(english.day, /29/);

  const arabic = formatDayLabel("2026-07-29", "ar-EG");
  assert.ok(arabic.weekday.length > 0);
  assert.notEqual(arabic.weekday, english.weekday);
});
