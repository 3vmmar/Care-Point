import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ROLE,
  PERMISSIONS,
  STAFF_ROLES,
  canAdministerStaff,
  describeRoles,
  hasPermission,
  isStaffRole,
  parseRoles,
  permissionsFor,
  ROLE_DETAIL,
  type Permission,
  type StaffRole,
} from "../lib/roles.ts";

/**
 * The permission matrix, imported rather than mirrored.
 *
 * These assertions are written as statements about the clinic rather than about
 * the code — "reception cannot export the register" — so that changing the matrix
 * to something less safe fails a test whose name explains what was lost.
 */

test("every role is described in the UI copy", () => {
  for (const role of STAFF_ROLES) {
    assert.ok(ROLE_DETAIL[role]?.label, role);
    assert.ok(ROLE_DETAIL[role]?.detail, role);
  }
});

test("an owner can do everything", () => {
  assert.deepEqual(permissionsFor(["owner"]), [...PERMISSIONS]);
});

test("only an owner can hand out roles", () => {
  for (const role of STAFF_ROLES) {
    assert.equal(
      canAdministerStaff([role]),
      role === "owner",
      `${role} administering staff`,
    );
  }
});

test("reception cannot export the whole register", () => {
  // Reception needs one patient's number at a time. Bulk export is the action
  // that turns a stolen session into a wholesale breach.
  assert.equal(hasPermission(["receptionist"], "patient:read"), true);
  assert.equal(hasPermission(["receptionist"], "patient:write"), true);
  assert.equal(hasPermission(["receptionist"], "patient:export"), false);
});

test("reception cannot erase a patient or read the audit log", () => {
  assert.equal(hasPermission(["receptionist"], "dsr:fulfil"), false);
  assert.equal(hasPermission(["receptionist"], "audit:read"), false);
  assert.equal(hasPermission(["receptionist"], "staff:write"), false);
});

test("a doctor cannot read the log that records what they looked at", () => {
  assert.equal(hasPermission(["doctor"], "patient:read"), true);
  assert.equal(hasPermission(["doctor"], "audit:read"), false);
});

test("a privacy admin can fulfil requests but cannot alter records", () => {
  assert.equal(hasPermission(["privacy_admin"], "dsr:read"), true);
  assert.equal(hasPermission(["privacy_admin"], "dsr:fulfil"), true);
  // An access request is an export, so they need it; changing an appointment is
  // not part of answering one.
  assert.equal(hasPermission(["privacy_admin"], "patient:export"), true);
  assert.equal(hasPermission(["privacy_admin"], "patient:write"), false);
});

test("a read-only auditor never sees a patient's details", () => {
  const auditor: Permission[] = permissionsFor(["auditor"]);
  for (const permission of ["patient:read", "patient:write", "patient:export"] as Permission[]) {
    assert.equal(auditor.includes(permission), false, permission);
  }
  // What they are for: verifying that the controls work.
  assert.equal(hasPermission(["auditor"], "audit:read"), true);
  assert.equal(hasPermission(["auditor"], "pilot:read"), true);
  assert.equal(hasPermission(["auditor"], "staff:read"), true);
});

test("no role other than owner may write staff or the pilot", () => {
  for (const role of STAFF_ROLES) {
    if (role === "owner") continue;
    assert.equal(hasPermission([role], "staff:write"), false, role);
    assert.equal(hasPermission([role], "pilot:write"), false, role);
  }
});

test("holding two roles grants the union, never more", () => {
  const combined = permissionsFor(["receptionist", "auditor"]);
  assert.equal(combined.includes("patient:write"), true);
  assert.equal(combined.includes("audit:read"), true);
  // Neither role can export, so the pair cannot either.
  assert.equal(combined.includes("patient:export"), false);
  assert.equal(combined.includes("staff:write"), false);
});

test("no role at all grants nothing", () => {
  assert.deepEqual(permissionsFor([]), []);
  for (const permission of PERMISSIONS) {
    assert.equal(hasPermission([], permission), false, permission);
  }
});

test("an unrecognised role in the database is not a wildcard", () => {
  // A row naming a role this file no longer defines must grant nothing, rather
  // than being treated as unknown-therefore-permitted.
  assert.deepEqual(parseRoles(["superuser", "admin", ""]), []);
  assert.equal(isStaffRole("superuser"), false);
  assert.equal(isStaffRole("owner"), true);
});

test("parsing keeps only real roles, deduplicates, and fixes the order", () => {
  assert.deepEqual(parseRoles(["auditor", "owner", "auditor", "nonsense", 7, null]), [
    "owner",
    "auditor",
  ]);
});

test("a new colleague starts with the least privilege that is useful", () => {
  assert.equal(DEFAULT_ROLE, "receptionist");
  assert.equal(hasPermission([DEFAULT_ROLE], "staff:write"), false);
  assert.equal(hasPermission([DEFAULT_ROLE], "patient:export"), false);
});

test("every permission is granted to at least one role", () => {
  // A permission no role holds guards nothing and would silently 403 forever.
  for (const permission of PERMISSIONS) {
    const holders = STAFF_ROLES.filter((role) => hasPermission([role], permission));
    assert.ok(holders.length > 0, `nobody holds ${permission}`);
  }
});

test("every permission distinguishes at least two roles", () => {
  // A permission every role holds is not a control, it is decoration — and one
  // shipped that way is worse than none, because it reads as protection.
  for (const permission of PERMISSIONS) {
    const holders = STAFF_ROLES.filter((role) => hasPermission([role], permission));
    assert.ok(
      holders.length < STAFF_ROLES.length,
      `${permission} is held by every role and separates nobody`,
    );
  }
});

test("roles are described for a human, not by their identifiers", () => {
  assert.equal(describeRoles(["owner", "auditor"]), "Owner, Read-only auditor");
  assert.equal(describeRoles([]), "No role");
});

test("the role list has no duplicates", () => {
  assert.equal(new Set(STAFF_ROLES).size, STAFF_ROLES.length);
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
});

test("permissionsFor returns a stable order regardless of role order", () => {
  const forward = permissionsFor(["owner", "auditor"] as StaffRole[]);
  const backward = permissionsFor(["auditor", "owner"] as StaffRole[]);
  assert.deepEqual(forward, backward);
});
