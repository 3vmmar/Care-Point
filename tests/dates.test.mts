import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  addMinutesToSlot,
  clinicInstant,
  clinicTimeNow,
  clinicToday,
  daysBetween,
  formatDayLabel,
  formatSlotTime,
  isDateKey,
  isOpenDay,
  isSlotBookable,
  isSlotTime,
  openDayKeys,
  weekdayIndex,
} from "../lib/dates.ts";
import {
  AVAILABILITY_WINDOW_DAYS,
  BOOKING_LEAD_HOURS,
  CLOSED_WEEKDAYS,
} from "../lib/clinic.ts";

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

test("daysBetween counts whole calendar days in both directions", () => {
  assert.equal(daysBetween("2026-07-28", "2026-08-04"), 7);
  assert.equal(daysBetween("2026-08-04", "2026-07-28"), -7);
  assert.equal(daysBetween("2026-07-28", "2026-07-28"), 0);
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

test("the booking window opens today and is strictly increasing", () => {
  const now = new Date("2026-07-28T09:00:00.000Z");
  const days = openDayKeys(AVAILABILITY_WINDOW_DAYS, now);
  // Same-day booking is governed per slot by lead time, not by discarding the
  // whole day — a clinic open until 20:30 can still take an 18:00 booking.
  assert.equal(days[0], clinicToday(now));
  for (let index = 1; index < days.length; index += 1) {
    assert.ok(days[index] > days[index - 1], "days must be ordered and unique");
  }
});

test("clinicInstant resolves a clinic wall-clock time to the right instant", () => {
  // Summer: Cairo runs at UTC+3, so 15:00 local is 12:00Z.
  assert.equal(
    clinicInstant("2026-07-29", "15:00").toISOString(),
    "2026-07-29T12:00:00.000Z",
  );
  // Winter: UTC+2, so the same wall clock is 13:00Z.
  assert.equal(
    clinicInstant("2026-01-15", "15:00").toISOString(),
    "2026-01-15T13:00:00.000Z",
  );
});

test("clinic wall-clock conversion survives every day and both DST transitions", () => {
  const deltas: number[] = [];
  let day = "2026-01-01";
  let previous: Date | null = null;

  for (let index = 0; index < 365; index += 1) {
    const instant = clinicInstant(day, "12:00");
    assert.equal(clinicToday(instant), day, `${day} changed calendar day`);
    assert.equal(clinicTimeNow(instant), "12:00", `${day} changed wall-clock time`);

    if (previous) deltas.push((instant.getTime() - previous.getTime()) / 3_600_000);
    previous = instant;
    day = addDays(day, 1);
  }

  // Cairo moves noon by one UTC hour in spring and restores it in autumn.
  // A missing transition or an invented third jump means the runtime timezone
  // data and our conversion algorithm no longer agree.
  assert.equal(deltas.filter((hours) => hours !== 24).length, 2);
  assert.ok(deltas.includes(23), "the spring-forward transition was not observed");
  assert.ok(deltas.includes(25), "the autumn rollback transition was not observed");
});

test("lead time keeps imminent slots out of the offered window", () => {
  const date = "2026-07-29"; // 15:00 local === 12:00Z
  assert.equal(BOOKING_LEAD_HOURS, 4);

  // Five hours ahead: bookable.
  assert.ok(isSlotBookable(date, "15:00", new Date("2026-07-29T07:00:00.000Z")));
  // Three hours ahead: inside the notice period, so it must not be offered.
  assert.ok(!isSlotBookable(date, "15:00", new Date("2026-07-29T09:00:00.000Z")));
  // Already past.
  assert.ok(!isSlotBookable(date, "15:00", new Date("2026-07-29T13:00:00.000Z")));
});

test("lead time is exact at the boundary", () => {
  // Exactly four hours before must still be accepted, or the UI and the hold
  // endpoint disagree about the very slot the patient just clicked.
  assert.ok(isSlotBookable("2026-07-29", "15:00", new Date("2026-07-29T08:00:00.000Z")));
});

test("Friday is bookable now, and an explicit closure still is not", () => {
  // 2026-07-31 is a Friday. It was the clinic's weekly closed day until
  // 2026-08-07, when the practice moved every branch to seven days.
  assert.equal(weekdayIndex("2026-07-31"), 5);
  assert.ok(isSlotBookable("2026-07-31", "15:00", new Date("2026-07-20T06:00:00.000Z")));
  // The one-off closure mechanism — Eid, holidays, planned leave — is untouched.
  assert.ok(!isOpenDay("2026-07-31", [{ date: "2026-07-31" }]));
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

test("slot times render as 12-hour for staff surfaces", () => {
  assert.match(formatSlotTime("15:00"), /3[:.]00/);
  assert.match(formatSlotTime("09:30"), /9[:.]30/);
  // Anything that is not a slot time is passed through untouched.
  assert.equal(formatSlotTime("nonsense"), "nonsense");
});

test("appointment end times wrap correctly", () => {
  assert.equal(addMinutesToSlot("15:00", 45), "15:45");
  assert.equal(addMinutesToSlot("23:30", 60), "00:30");
  assert.equal(addMinutesToSlot("10:30", 90), "12:00");
});
