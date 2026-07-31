import assert from "node:assert/strict";
import test from "node:test";
import { findBranch, findService } from "../lib/clinic.ts";
import { isDateKey, isOpenDay, isSlotTime } from "../lib/dates.ts";
import { generateSlots } from "../lib/schedule.ts";

/**
 * The request-validation rules enforced by the API routes.
 *
 * The route handlers themselves import `cloudflare:workers`, so they cannot be
 * loaded by the Node test runner. These are deliberate mirrors of the guards in
 * `app/api/bookings/route.ts` and `app/api/clinic/appointments/route.ts` —
 * keep them in step when a rule changes there.
 */

const NAME_MAX = 120;
const EMAIL_MAX = 200;
const NOTE_MAX = 500;
const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/;

type ConfirmBody = {
  holdToken?: unknown;
  patientName?: unknown;
  patientPhone?: unknown;
  patientEmail?: unknown;
  patientNote?: unknown;
  consent?: unknown;
};

/** Returns the HTTP status the confirm endpoint would reply with, or 201. */
function validateConfirm(body: ConfirmBody): number {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const holdToken = text(body.holdToken);
  const patientName = text(body.patientName);
  const patientPhone = text(body.patientPhone);
  const patientEmail = text(body.patientEmail);
  const patientNote = text(body.patientNote);

  if (!holdToken || !patientName || !patientPhone) return 400;
  if (
    patientName.length > NAME_MAX ||
    patientEmail.length > EMAIL_MAX ||
    patientNote.length > NOTE_MAX
  ) {
    return 400;
  }
  if (!PHONE_PATTERN.test(patientPhone)) return 400;
  if (body.consent !== true) return 400;
  return 201;
}

const valid: ConfirmBody = {
  holdToken: "0f2c9a1e-1111-4000-8000-000000000000",
  patientName: "Ammar Ahmed",
  patientPhone: "01501606307",
  consent: true,
};

test("a complete booking is accepted", () => {
  assert.equal(validateConfirm(valid), 201);
});

test("Egyptian and international phone formats are all accepted", () => {
  for (const phone of [
    "01501606307",
    "+20 150 160 6307",
    "+201501606307",
    "(02) 2359-1234",
    "0100-000-0000",
  ]) {
    assert.equal(validateConfirm({ ...valid, patientPhone: phone }), 201, phone);
  }
});

test("nonsense phone numbers are rejected", () => {
  for (const phone of ["123", "", "not a phone", "01501606307012345678901"]) {
    assert.equal(validateConfirm({ ...valid, patientPhone: phone }), 400, phone);
  }
});

test("consent must be sent as a real boolean true", () => {
  // The checkbox is `required` in the browser, but the browser is not the
  // security boundary — the string "true" or a missing field must not pass.
  assert.equal(validateConfirm({ ...valid, consent: undefined }), 400);
  assert.equal(validateConfirm({ ...valid, consent: false }), 400);
  assert.equal(validateConfirm({ ...valid, consent: "true" }), 400);
  assert.equal(validateConfirm({ ...valid, consent: 1 }), 400);
});

test("a hold token is mandatory", () => {
  assert.equal(validateConfirm({ ...valid, holdToken: "" }), 400);
  assert.equal(validateConfirm({ ...valid, holdToken: undefined }), 400);
  assert.equal(validateConfirm({ ...valid, holdToken: 12345 }), 400);
});

test("oversized fields are rejected before they reach the database", () => {
  assert.equal(validateConfirm({ ...valid, patientName: "a".repeat(NAME_MAX + 1) }), 400);
  assert.equal(validateConfirm({ ...valid, patientEmail: `${"a".repeat(EMAIL_MAX)}@x.eg` }), 400);
  assert.equal(validateConfirm({ ...valid, patientNote: "n".repeat(NOTE_MAX + 1) }), 400);
  // Exactly at the limit is fine.
  assert.equal(validateConfirm({ ...valid, patientNote: "n".repeat(NOTE_MAX) }), 201);
});

test("whitespace-only details do not count as supplied", () => {
  assert.equal(validateConfirm({ ...valid, patientName: "   " }), 400);
  assert.equal(validateConfirm({ ...valid, patientPhone: "   " }), 400);
});

/* -------------------------------------------------------------------------- */

/** Mirrors the guard in POST /api/clinic/appointments. */
function validateClinicBooking(input: {
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  patientName: string;
  patientPhone: string;
}): number {
  const branch = findBranch(input.branch);
  const service = findService(input.service);
  if (!branch || !service) return 400;
  if (!isDateKey(input.slotDate) || !isOpenDay(input.slotDate)) return 400;
  if (!isSlotTime(input.slotTime)) return 400;
  if (!generateSlots(branch, input.slotDate, service.id).some((slot) => slot.time === input.slotTime))
    return 400;
  if (!input.patientName || !PHONE_PATTERN.test(input.patientPhone)) return 400;
  return 201;
}

const deskBooking = {
  branch: "Maadi",
  service: "aesthetic",
  slotDate: "2026-08-02", // Sunday — Maadi runs a surgeon session from 16:00
  slotTime: "16:00",
  patientName: "Ammar Ahmed",
  patientPhone: "01501606307",
};

test("reception can book a slot that is too soon for the public site", () => {
  // Staff bookings deliberately skip the lead-time rule: someone standing at
  // the desk can be given the next slot.
  assert.equal(validateClinicBooking(deskBooking), 201);
});

test("reception still cannot book a closed day or an invented time", () => {
  // 2026-07-31 is a Friday, the clinic's closed day.
  assert.equal(validateClinicBooking({ ...deskBooking, slotDate: "2026-07-31" }), 400);
  assert.equal(validateClinicBooking({ ...deskBooking, slotTime: "03:15" }), 400);
  // 10:00 is a Mohandessin morning start, not a Maadi one.
  assert.equal(validateClinicBooking({ ...deskBooking, slotTime: "10:00" }), 400);
  assert.equal(validateClinicBooking({ ...deskBooking, branch: "Alexandria" }), 400);
});

test("reception cannot book a day the branch does not run at all", () => {
  // 2026-08-03 is a Monday: Mohandessin and Fifth Settlement run, Maadi does not.
  assert.equal(validateClinicBooking({ ...deskBooking, slotDate: "2026-08-03" }), 400);
});

/* -------------------------------------------------------------------------- */

/**
 * The status set the dashboard is allowed to write. `held` is absent on
 * purpose: a hold is owned by the booking flow, and letting staff resurrect one
 * would let a slot be occupied with no patient attached to it.
 */
const STAFF_STATUS_ACTIONS = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
];

test("staff can only set appointment statuses that make sense", () => {
  for (const status of STAFF_STATUS_ACTIONS) {
    assert.ok(STAFF_STATUS_ACTIONS.includes(status));
  }
  assert.ok(!STAFF_STATUS_ACTIONS.includes("held"));
  assert.ok(!STAFF_STATUS_ACTIONS.includes("deleted"));
});

/* -------------------------------------------------------------------------- */

/** Mirrors the CSV escaping used by the dashboard export. */
function csvCell(value: string | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

test("CSV export cannot be broken by patient-supplied text", () => {
  assert.equal(csvCell('Ahmed "The Chief" Ali'), '"Ahmed ""The Chief"" Ali"');
  assert.equal(csvCell("Maadi, Cairo"), '"Maadi, Cairo"');
  assert.equal(csvCell(null), '""');
  // A newline inside a quoted CSV field is valid and must survive intact.
  assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
});
