import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  channelsForNotification,
  retryDelayMs,
  retryDisposition,
} from "../lib/notification-policy.ts";
import {
  branchSmsText,
  describeAppointment,
  type NotificationPayload,
} from "../lib/notify.ts";

const appointmentNotification: NotificationPayload = {
  kind: "booking.confirmed",
  appointment: {
    id: "a5f1c2d0-0000-4000-8000-000000000001",
    branch: "Maadi",
    service: "aesthetic",
    slotDate: "2026-08-05",
    slotTime: "16:00",
    patientName: "Mona Ali",
    patientPhone: "+201000000000",
    patientEmail: "mona@example.com",
    language: "en",
  },
};

test("booking events fan out to independent patient, clinic and branch channels", () => {
  const channels = channelsForNotification("booking.confirmed");
  assert.deepEqual(channels, [
    "patient_email",
    "patient_whatsapp",
    "clinic_email",
    "clinic_webhook",
    "branch_sms",
  ]);
  assert.equal(new Set(channels).size, channels.length);
});

test("reminders do not text the branch manager", () => {
  // The manager already has tomorrow on the day sheet; a text per upcoming
  // visit would train them to ignore the channel that carries new bookings.
  assert.ok(!channelsForNotification("booking.reminder").includes("branch_sms"));
  assert.ok(channelsForNotification("booking.cancelled").includes("branch_sms"));
  assert.ok(channelsForNotification("booking.rescheduled").includes("branch_sms"));
});

test("the branch SMS carries everything the desk needs to act without opening anything", () => {
  const text = branchSmsText({
    ...appointmentNotification,
    appointment: {
      ...appointmentNotification.appointment,
      patientNote: "Please have the earlier X-rays ready.",
    },
  });
  // Who, how to reach them, what for, when, where, and the reference.
  assert.match(text, /New booking/);
  assert.match(text, /Maadi/);
  assert.match(text, /Mona Ali/);
  assert.match(text, /\+201000000000/);
  assert.match(text, /Aesthetic consultation/i);
  // The house date format is weekday + day + month (no year — bookings live
  // inside a 14-day window) and 24h time. 2026-08-05 is a Wednesday.
  assert.match(text, /Wednesday 5 August/);
  assert.match(text, /4:00\s?pm/i);
  assert.match(text, /Ref: a5f1c2d0-0000-4000-8000-000000000001/);
  assert.match(text, /X-rays ready/);
});

test("a cancellation text says so loudly, and an essay of a note cannot inflate the message", () => {
  const text = branchSmsText({
    ...appointmentNotification,
    kind: "booking.cancelled",
    appointment: {
      ...appointmentNotification.appointment,
      patientNote: "n".repeat(500),
    },
  });
  assert.match(text, /CANCELLED/);
  const noteLine = text.split("\n").find((line) => line.startsWith("Note:"))!;
  assert.ok(noteLine.length <= 170, `note line is ${noteLine.length} chars`);
  assert.match(noteLine, /…$/);
});

test("a booking with no note sends no note line, and a missing name degrades honestly", () => {
  const text = branchSmsText({
    ...appointmentNotification,
    appointment: {
      ...appointmentNotification.appointment,
      patientName: null,
      patientNote: null,
    },
  });
  assert.ok(!text.includes("Note:"));
  assert.match(text, /Unnamed patient/);
});

test("data requests notify the clinic without echoing sensitive data to a patient channel", () => {
  assert.deepEqual(channelsForNotification("data.request"), [
    "clinic_email",
    "clinic_webhook",
  ]);
});

test("notification summaries use the appointment's stored practitioner", () => {
  const detail = describeAppointment({
    ...appointmentNotification,
    appointment: {
      ...appointmentNotification.appointment,
      practitioner: "Dr. Leila Haddad",
    },
  });
  assert.equal(detail.practitioner, "Dr. Leila Haddad");
  // Kept as an alias for existing webhook and WhatsApp consumers.
  assert.equal(detail.doctor, "Dr. Leila Haddad");
});

test("legacy dental notifications are never attributed to the plastic surgeon", () => {
  const detail = describeAppointment({
    ...appointmentNotification,
    appointment: {
      ...appointmentNotification.appointment,
      service: "dental-check",
      practitioner: null,
    },
  });
  assert.equal(detail.practitioner, "Dental team");
  assert.notEqual(detail.doctor, "Dr. Ashraf Metwally");
});

test("retry backoff recovers quickly then becomes deliberately conservative", () => {
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(2), 5 * 60_000);
  assert.equal(retryDelayMs(3), 30 * 60_000);
  assert.equal(retryDelayMs(4), 2 * 60 * 60_000);
  assert.equal(retryDelayMs(99), 12 * 60 * 60_000);
});

test("permanent errors and exhausted retries enter the dead-letter state", () => {
  assert.equal(
    retryDisposition({ attempts: 1, maxAttempts: 6, retryable: false }),
    "dead",
  );
  assert.equal(
    retryDisposition({ attempts: 6, maxAttempts: 6, retryable: true }),
    "dead",
  );
  assert.equal(
    retryDisposition({ attempts: 5, maxAttempts: 6, retryable: true }),
    "retrying",
  );
});

test("the outbox migration stores references and delivery metadata, not message bodies", () => {
  const migration = readFileSync(
    new URL("../drizzle/0007_yielding_maverick.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE `notification_jobs`/);
  assert.match(migration, /CREATE TABLE `notification_attempts`/);
  assert.match(migration, /`subject_id` text NOT NULL/);
  assert.doesNotMatch(migration, /patient_name|patient_phone|patient_email|payload_json/);
});
