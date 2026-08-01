import assert from "node:assert/strict";
import test from "node:test";
import {
  decideStaffAccess,
  isBreakGlassEmail,
  parseBreakGlassEmails,
  principalCan,
  resolveMfaRequired,
  type GateConfig,
  type GateRecord,
} from "../lib/staff-gate.ts";

/**
 * The decision that stands between the internet and every patient's phone number,
 * imported rather than mirrored.
 *
 * Written as a table of situations a real clinic reaches: someone who left, a
 * receptionist on a new phone, an owner locked out of their own database, an
 * attacker who knows a staff address. The point of splitting this out of
 * `lib/auth.ts` was to make exactly these cases testable against the real code.
 */

const PRODUCTION: GateConfig = {
  breakGlassEmails: ["owner@drashrafmetwally.com"],
  mfaRequired: true,
  allowUnauthenticated: false,
  developmentRoles: ["owner"],
};

const DEVELOPMENT: GateConfig = {
  breakGlassEmails: [],
  mfaRequired: false,
  allowUnauthenticated: true,
  developmentRoles: ["owner"],
};

const IDENTITY = { email: "reception@drashrafmetwally.com", displayName: "Reception" };

function record(overrides: Partial<NonNullable<GateRecord>> = {}): GateRecord {
  return {
    email: "reception@drashrafmetwally.com",
    displayName: "Nadia at reception",
    active: true,
    roles: ["receptionist"],
    mfaEnrolled: true,
    sessionEpoch: 1,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Anonymous callers                                                          */
/* -------------------------------------------------------------------------- */

test("production refuses a caller with no identity", () => {
  const decision = decideStaffAccess({
    identity: null,
    record: null,
    config: PRODUCTION,
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "anonymous");
});

test("production refuses an identity with an empty email", () => {
  const decision = decideStaffAccess({
    identity: { email: "", displayName: "" },
    record: null,
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "anonymous");
});

test("development lets a developer in, because it has no identity to check", () => {
  const decision = decideStaffAccess({
    identity: null,
    record: null,
    config: DEVELOPMENT,
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.staff.development, true);
  assert.equal(decision.ok && decision.staff.roles.join(), "owner");
});

test("the development role set can be narrowed to see what a receptionist sees", () => {
  const decision = decideStaffAccess({
    identity: null,
    record: null,
    config: { ...DEVELOPMENT, developmentRoles: ["receptionist"] },
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && principalCan(decision.staff, "patient:read"), true);
  assert.equal(decision.ok && principalCan(decision.staff, "patient:export"), false);
});

/* -------------------------------------------------------------------------- */
/* Membership                                                                 */
/* -------------------------------------------------------------------------- */

test("an authenticated stranger is not staff", () => {
  // The platform will authenticate any account it recognises. Being signed in is
  // not the same as working here.
  const decision = decideStaffAccess({
    identity: { email: "stranger@example.com", displayName: "Stranger" },
    record: null,
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "not-staff");
});

test("a directory row with no roles grants nothing", () => {
  const decision = decideStaffAccess({
    identity: IDENTITY,
    record: record({ roles: [] }),
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "not-staff");
});

test("someone who has left is refused, and the reason says so", () => {
  const decision = decideStaffAccess({
    identity: IDENTITY,
    record: record({ active: false }),
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "deactivated");
});

test("deactivation outranks the break-glass list", () => {
  // Otherwise removing access from a former owner named in STAFF_EMAILS would
  // need a redeploy, and "we revoked their access" would be untrue until then.
  const decision = decideStaffAccess({
    identity: { email: "owner@drashrafmetwally.com", displayName: "Former owner" },
    record: record({ email: "owner@drashrafmetwally.com", active: false, roles: ["owner"] }),
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "deactivated");
});

test("the break-glass list grants owner without a directory row", () => {
  // The lockout escape: an owner cannot fix the database that is locking them out.
  const decision = decideStaffAccess({
    identity: { email: "owner@drashrafmetwally.com", displayName: "Owner" },
    record: null,
    config: { ...PRODUCTION, mfaRequired: false },
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.staff.breakGlass, true);
  assert.equal(decision.ok && decision.staff.roles.includes("owner"), true);
});

test("break-glass adds owner to whatever the directory already says", () => {
  const decision = decideStaffAccess({
    identity: { email: "owner@drashrafmetwally.com", displayName: "Owner" },
    record: record({
      email: "owner@drashrafmetwally.com",
      roles: ["receptionist"],
    }),
    config: { ...PRODUCTION, mfaRequired: false },
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.ok && decision.staff.roles, ["owner", "receptionist"]);
});

test("an email is matched against the allowlist regardless of case or spacing", () => {
  assert.equal(isBreakGlassEmail("Owner@Clinic.EG", [" owner@clinic.eg "]), true);
  assert.equal(isBreakGlassEmail("  owner@clinic.eg", ["owner@clinic.eg"]), true);
  assert.equal(isBreakGlassEmail("owner@clinic.eg.attacker.com", ["owner@clinic.eg"]), false);
  assert.equal(isBreakGlassEmail("", ["owner@clinic.eg"]), false);
});

test("an empty allowlist authorises nobody", () => {
  assert.deepEqual(parseBreakGlassEmails(""), []);
  assert.deepEqual(parseBreakGlassEmails(undefined), []);
  assert.deepEqual(parseBreakGlassEmails(", ,"), []);
  assert.deepEqual(parseBreakGlassEmails("A@b.com, C@d.com "), ["a@b.com", "c@d.com"]);
});

/* -------------------------------------------------------------------------- */
/* The second factor                                                          */
/* -------------------------------------------------------------------------- */

test("a member of staff with no enrolled factor is asked to enrol, not to type a code", () => {
  // Asking for a code somebody has no way to generate is how a support call starts.
  const decision = decideStaffAccess({
    identity: IDENTITY,
    record: record({ mfaEnrolled: false }),
    config: PRODUCTION,
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "mfa-enrolment-required");
});

test("an enrolled member of staff without a session is asked for a code", () => {
  const decision = decideStaffAccess({
    identity: IDENTITY,
    record: record(),
    config: PRODUCTION,
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "mfa-required");
});

test("an enrolled member of staff with a valid session is let in", () => {
  const decision = decideStaffAccess({
    identity: IDENTITY,
    record: record(),
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.staff.mfa.satisfied, true);
  assert.equal(decision.ok && decision.staff.email, IDENTITY.email);
});

test("a break-glass owner is not exempt from the second factor", () => {
  // The list exists so the practice can get back in, not so one account can skip
  // MFA forever. Their first act is to enrol, which creates their directory row.
  const decision = decideStaffAccess({
    identity: { email: "owner@drashrafmetwally.com", displayName: "Owner" },
    record: null,
    config: PRODUCTION,
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.reason, "mfa-enrolment-required");
});

test("with MFA switched off, an enrolled session is not demanded", () => {
  const decision = decideStaffAccess({
    identity: IDENTITY,
    record: record({ mfaEnrolled: false }),
    config: { ...PRODUCTION, mfaRequired: false },
    mfaSatisfied: false,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.staff.mfa.required, false);
});

test("the resolved principal carries the epoch a new session must bind to", () => {
  const decision = decideStaffAccess({
    identity: IDENTITY,
    record: record({ sessionEpoch: 7 }),
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok && decision.staff.sessionEpoch, 7);
});

/* -------------------------------------------------------------------------- */
/* Permissions on the resolved principal                                      */
/* -------------------------------------------------------------------------- */

test("the principal's permissions follow its roles", () => {
  const decision = decideStaffAccess({
    identity: IDENTITY,
    record: record({ roles: ["auditor"] }),
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(principalCan(decision.staff, "audit:read"), true);
  assert.equal(principalCan(decision.staff, "patient:read"), false);
  assert.equal(decision.staff.permissions.includes("patient:read"), false);
});

test("the display name prefers the directory over whatever the proxy asserted", () => {
  // The clinic's own record of a colleague's name is the one staff recognise, and
  // the platform's is not under the practice's control.
  const decision = decideStaffAccess({
    identity: { email: IDENTITY.email, displayName: "r.nadia (personal account)" },
    record: record({ displayName: "Nadia at reception" }),
    config: PRODUCTION,
    mfaSatisfied: true,
  });
  assert.equal(decision.ok && decision.staff.displayName, "Nadia at reception");
});

/* -------------------------------------------------------------------------- */
/* Enforcement policy                                                         */
/* -------------------------------------------------------------------------- */

test("MFA is enforced in production by default and not in development", () => {
  assert.equal(resolveMfaRequired({ override: undefined, production: true }), true);
  assert.equal(resolveMfaRequired({ override: undefined, production: false }), false);
  assert.equal(resolveMfaRequired({ override: null, production: true }), true);
  assert.equal(resolveMfaRequired({ override: "", production: true }), true);
});

test("the override can force MFA on or off either way", () => {
  for (const value of ["1", "true", "yes", "TRUE", " yes "]) {
    assert.equal(resolveMfaRequired({ override: value, production: false }), true, value);
  }
  for (const value of ["0", "false", "no", "NO"]) {
    assert.equal(resolveMfaRequired({ override: value, production: true }), false, value);
  }
});

test("an unrecognised override does not silently disable MFA in production", () => {
  // The dangerous direction. A typo must fail safe.
  for (const value of ["maybe", "off?", "disabled", "2"]) {
    assert.equal(resolveMfaRequired({ override: value, production: true }), true, value);
  }
});
