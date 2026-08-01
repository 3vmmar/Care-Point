/**
 * The access decision itself, with the plumbing removed.
 *
 * `lib/auth.ts` gathers the inputs — identity from the proxy headers, the staff
 * row from D1, the MFA cookie — and this decides what they add up to. Split out
 * because `lib/auth.ts` reaches into `next/headers`, which cannot be imported by
 * the node test runner, and the rule that decides who sees patient data is the
 * last thing in this codebase that should be verified by a test that mirrors it.
 *
 * Every outcome is named, so a caller can respond usefully: "enrol your phone"
 * is a different situation from "you are not staff", and telling a receptionist
 * the wrong one wastes a shift.
 */

// Relative, with the extension, because the node test runner resolves this file
// directly and does not understand the `@/` alias. That resolution is the whole
// reason this module exists apart from `lib/auth.ts`.
import {
  hasPermission,
  permissionsFor,
  type Permission,
  type StaffRole,
} from "./roles.ts";

export type GateIdentity = {
  email: string;
  displayName: string;
} | null;

/** The parts of a staff row this decision depends on. */
export type GateRecord = {
  email: string;
  displayName: string;
  active: boolean;
  roles: StaffRole[];
  mfaEnrolled: boolean;
  sessionEpoch: number;
  /** True while a temporary password is still in place. */
  mustChangePassword?: boolean;
} | null;

export type GateConfig = {
  /**
   * `STAFF_EMAILS`. A permanent break-glass list held in the environment rather
   * than the database, because an owner who is locked out cannot fix the
   * database that is locking them out. Membership grants the owner role.
   */
  breakGlassEmails: readonly string[];
  mfaRequired: boolean;
  /**
   * Local development receives no identity headers at all, so enforcing would
   * lock the dashboard out entirely on a developer's machine.
   */
  allowUnauthenticated: boolean;
  developmentRoles: readonly StaffRole[];
};

export type StaffPrincipal = {
  email: string;
  displayName: string;
  roles: StaffRole[];
  permissions: Permission[];
  /** Authorised by the environment list rather than a directory row. */
  breakGlass: boolean;
  /** No real identity was presented; only possible in development. */
  development: boolean;
  mfa: {
    required: boolean;
    enrolled: boolean;
    satisfied: boolean;
  };
  /** Session epoch to bind a newly issued MFA session to. */
  sessionEpoch: number;
};

export type GateDenial =
  | { ok: false; reason: "anonymous" }
  | { ok: false; reason: "not-staff"; email: string }
  | { ok: false; reason: "deactivated"; email: string }
  | { ok: false; reason: "mfa-enrolment-required"; email: string; displayName: string }
  | { ok: false; reason: "mfa-required"; email: string; displayName: string }
  /**
   * Signed in with a temporary password. The only thing this session may do is
   * choose a real one — otherwise a password read out over the phone would be a
   * working credential for as long as nobody got round to changing it.
   */
  | { ok: false; reason: "password-change-required"; email: string; displayName: string };

export type GateDecision = { ok: true; staff: StaffPrincipal } | GateDenial;

export function isBreakGlassEmail(
  email: string,
  breakGlassEmails: readonly string[],
): boolean {
  const candidate = email.trim().toLowerCase();
  if (!candidate) return false;
  return breakGlassEmails.some((entry) => entry.trim().toLowerCase() === candidate);
}

/** Parses `STAFF_EMAILS`, which is comma separated and hand-edited. */
export function parseBreakGlassEmails(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function principal(input: {
  email: string;
  displayName: string;
  roles: StaffRole[];
  breakGlass: boolean;
  development: boolean;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  mfaSatisfied: boolean;
  sessionEpoch: number;
}): StaffPrincipal {
  return {
    email: input.email,
    displayName: input.displayName,
    roles: input.roles,
    permissions: permissionsFor(input.roles),
    breakGlass: input.breakGlass,
    development: input.development,
    mfa: {
      required: input.mfaRequired,
      enrolled: input.mfaEnrolled,
      satisfied: input.mfaSatisfied,
    },
    sessionEpoch: input.sessionEpoch,
  };
}

/**
 * Resolves an identity, a directory row and an MFA result into a decision.
 *
 * Order matters. A deactivated colleague is refused before their roles are
 * considered, and enrolment is demanded before a code is: asking someone for a
 * code they have no way to generate is how a support call starts.
 */
export function decideStaffAccess(input: {
  identity: GateIdentity;
  record: GateRecord;
  config: GateConfig;
  mfaSatisfied: boolean;
}): GateDecision {
  const { identity, record, config } = input;

  if (!identity || !identity.email) {
    if (!config.allowUnauthenticated) return { ok: false, reason: "anonymous" };
    return {
      ok: true,
      staff: principal({
        email: "dev@localhost",
        displayName: "Local development",
        roles: [...config.developmentRoles],
        breakGlass: false,
        development: true,
        mfaRequired: false,
        mfaEnrolled: false,
        mfaSatisfied: true,
        sessionEpoch: 0,
      }),
    };
  }

  const email = identity.email.trim().toLowerCase();
  const breakGlass = isBreakGlassEmail(email, config.breakGlassEmails);

  // Deactivation outranks the break-glass list. Otherwise removing someone who
  // had once been named in `STAFF_EMAILS` would take a redeploy, and "we removed
  // their access" would be false until it happened.
  if (record && !record.active) return { ok: false, reason: "deactivated", email };

  const directoryRoles = record?.roles ?? [];
  const roles: StaffRole[] = breakGlass
    ? Array.from(new Set<StaffRole>(["owner", ...directoryRoles]))
    : directoryRoles;

  if (roles.length === 0) return { ok: false, reason: "not-staff", email };

  const displayName = record?.displayName || identity.displayName || email;
  const mfaEnrolled = record?.mfaEnrolled ?? false;

  if (config.mfaRequired) {
    // A break-glass owner is not exempt. The list exists so the practice can get
    // back in, not so one account can skip the second factor forever — the first
    // thing they do is enrol, which creates their directory row.
    if (!mfaEnrolled) {
      return { ok: false, reason: "mfa-enrolment-required", email, displayName };
    }
    if (!input.mfaSatisfied) {
      return { ok: false, reason: "mfa-required", email, displayName };
    }
  }

  // Checked after the factors, so somebody holding a temporary password still has
  // to satisfy MFA before they are trusted to set a new one.
  if (record?.mustChangePassword) {
    return { ok: false, reason: "password-change-required", email, displayName };
  }

  return {
    ok: true,
    staff: principal({
      email,
      displayName,
      roles,
      breakGlass,
      development: false,
      mfaRequired: config.mfaRequired,
      mfaEnrolled,
      mfaSatisfied: input.mfaSatisfied,
      sessionEpoch: record?.sessionEpoch ?? 0,
    }),
  };
}

/** Whether a resolved principal may perform one action. */
export function principalCan(staff: StaffPrincipal, permission: Permission): boolean {
  return hasPermission(staff.roles, permission);
}

/**
 * Whether MFA should be enforced.
 *
 * Production defaults to enforcing. Development defaults to not, because a
 * developer has no clinic phone enrolled and would otherwise be unable to open
 * the dashboard at all. `STAFF_MFA_REQUIRED` overrides either way, which is also
 * the documented escape hatch if the practice locks itself out.
 */
export function resolveMfaRequired(options: {
  override: string | undefined | null;
  production: boolean;
}): boolean {
  const value = options.override?.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return options.production;
}
