import assert from "node:assert/strict";
import test from "node:test";
import { buildAppointmentIcs, icsFilename } from "../lib/ics.ts";

const base = {
  id: "a5f1c2d0-0000-4000-8000-000000000001",
  branch: "Maadi",
  service: "aesthetic",
  slotDate: "2026-07-29",
  slotTime: "15:00",
  durationMinutes: 45,
  language: "en",
};

function lines(ics: string) {
  // Unfold first: a folded line continues with a leading space on the next row.
  return ics.replace(/\r\n /g, "").split("\r\n");
}

test("the invite carries the appointment at the right instant", () => {
  const ics = buildAppointmentIcs(base);
  const rows = lines(ics);

  // Cairo runs at UTC+3 in July, so 15:00 local is 12:00Z.
  assert.ok(rows.includes("DTSTART:20260729T120000Z"), ics);
  assert.ok(rows.includes("DTEND:20260729T124500Z"), ics);
});

test("winter appointments use the standard-time offset", () => {
  const rows = lines(buildAppointmentIcs({ ...base, slotDate: "2026-01-15" }));
  assert.ok(rows.includes("DTSTART:20260115T130000Z"));
});

test("the calendar body is a complete, well-formed VCALENDAR", () => {
  const rows = lines(buildAppointmentIcs(base));
  assert.equal(rows[0], "BEGIN:VCALENDAR");
  assert.ok(rows.includes("BEGIN:VEVENT"));
  assert.ok(rows.includes("END:VEVENT"));
  assert.ok(rows.includes("END:VCALENDAR"));
  assert.ok(rows.some((row) => row.startsWith("UID:")));
  assert.ok(rows.some((row) => row.startsWith("DTSTAMP:")));
  // A reminder is the whole point of putting it in a calendar.
  assert.ok(rows.includes("BEGIN:VALARM"));
});

test("commas in an address are escaped rather than splitting the field", () => {
  const rows = lines(buildAppointmentIcs(base));
  const location = rows.find((row) => row.startsWith("LOCATION:"));
  assert.ok(location, "an invite without a location is useless");
  // "Road 9, Maadi, Cairo" must survive as one value.
  assert.ok(location!.includes("\\,"), location);
  assert.ok(!/(?<!\\),/.test(location!.slice("LOCATION:".length)), location);
});

test("every physical line respects the 75-octet fold limit", () => {
  const ics = buildAppointmentIcs(base);
  for (const row of ics.split("\r\n")) {
    assert.ok(row.length <= 75, `line too long: ${row}`);
  }
});

test("the Arabic invite is localised", () => {
  const ics = buildAppointmentIcs({ ...base, language: "ar" });
  assert.match(ics, /المعادي/);
});

test("the manage link is included when supplied", () => {
  const ics = buildAppointmentIcs({
    ...base,
    manageUrl: "https://clinic.example/appointment/token-123",
  });
  assert.match(ics.replace(/\r\n /g, ""), /appointment\/token-123/);
});

test("the invite attributes the stored practitioner", () => {
  const rows = lines(buildAppointmentIcs({
    ...base,
    practitioner: "Dr. Leila Haddad",
  }));
  const summary = rows.find((row) => row.startsWith("SUMMARY:"));
  assert.match(summary ?? "", /Dr\. Leila Haddad/);
});

test("legacy dental invites fall back to the Dental team", () => {
  const rows = lines(buildAppointmentIcs({
    ...base,
    service: "dental-check",
    practitioner: null,
  }));
  const summary = rows.find((row) => row.startsWith("SUMMARY:"));
  assert.match(summary ?? "", /Dental team/);
  assert.doesNotMatch(summary ?? "", /Dr\. Ashraf/);
});

test("legacy non-dental invites fall back to Dr. Ashraf", () => {
  const rows = lines(buildAppointmentIcs({ ...base, practitioner: null }));
  const summary = rows.find((row) => row.startsWith("SUMMARY:"));
  assert.match(summary ?? "", /Dr\. Ashraf Metwally/);
});

test("the filename identifies the visit", () => {
  assert.equal(icsFilename(base), "care-point-2026-07-29-1500.ics");
});
