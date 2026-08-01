import assert from "node:assert/strict";
import test from "node:test";

/**
 * The pilot go/no-go gate.
 *
 * Mirrors `evaluatePilot` in db/pilot.ts, which imports `cloudflare:workers`
 * and so cannot be loaded by the Node runner. Keep the two in step.
 *
 * The behaviour under test is the one that was wrong: gates that pass on no
 * evidence. A pilot that has taken zero bookings computed a 0% no-show rate,
 * a 0% delivery-failure rate, and recommended "continue" — an empty pilot
 * looking exactly like a successful one.
 */

const MIN_ATTENDED_FOR_RATE = 10;
const MIN_NOTIFICATIONS_FOR_RATE = 20;
const MIN_BOOKINGS_FOR_SIGNAL = 5;

type State = "pass" | "fail" | "unknown";

type Metrics = {
  bookings: number;
  attended: number;
  noShowRate: number;
  notificationTotal: number;
  notificationFailureRate: number;
  criticalIncidents: number;
  unprotectedAppointments: number;
};

type Configuration = {
  notifications: boolean;
  proxyVerification: boolean;
  staffAllowlist: boolean;
};

function evaluate(
  metrics: Metrics,
  checklistComplete: boolean,
  configuration?: Configuration,
) {
  const checks: Array<{ key: string; state: State }> = [];
  const add = (key: string, state: State) => checks.push({ key, state });

  add("readiness", checklistComplete ? "pass" : "fail");

  if (configuration) {
    const ok =
      configuration.notifications &&
      configuration.proxyVerification &&
      configuration.staffAllowlist;
    add("infrastructure", ok ? "pass" : "fail");
  }

  add("integrity", metrics.unprotectedAppointments === 0 ? "pass" : "fail");

  add(
    "delivery",
    metrics.notificationTotal < MIN_NOTIFICATIONS_FOR_RATE
      ? "unknown"
      : metrics.notificationFailureRate <= 5
        ? "pass"
        : "fail",
  );

  add(
    "attendance",
    metrics.attended < MIN_ATTENDED_FOR_RATE
      ? "unknown"
      : metrics.noShowRate <= 15
        ? "pass"
        : "fail",
  );

  add("volume", metrics.bookings >= MIN_BOOKINGS_FOR_SIGNAL ? "pass" : "unknown");
  add("critical", metrics.criticalIncidents === 0 ? "pass" : "fail");

  const failed = checks.filter((c) => c.state === "fail").length;
  const unknown = checks.filter((c) => c.state === "unknown").length;

  const recommendation =
    metrics.criticalIncidents > 0 || metrics.unprotectedAppointments > 0
      ? "stop"
      : failed > 0
        ? "investigate"
        : unknown > 0
          ? "insufficient-data"
          : "continue";

  return { checks, recommendation, failed, unknown };
}

const EMPTY: Metrics = {
  bookings: 0,
  attended: 0,
  noShowRate: 0,
  notificationTotal: 0,
  notificationFailureRate: 0,
  criticalIncidents: 0,
  unprotectedAppointments: 0,
};

const HEALTHY: Metrics = {
  bookings: 40,
  attended: 32,
  noShowRate: 9,
  notificationTotal: 120,
  notificationFailureRate: 2,
  criticalIncidents: 0,
  unprotectedAppointments: 0,
};

const CONFIGURED: Configuration = {
  notifications: true,
  proxyVerification: true,
  staffAllowlist: true,
};

/* -------------------------------------------------------------------------- */
/* The bug this exists to prevent                                             */
/* -------------------------------------------------------------------------- */

test("an empty pilot is never reported as a success", () => {
  const result = evaluate(EMPTY, true, CONFIGURED);
  assert.notEqual(result.recommendation, "continue");
  assert.equal(result.recommendation, "insufficient-data");
});

test("a zero no-show rate on zero attendance is unknown, not a pass", () => {
  const result = evaluate(EMPTY, true, CONFIGURED);
  const attendance = result.checks.find((c) => c.key === "attendance");
  assert.equal(attendance?.state, "unknown");
});

test("a zero delivery-failure rate on zero sends is unknown, not a pass", () => {
  // The trap: no provider configured means nothing was attempted, so the
  // failure rate is 0% and the gate would otherwise read green.
  const result = evaluate(EMPTY, true, CONFIGURED);
  assert.equal(result.checks.find((c) => c.key === "delivery")?.state, "unknown");
});

test("rates become meaningful exactly at the evidence threshold", () => {
  const justUnder = evaluate(
    { ...HEALTHY, attended: MIN_ATTENDED_FOR_RATE - 1 },
    true,
    CONFIGURED,
  );
  assert.equal(justUnder.checks.find((c) => c.key === "attendance")?.state, "unknown");

  const atThreshold = evaluate(
    { ...HEALTHY, attended: MIN_ATTENDED_FOR_RATE },
    true,
    CONFIGURED,
  );
  assert.equal(atThreshold.checks.find((c) => c.key === "attendance")?.state, "pass");
});

/* -------------------------------------------------------------------------- */
/* Failure states                                                             */
/* -------------------------------------------------------------------------- */

test("a healthy pilot with full evidence continues", () => {
  const result = evaluate(HEALTHY, true, CONFIGURED);
  assert.equal(result.recommendation, "continue");
  assert.equal(result.failed, 0);
  assert.equal(result.unknown, 0);
});

test("an unprotected appointment stops the pilot outright", () => {
  // A live appointment with no occupancy cells can be double-booked. That is a
  // patient-safety failure, not something to investigate at leisure.
  const result = evaluate({ ...HEALTHY, unprotectedAppointments: 1 }, true, CONFIGURED);
  assert.equal(result.recommendation, "stop");
  assert.equal(result.checks.find((c) => c.key === "integrity")?.state, "fail");
});

test("a critical incident stops the pilot", () => {
  const result = evaluate({ ...HEALTHY, criticalIncidents: 1 }, true, CONFIGURED);
  assert.equal(result.recommendation, "stop");
});

test("stop outranks insufficient data", () => {
  // An empty pilot that has also broken integrity must not be softened into
  // "not enough data yet".
  const result = evaluate({ ...EMPTY, unprotectedAppointments: 3 }, true, CONFIGURED);
  assert.equal(result.recommendation, "stop");
});

test("a high no-show rate is investigated once there is evidence for it", () => {
  const result = evaluate({ ...HEALTHY, noShowRate: 30 }, true, CONFIGURED);
  assert.equal(result.recommendation, "investigate");
  assert.equal(result.checks.find((c) => c.key === "attendance")?.state, "fail");
});

test("missing infrastructure fails the gate even when the numbers look good", () => {
  // Delivery statistics from a deployment with no provider are meaningless,
  // so the configuration itself is gated rather than inferred from the rate.
  const result = evaluate(HEALTHY, true, {
    notifications: false,
    proxyVerification: true,
    staffAllowlist: true,
  });
  assert.equal(result.recommendation, "investigate");
  assert.equal(result.checks.find((c) => c.key === "infrastructure")?.state, "fail");
});

test("outstanding sign-offs fail the readiness gate", () => {
  const result = evaluate(HEALTHY, false, CONFIGURED);
  assert.equal(result.checks.find((c) => c.key === "readiness")?.state, "fail");
  assert.equal(result.recommendation, "investigate");
});

test("integrity is a genuine pass on an empty book, not an unknown", () => {
  // Zero live appointments really does mean zero unprotected ones — unlike a
  // rate, this is measured rather than merely absent.
  const result = evaluate(EMPTY, true, CONFIGURED);
  assert.equal(result.checks.find((c) => c.key === "integrity")?.state, "pass");
});

test("a thin week is flagged even when every other gate is clean", () => {
  const result = evaluate(
    { ...HEALTHY, bookings: MIN_BOOKINGS_FOR_SIGNAL - 1 },
    true,
    CONFIGURED,
  );
  assert.equal(result.checks.find((c) => c.key === "volume")?.state, "unknown");
  assert.equal(result.recommendation, "insufficient-data");
});
