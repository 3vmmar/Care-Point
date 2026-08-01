/**
 * What a member of staff is allowed to do.
 *
 * Authentication answers "who is this?"; the platform proxy does that. This
 * module answers the separate question "what may they touch?", which the
 * platform cannot answer because it knows nothing about the clinic.
 *
 * Until now the answer was binary: an address was on `STAFF_EMAILS` or it was
 * not, and everyone who was on it could read every patient's phone number,
 * export the whole book to CSV, erase a patient's records and read the audit
 * log that was supposed to hold them accountable. For a practice where
 * reception, a visiting clinician and an external compliance auditor all need
 * some access, that is not a defensible position.
 *
 * Deliberately a pure module — no database, no headers, no `cloudflare:workers`
 * import — so the permission matrix can be tested directly rather than mirrored.
 */

export const STAFF_ROLES = [
  "owner",
  "doctor",
  "receptionist",
  "privacy_admin",
  "auditor",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Capabilities, named for the thing being protected rather than the screen that
 * happens to show it. A new dashboard view then inherits the right rule instead
 * of inventing its own.
 */
/**
 * Every capability is one that at least two roles disagree about. A permission
 * held by everybody is not a control, and one held by nobody guards nothing —
 * both are asserted in `tests/roles.test.mts`, because either reads as
 * protection while providing none.
 */
export const PERMISSIONS = [
  /** Patient name, phone, email, and the notes attached to a visit. */
  "patient:read",
  /** Book, reschedule, check in, complete, mark no-show, cancel. */
  "patient:write",
  /** Bulk extraction: CSV export, printed day sheet, DSR access packs. */
  "patient:export",
  /** See the data-subject request queue. */
  "dsr:read",
  /** Fulfil or reject a request — including erasure. */
  "dsr:fulfil",
  /** Read the staff access log. */
  "audit:read",
  "notifications:read",
  /** Resend or retry a delivery. */
  "notifications:write",
  "pilot:read",
  /** Start, pause, decide the pilot; record incidents and reviews. */
  "pilot:write",
  "staff:read",
  /** Add, deactivate, and change the roles of staff; reset another member's MFA. */
  "staff:write",
  /**
   * Change the opening rota, consultation durations and closures.
   *
   * Separate from `patient:write` because it operates on a different scale: a
   * receptionist rebooking one patient is routine, whereas deleting a Tuesday
   * evening session silently withdraws every slot in it from the booking page.
   */
  "catalogue:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The matrix.
 *
 * Reasoning for the less obvious entries:
 *
 * - **Receptionist has no `patient:export`.** Reception legitimately needs every
 *   patient's contact details one visit at a time; it does not need the entire
 *   book in a single file. Bulk export is the one action that turns a stolen
 *   staff session into a wholesale data breach, so it is held by the two roles
 *   accountable for the data rather than the busiest desk in the practice.
 *
 * - **Doctor cannot read the audit log.** The log records what staff looked at,
 *   and a log the subjects can read is a log they can watch for their own name.
 *   It belongs to whoever answers for the practice, not to everyone in it.
 *
 * - **Privacy admin can read and export patient data but not change it.** They
 *   have to see a record to confirm it is the right person before fulfilling a
 *   request, and an access request *is* an export. They have no reason to alter
 *   an appointment.
 *
 * - **Auditor cannot read patient data at all.** A read-only auditor exists to
 *   verify that the clinic's controls work — the access log, delivery failures,
 *   pilot evidence, who holds which role. None of that requires a patient's
 *   phone number, and an external reviewer should not be handed one.
 */
const MATRIX: Record<StaffRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  doctor: [
    "patient:read",
    "patient:write",
    "patient:export",
    "notifications:read",
    "pilot:read",
    "staff:read",
    // The doctor's own timetable. Whether the clinic opens on a Tuesday evening
    // is a clinical and personal decision before it is an administrative one.
    "catalogue:write",
  ],
  receptionist: [
    "patient:read",
    "patient:write",
    "notifications:read",
    "notifications:write",
    "pilot:read",
  ],
  privacy_admin: [
    "patient:read",
    "patient:export",
    "dsr:read",
    "dsr:fulfil",
    "audit:read",
    "staff:read",
  ],
  auditor: [
    "dsr:read",
    "audit:read",
    "notifications:read",
    "pilot:read",
    "staff:read",
  ],
};

export const ROLE_DETAIL: Record<StaffRole, { label: string; detail: string }> = {
  owner: {
    label: "Owner",
    detail: "Full access, including staff, roles and the audit log.",
  },
  doctor: {
    label: "Doctor",
    detail: "The full schedule, patient records and clinical notes.",
  },
  receptionist: {
    label: "Reception",
    detail: "Book, check in and contact patients. No bulk export.",
  },
  privacy_admin: {
    label: "Privacy admin",
    detail: "Fulfils data requests and reads the access log. Cannot alter records.",
  },
  auditor: {
    label: "Read-only auditor",
    detail: "Audit log, delivery and pilot evidence. No patient details.",
  },
};

/** Least privilege: a newly added colleague starts at the desk, not as an owner. */
export const DEFAULT_ROLE: StaffRole = "receptionist";

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * Keeps only recognised roles. A role removed from this file must not keep
 * granting access through a row that still names it, and an unrecognised string
 * in the database is treated as no role at all rather than as a wildcard.
 */
export function parseRoles(values: readonly unknown[]): StaffRole[] {
  const seen = new Set<StaffRole>();
  for (const value of values) {
    if (isStaffRole(value)) seen.add(value);
  }
  return STAFF_ROLES.filter((role) => seen.has(role));
}

/** The union of everything the given roles allow. */
export function permissionsFor(roles: readonly StaffRole[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of MATRIX[role]) granted.add(permission);
  }
  return PERMISSIONS.filter((permission) => granted.has(permission));
}

export function hasPermission(
  roles: readonly StaffRole[],
  permission: Permission,
): boolean {
  return roles.some((role) => MATRIX[role].includes(permission));
}

/** Roles that may hand out roles — the set that must never become empty. */
export function canAdministerStaff(roles: readonly StaffRole[]): boolean {
  return hasPermission(roles, "staff:write");
}

export function describeRoles(roles: readonly StaffRole[]): string {
  if (roles.length === 0) return "No role";
  return roles.map((role) => ROLE_DETAIL[role].label).join(", ");
}
