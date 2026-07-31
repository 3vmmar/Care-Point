import assert from "node:assert/strict";
import test from "node:test";
import { parseDsn, scrub, scrubText, scrubUrl } from "../lib/observability.ts";

/**
 * These tests guard a privacy boundary, not a feature.
 *
 * Error reports leave the estate and land in a third-party dashboard. If a
 * patient's name, phone number or booking token travels with a stack trace,
 * that is a disclosure nobody consented to — and it would be invisible until
 * someone happened to read an error report. So the scrubber is tested against
 * the shapes real patient data actually takes here.
 */

test("Egyptian mobile numbers never survive", () => {
  for (const phone of [
    "01501606307",
    "0100 220 2453",
    "+201002202453",
    "+20 100 220 2453",
    "(02) 2359-1234",
  ]) {
    const out = scrubText(`booking failed for ${phone}`);
    assert.ok(!out.includes(phone), `leaked: ${phone} -> ${out}`);
    assert.match(out, /\[redacted\]/);
  }
});

test("email addresses never survive", () => {
  const out = scrubText("could not notify ammar.ahmed+clinic@example.com about the visit");
  assert.ok(!out.includes("ammar.ahmed"));
  assert.ok(!out.includes("example.com"));
});

test("manage and hold tokens never survive", () => {
  const token = "59861bc6-d69b-4431-a36f-6f6faa6e2ce4";
  const out = scrubText(`GET /appointment/${token} failed`);
  assert.ok(!out.includes(token), out);
});

test("short digit runs are left alone so traces stay readable", () => {
  // Durations, ports, dates and counts must survive or the report is useless.
  const out = scrubText("slot 15:00 for 45 min on 2026-07-31 returned 503 after 3 retries");
  assert.ok(out.includes("45 min"), out);
  assert.ok(out.includes("503"), out);
  assert.ok(out.includes("15:00"), out);
});

test("sensitive object keys are replaced whatever they hold", () => {
  const scrubbed = scrub({
    patientName: "Ammar Ahmed",
    patientPhone: "01501606307",
    patientEmail: "a@b.com",
    holdToken: "abc",
    authorization: "Bearer xyz",
    fingerprint: "9f2c1a",
    branch: "Maadi",
    slotTime: "15:00",
  }) as Record<string, unknown>;

  for (const key of [
    "patientName",
    "patientPhone",
    "patientEmail",
    "holdToken",
    "authorization",
    "fingerprint",
  ]) {
    assert.equal(scrubbed[key], "[redacted]", `${key} was not redacted`);
  }
  // Non-identifying operational context must be preserved, or debugging dies.
  assert.equal(scrubbed.branch, "Maadi");
  assert.equal(scrubbed.slotTime, "15:00");
});

test("nested structures are scrubbed all the way down", () => {
  const scrubbed = scrub({
    request: { body: { patientName: "Ammar", nested: { patientPhone: "01501606307" } } },
    list: [{ patientEmail: "x@y.com" }],
  }) as Record<string, never>;
  const serialised = JSON.stringify(scrubbed);

  assert.ok(!serialised.includes("Ammar"), serialised);
  assert.ok(!serialised.includes("01501606307"), serialised);
  assert.ok(!serialised.includes("x@y.com"), serialised);
});

test("a hostile object cannot spin the scrubber forever", () => {
  // A cyclic or absurdly deep payload must terminate rather than hang the worker.
  type Deep = { next?: Deep; patientPhone?: string };
  let deep: Deep = { patientPhone: "01501606307" };
  for (let i = 0; i < 50; i += 1) deep = { next: deep };
  const serialised = JSON.stringify(scrub(deep));
  assert.ok(!serialised.includes("01501606307"), "deep value leaked");
});

test("URLs keep their route but lose the identifying parts", () => {
  const out = scrubUrl(
    "https://clinic.eg/appointment/59861bc6-d69b-4431-a36f-6f6faa6e2ce4?phone=01501606307",
  );
  assert.ok(!out.includes("59861bc6"), out);
  assert.ok(!out.includes("01501606307"), out);
  // The shape of the route is what makes the report actionable.
  assert.ok(out.startsWith("https://clinic.eg/appointment/"), out);
});

test("a malformed URL still gets scrubbed rather than passed through", () => {
  const out = scrubUrl("not a url 01501606307");
  assert.ok(!out.includes("01501606307"), out);
});

test("DSN parsing produces the right endpoint, and rejects rubbish", () => {
  const parsed = parseDsn("https://abc123@o1.ingest.sentry.io/456");
  assert.equal(parsed?.key, "abc123");
  assert.equal(parsed?.endpoint, "https://o1.ingest.sentry.io/api/456/store/");

  assert.equal(parseDsn("https://o1.ingest.sentry.io/456"), null, "no key");
  assert.equal(parseDsn("https://abc@o1.ingest.sentry.io"), null, "no project");
  assert.equal(parseDsn("nonsense"), null);
  assert.equal(parseDsn(""), null);
});
