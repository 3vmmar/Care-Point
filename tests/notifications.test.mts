import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  channelsForNotification,
  retryDelayMs,
  retryDisposition,
} from "../lib/notification-policy.ts";

test("booking events fan out to independent patient and clinic channels", () => {
  const channels = channelsForNotification("booking.confirmed");
  assert.deepEqual(channels, [
    "patient_email",
    "patient_whatsapp",
    "clinic_email",
    "clinic_webhook",
  ]);
  assert.equal(new Set(channels).size, channels.length);
});

test("data requests notify the clinic without echoing sensitive data to a patient channel", () => {
  assert.deepEqual(channelsForNotification("data.request"), [
    "clinic_email",
    "clinic_webhook",
  ]);
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
