/**
 * Access control for clinic-staff surfaces.
 *
 * Three separate questions, answered in three places:
 *
 *  - **Who is this?** The hosting platform's authenticating proxy, which injects
 *    `oai-authenticated-user-*` headers. Those headers are only believable
 *    because `lib/trusted-proxy.ts` strips them at the edge unless the request
 *    proved it came through the proxy.
 *  - **What may they do?** `lib/roles.ts` and the clinic's own staff directory in
 *    `db/staff.ts`. The platform will authenticate any account it recognises; it
 *    has no idea which of them is the receptionist.
 *  - **Are they really them?** A TOTP second factor, because a platform password
 *    is a credential the practice neither issued nor can rotate, and it is the
 *    only thing standing between a phishing email and every patient's phone
 *    number.
 *
 * This module is the adapter that gathers those inputs. The decision itself is
 * in `lib/staff-gate.ts`, kept free of `next/headers` so it can be tested
 * directly rather than mirrored.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getChatGPTUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import {
  getStaffRecord,
  isSessionRevoked,
  recordSecurityEvent,
  touchLastSeen,
  touchStaffSession,
} from "@/db/staff";
import { hasPermission, type Permission, type StaffRole } from "@/lib/roles";
import {
  decideStaffAccess,
  parseBreakGlassEmails,
  resolveMfaRequired,
  type GateDecision,
  type GateDenial,
  type StaffPrincipal,
} from "@/lib/staff-gate";
import { mfaKeyConfigured } from "@/lib/staff-crypto";
import {
  factorsSatisfied,
  readSessionCookie,
  staffSessionSecretConfigured,
  verifyStaffSession,
  type StaffFactor,
} from "@/lib/staff-session";

export type { StaffPrincipal } from "@/lib/staff-gate";
export type { Permission, StaffRole } from "@/lib/roles";

/**
 * `STAFF_EMAILS` — the break-glass owner list, e.g.
 *   STAFF_EMAILS="dr.ashraf@clinic.eg, manager@clinic.eg"
 *
 * Read on every call rather than captured at module load, so a test or a
 * redeploy that changes the variable is not fighting a cached copy.
 */
function breakGlassEmails(): string[] {
  return parseBreakGlassEmails(process.env.STAFF_EMAILS);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Roles granted to the unauthenticated local developer. Owner by default so the
 * whole dashboard is reachable; narrow it with `STAFF_DEV_ROLES` to see what a
 * receptionist or an auditor actually sees.
 */
function developmentRoles(): StaffRole[] {
  const configured = (process.env.STAFF_DEV_ROLES ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase());
  const known = configured.filter((entry): entry is StaffRole =>
    ["owner", "doctor", "receptionist", "privacy_admin", "auditor"].includes(entry),
  );
  return known.length > 0 ? known : ["owner"];
}

export function mfaEnforced(): boolean {
  return resolveMfaRequired({
    override: process.env.STAFF_MFA_REQUIRED,
    production: isProduction(),
  });
}

/** True when an allowlist exists at all. Surfaced by health and the pilot gate. */
export function staffAllowlistConfigured(): boolean {
  return breakGlassEmails().length > 0;
}

/** Everything the health endpoint and the pilot readiness gate need to report. */
export function staffSecurityConfiguration() {
  return {
    staffAllowlist: staffAllowlistConfigured(),
    mfaRequired: mfaEnforced(),
    mfaKey: mfaKeyConfigured(),
    sessionSecret: staffSessionSecretConfigured(),
  };
}

/**
 * Resolves the caller into a decision.
 *
 * Identity can arrive two ways, and both are safe:
 *
 *  - **The clinic's own session cookie**, issued by `/api/staff/login` after a
 *    password check. This is the primary path and needs nothing from the hosting
 *    platform, which is what removed the "can the proxy send a custom header?"
 *    question from the critical path.
 *  - **A proxy-injected header**, believed only because `lib/trusted-proxy.ts`
 *    strips it at the edge unless the proxy proves itself with a shared secret. In
 *    production with no secret configured the header is always stripped, so this
 *    path cannot be spoofed into existence — it simply does not work.
 *
 * The cookie is preferred when both are present: it is the credential the practice
 * issued and can revoke.
 */
type ResolvedIdentity = {
  email: string;
  displayName: string;
  record: Awaited<ReturnType<typeof getStaffRecord>>;
  factors: StaffFactor[];
  sessionId: string | null;
};

/**
 * Establishes *who* the caller is, from whichever credential they presented.
 *
 * Shared by every entry point, because they must agree. An earlier version had the
 * gate read the cookie while `requireStaffIdentity` still read only the header —
 * so a password-authenticated doctor changing their password had it checked
 * against whichever account the header named, which in development was the
 * synthetic developer. Two answers to "who is this?" is one too many.
 */
async function resolveIdentity(): Promise<ResolvedIdentity | null> {
  const requestHeaders = await headers();
  const cookieToken = readSessionCookie(requestHeaders.get("cookie"));
  const proxyIdentity = await getChatGPTUser();

  /**
   * Whose session this claims to be, before it has been verified.
   *
   * The email is read out of the unverified token only to look up the row the
   * signature is then checked against — nothing is trusted until
   * `verifyStaffSession` has confirmed the signature, the epoch and the expiry.
   */
  const claimedEmail = cookieToken ? peekSessionEmail(cookieToken) : null;
  const email = (claimedEmail ?? proxyIdentity?.email ?? "").trim().toLowerCase();
  if (!email) return null;

  const record = await getStaffRecord(email).catch(() => null);

  const factors: StaffFactor[] = [];
  let sessionId: string | null = null;

  if (cookieToken && record) {
    const verification = await verifyStaffSession(cookieToken, {
      email,
      epoch: record.sessionEpoch,
    });
    if (verification.ok) {
      /**
       * Signature, epoch and expiry are all satisfied. One more question: has
       * this particular device been signed out?
       *
       * Bumping the epoch ends every session at once and needs no lookup; this
       * is what makes "sign out of that one browser I left in a hotel" possible
       * without also ending the shift everybody else is mid-way through.
       */
      if (!(await isSessionRevoked(verification.claims.sessionId))) {
        factors.push(...verification.claims.factors);
        sessionId = verification.claims.sessionId;
      }
    }
  }

  // A believed proxy header is itself an identity proof, so it counts as a factor
  // even with no cookie — which keeps the platform-auth deployment working.
  if (proxyIdentity?.email?.trim().toLowerCase() === email && !factors.includes("proxy")) {
    factors.push("proxy");
  }

  if (factors.length === 0) return null;

  return {
    email,
    displayName:
      record?.displayName || proxyIdentity?.fullName || proxyIdentity?.displayName || email,
    record,
    factors,
    sessionId,
  };
}

export async function resolveStaffAccess(): Promise<GateDecision> {
  const config = {
    breakGlassEmails: breakGlassEmails(),
    mfaRequired: mfaEnforced(),
    // Production never waives identity; development has none to waive.
    allowUnauthenticated: !isProduction(),
    developmentRoles: developmentRoles(),
  };

  const identity = await resolveIdentity();
  if (!identity) {
    return decideStaffAccess({ identity: null, record: null, config, mfaSatisfied: false });
  }

  const { email, record } = identity;
  if (identity.sessionId) void touchStaffSession(identity.sessionId);

  const mfaSatisfied = factorsSatisfied(identity.factors, {
    mfaRequired: config.mfaRequired,
    mfaEnrolled: record?.mfaEnrolled ?? false,
  });

  return decideStaffAccess({
    identity: { email, displayName: identity.displayName },
    record: record
      ? {
          email: record.email,
          displayName: record.displayName,
          active: record.active,
          roles: record.roles,
          mfaEnrolled: record.mfaEnrolled,
          sessionEpoch: record.sessionEpoch,
          mustChangePassword: record.mustChangePassword,
        }
      : null,
    config,
    mfaSatisfied,
  });
}

/**
 * Reads the subject out of an *unverified* token.
 *
 * Only ever used to decide which staff row to load, so that the signature can then
 * be checked against that row's epoch. Nothing is believed on the strength of this.
 */
function peekSessionEmail(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const email = new TextDecoder().decode(bytes);
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

/**
 * Where to send somebody who is not signed in.
 *
 * The clinic's own form by default, because the practice now issues its own
 * credentials. A deployment still fronted by the platform proxy sets
 * `STAFF_SIGN_IN=platform` and gets the old behaviour, which matters because that
 * path cannot be tested here — it needs a deployed environment.
 */
function staffSignInPath(returnTo: string): string {
  if (process.env.STAFF_SIGN_IN?.trim().toLowerCase() === "platform") {
    return chatGPTSignInPath(returnTo);
  }
  return `/login?next=${encodeURIComponent(returnTo)}`;
}

/* -------------------------------------------------------------------------- */
/* Pages                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a page can be handed. `anonymous` is absent because that case never
 * returns — it redirects to sign-in.
 */
export type StaffGate =
  | { ok: true; staff: StaffPrincipal }
  | Exclude<GateDenial, { reason: "anonymous" }>;

/**
 * For pages.
 *
 * An anonymous visitor is sent to sign-in. Every other refusal is *returned*, so
 * the page can explain itself — bouncing a signed-in colleague back through
 * sign-in would only loop, and "enrol your phone" is a screen, not an error.
 */
export async function requireClinicStaff(returnTo: string): Promise<StaffGate> {
  const decision = await resolveStaffAccess();

  if (!decision.ok && decision.reason === "anonymous") {
    // `redirect` throws, so nothing below this line runs for an anonymous caller.
    redirect(staffSignInPath(returnTo));
  }
  if (decision.ok) {
    // Cheap and useful: the directory shows who has actually been using the
    // dashboard, which is how a stale account gets noticed.
    if (!decision.staff.development) void touchLastSeen(decision.staff.email);
    return { ok: true, staff: decision.staff };
  }
  return decision;
}

export type StaffIdentityGate =
  | {
      ok: true;
      email: string;
      displayName: string;
      roles: StaffRole[];
      breakGlass: boolean;
      /** No identity was presented at all — only reachable in development. */
      development: boolean;
    }
  | { ok: false; reason: "not-staff" | "deactivated"; email: string };

/**
 * For the enrolment and verification pages.
 *
 * They must render *before* the second factor is satisfied, so they cannot use
 * `requireClinicStaff` — it would refuse them with the very state they exist to
 * resolve. Identity and staff membership are checked; MFA deliberately is not.
 */
export async function requireStaffIdentityForPage(
  returnTo: string,
): Promise<StaffIdentityGate> {
  const identity = await resolveIdentity();

  if (!identity) {
    // No credential at all. In production the visitor is sent to sign in with the
    // clinic's own form; the platform sign-in path remains for a proxy deployment.
    if (isProduction()) redirect(staffSignInPath(returnTo));
    return {
      ok: true,
      email: "dev@localhost",
      displayName: "Local development",
      roles: developmentRoles(),
      breakGlass: false,
      development: true,
    };
  }

  const { email, record } = identity;
  const breakGlass = breakGlassEmails().includes(email);

  if (record && !record.active) return { ok: false, reason: "deactivated", email };
  if (!breakGlass && !(record?.roles.length ?? 0)) {
    return { ok: false, reason: "not-staff", email };
  }

  return {
    ok: true,
    email,
    displayName: identity.displayName,
    roles: record?.roles ?? [],
    breakGlass,
    development: false,
  };
}

/* -------------------------------------------------------------------------- */
/* API routes                                                                 */
/* -------------------------------------------------------------------------- */

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/** Machine-readable refusal codes, so the dashboard can act rather than guess. */
export type StaffRefusalCode =
  | "authentication_required"
  | "not_staff"
  | "account_inactive"
  | "mfa_enrolment_required"
  | "mfa_required"
  | "password_change_required"
  | "forbidden";

const REFUSALS: Record<
  GateDenial["reason"],
  { status: number; code: StaffRefusalCode; message: string }
> = {
  anonymous: {
    status: 401,
    code: "authentication_required",
    message: "Authentication required.",
  },
  "not-staff": {
    status: 403,
    code: "not_staff",
    message: "This account is not on the clinic's staff list.",
  },
  deactivated: {
    status: 403,
    code: "account_inactive",
    message: "This staff account is no longer active.",
  },
  "mfa-enrolment-required": {
    status: 403,
    code: "mfa_enrolment_required",
    message: "Set up your authenticator app before using the dashboard.",
  },
  "mfa-required": {
    status: 403,
    code: "mfa_required",
    message: "Enter the code from your authenticator app to continue.",
  },
  "password-change-required": {
    status: 403,
    code: "password_change_required",
    message: "Choose a new password before using the dashboard.",
  },
};

export type StaffApiGate =
  | { ok: true; staff: StaffPrincipal }
  | { ok: false; response: NextResponse };

function refuse(
  status: number,
  code: StaffRefusalCode,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json(
    { message, code, ...extra },
    { status, headers: PRIVATE_HEADERS },
  );
}

/**
 * The gate for every staff API route.
 *
 * Takes the permission the route needs, so authorisation is declared at the top
 * of the handler rather than inferred from the path. A new endpoint that forgets
 * to call this fails review; one that calls it with the wrong permission is at
 * least visible in a diff.
 */
export async function requireStaffPermission(
  permission: Permission,
  options: { clientHash?: string | null } = {},
): Promise<StaffApiGate> {
  const decision = await resolveStaffAccess();

  if (!decision.ok) {
    const refusal = REFUSALS[decision.reason];
    // Worth recording: somebody authenticated who should not be here, or whose
    // account was turned off. The MFA prompts are not — they repeat on every
    // request until the code is entered, and would bury the log.
    if (decision.reason === "not-staff" || decision.reason === "deactivated") {
      await recordSecurityEvent({
        actor: decision.email,
        event: "access_denied",
        outcome: "denied",
        detail: `${decision.reason}: needed ${permission}`,
        clientHash: options.clientHash ?? null,
      });
    }
    return {
      ok: false,
      response: refuse(refusal.status, refusal.code, refusal.message),
    };
  }

  if (!hasPermission(decision.staff.roles, permission)) {
    await recordSecurityEvent({
      actor: decision.staff.email,
      event: "access_denied",
      outcome: "denied",
      detail: `lacks ${permission}`,
      clientHash: options.clientHash ?? null,
    });
    return {
      ok: false,
      response: refuse(
        403,
        "forbidden",
        "Your role does not allow that.",
        { required: permission },
      ),
    };
  }

  return { ok: true, staff: decision.staff };
}

/**
 * The gate for the MFA endpoints themselves.
 *
 * Enrolling and verifying must be reachable *before* MFA is satisfied, or nobody
 * could ever satisfy it. So this checks identity and staff membership and stops
 * there — deliberately the one path that does not require a second factor.
 */
export async function requireStaffIdentity(): Promise<
  | { ok: true; email: string; displayName: string; roles: StaffRole[]; breakGlass: boolean }
  | { ok: false; response: NextResponse }
> {
  const identity = await resolveIdentity();

  if (!identity) {
    if (isProduction()) {
      return {
        ok: false,
        response: refuse(401, "authentication_required", "Authentication required."),
      };
    }
    return {
      ok: true,
      email: "dev@localhost",
      displayName: "Local development",
      roles: developmentRoles(),
      breakGlass: false,
    };
  }

  const { email, record } = identity;
  const breakGlass = breakGlassEmails().includes(email);

  if (record && !record.active) {
    return {
      ok: false,
      response: refuse(403, "account_inactive", REFUSALS.deactivated.message),
    };
  }
  if (!breakGlass && !(record?.roles.length ?? 0)) {
    return { ok: false, response: refuse(403, "not_staff", REFUSALS["not-staff"].message) };
  }

  return {
    ok: true,
    email,
    displayName: identity.displayName,
    roles: record?.roles ?? [],
    breakGlass,
  };
}

/** Convenience for handlers that have already resolved a principal. */
export function can(staff: StaffPrincipal, permission: Permission): boolean {
  return hasPermission(staff.roles, permission);
}
