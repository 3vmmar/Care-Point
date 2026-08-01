import { NextRequest, NextResponse } from "next/server";
import {
  beginMfaEnrolment,
  checkAuthThrottle,
  clearAuthThrottle,
  confirmMfaEnrolment,
  describeDevice,
  getStaffRecord,
  issueRecoveryCodes,
  listStaffSessions,
  recordAuthFailure,
  recordStaffSession,
  resetMfa,
  revokeAllStaffSessions,
  revokeStaffSession,
  verifyMfaCode,
} from "@/db/staff";
import { requireStaffIdentity } from "@/lib/auth";
import { mfaKeyConfigured } from "@/lib/staff-crypto";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  issueStaffSession,
  sessionTokenDigest,
  staffSessionSecretConfigured,
  STAFF_SESSION_HOURS,
} from "@/lib/staff-session";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

/**
 * Enrolling and satisfying the second factor.
 *
 * The one staff endpoint deliberately reachable *before* MFA is satisfied — it
 * has to be, or nobody could ever satisfy it. So it is gated on identity and
 * staff membership only, via `requireStaffIdentity`, and every branch below is
 * written on the assumption that the caller has not yet proved anything beyond
 * who the proxy says they are.
 *
 * A successful verification sets the signed session cookie. That is the only
 * place in the codebase that issues one.
 */

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/** Where the enrolment page reads its current state from. */
export async function GET() {
  const identity = await requireStaffIdentity();
  if (!identity.ok) return identity.response;

  try {
    const record = await getStaffRecord(identity.email);
    return NextResponse.json(
      {
        email: identity.email,
        displayName: identity.displayName,
        roles: record?.roles ?? identity.roles,
        breakGlass: identity.breakGlass,
        enrolled: record?.mfaEnrolled ?? false,
        pending: record?.mfaPending ?? false,
        confirmedAt: record?.mfaConfirmedAt ?? null,
        hasPassword: record?.hasPassword ?? false,
        mustChangePassword: record?.mustChangePassword ?? false,
        recoveryCodesRemaining: record?.recoveryCodesRemaining ?? 0,
        lockedUntil: record?.lockedUntil ?? null,
        sessionHours: STAFF_SESSION_HOURS,
        // Where this person is currently signed in. The question somebody asks
        // after leaving a browser open on a shared computer.
        sessions: record?.mfaEnrolled ? await listStaffSessions(identity.email) : [],
        // Surfaced so a misconfigured deployment says so on the page, rather
        // than failing with an opaque error the first time someone enrols.
        configured: {
          encryptionKey: mfaKeyConfigured(),
          sessionSecret: staffSessionSecretConfigured(),
        },
        /**
         * Whether enrolment would actually succeed, which is not the same
         * question. Development falls back to fixed keys with a loud warning, so
         * the page must warn without disabling the only button on it — production
         * has no fallback and genuinely cannot proceed.
         */
        canEnrol:
          (mfaKeyConfigured() && staffSessionSecretConfigured()) ||
          process.env.NODE_ENV !== "production",
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/mfa" });
    return NextResponse.json(
      { message: "Two-step sign-in is unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const identity = await requireStaffIdentity();
  if (!identity.ok) return identity.response;

  let body: { action?: unknown; code?: unknown; email?: unknown; sessionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const code = typeof body.code === "string" ? body.code : "";
  const clientHash = await clientFingerprint(request);

  /**
   * Per-client ceiling, checked before anything else.
   *
   * The per-account lockout stops five wrong codes against one colleague; it does
   * nothing about one source working through the directory five guesses at a time,
   * and staff addresses are not secret. Only the code-submitting actions are
   * throttled — reading state or starting an enrolment cannot be brute-forced.
   */
  const guarded = action === "verify" || action === "confirm" || action === "reset";
  if (guarded) {
    const throttle = await checkAuthThrottle(clientHash);
    if (!throttle.allowed) {
      return NextResponse.json(
        {
          message: "Too many attempts from this connection. Try again shortly.",
          code: "throttled",
          retryAfterSeconds: throttle.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            ...PRIVATE_HEADERS,
            "Retry-After": String(throttle.retryAfterSeconds),
          },
        },
      );
    }
  }

  /** Records a failure against the client, and reports if that used up its budget. */
  const registerClientFailure = async () => {
    if (!guarded) return null;
    const outcome = await recordAuthFailure(clientHash);
    return outcome.allowed ? null : outcome.retryAfterSeconds;
  };

  /** Everything a newly issued session needs recorded against it. */
  const establishSession = async (epoch: number) => {
    const session = await issueStaffSession({ email: identity.email, epoch });
    await recordStaffSession({
      id: session.claims.sessionId,
      email: identity.email,
      tokenDigest: await sessionTokenDigest(session.token),
      device: describeDevice(request.headers.get("user-agent")),
      clientHash,
      expiresAtMs: session.claims.expiresAtMs,
    });
    // A genuine success clears the client's counter, so a receptionist who
    // fumbled a few codes is not still carrying them at the end of the day.
    await clearAuthThrottle(clientHash);
    return session;
  };

  try {
    /* ---- start enrolment: issue a secret for the authenticator app ---- */
    if (action === "enrol") {
      const record = await getStaffRecord(identity.email);
      if (record?.mfaEnrolled) {
        // Re-enrolling silently would replace a working second factor, which is
        // how somebody with a borrowed session locks the real owner out.
        return NextResponse.json(
          {
            message: "Two-step sign-in is already set up. Reset it first to use a new phone.",
            code: "already_enrolled",
          },
          { status: 409, headers: PRIVATE_HEADERS },
        );
      }
      const enrolment = await beginMfaEnrolment({
        email: identity.email,
        displayName: identity.displayName,
        // A break-glass owner becomes a real owner in the directory here.
        roles: identity.breakGlass ? ["owner"] : identity.roles,
        actor: identity.email,
      });
      return NextResponse.json(
        { secret: enrolment.secret, uri: enrolment.uri },
        { headers: PRIVATE_HEADERS },
      );
    }

    /* ---- confirm enrolment: prove the app holds the secret ---- */
    if (action === "confirm") {
      const outcome = await confirmMfaEnrolment({ email: identity.email, code });
      if (!outcome.ok) {
        const messages: Record<typeof outcome.reason, string> = {
          "not-enrolling": "Start setting up two-step sign-in again.",
          "already-enrolled": "Two-step sign-in is already set up.",
          "bad-code": "That code was not right. Check your authenticator app and try again.",
        };
        if (outcome.reason === "bad-code") await registerClientFailure();
        return NextResponse.json(
          { message: messages[outcome.reason], code: outcome.reason },
          { status: outcome.reason === "bad-code" ? 400 : 409, headers: PRIVATE_HEADERS },
        );
      }

      // Enrolment proves the factor, so the same request establishes the session:
      // asking for a second code immediately after the first is pure friction.
      const record = await getStaffRecord(identity.email);
      const session = await establishSession(record?.sessionEpoch ?? 1);
      const response = NextResponse.json(
        { ok: true, recoveryCodes: outcome.recoveryCodes },
        { headers: PRIVATE_HEADERS },
      );
      response.headers.append(
        "Set-Cookie",
        buildSessionCookie(session.token, { expiresAtMs: session.claims.expiresAtMs }),
      );
      return response;
    }

    /* ---- verify: the daily challenge ---- */
    if (action === "verify") {
      const outcome = await verifyMfaCode({ email: identity.email, code, clientHash });
      if (!outcome.ok) {
        const messages: Record<typeof outcome.reason, string> = {
          unknown: "This account is not in the staff directory.",
          inactive: "This staff account is no longer active.",
          "not-enrolled": "Set up two-step sign-in before entering a code.",
          locked: "Too many wrong codes. Try again shortly, or ask an owner to reset it.",
          "bad-code": "That code was not right.",
        };
        const throttledFor = await registerClientFailure();
        if (throttledFor !== null) {
          return NextResponse.json(
            {
              message: "Too many attempts from this connection. Try again shortly.",
              code: "throttled",
              retryAfterSeconds: throttledFor,
            },
            {
              status: 429,
              headers: { ...PRIVATE_HEADERS, "Retry-After": String(throttledFor) },
            },
          );
        }
        return NextResponse.json(
          {
            message: messages[outcome.reason],
            code: outcome.reason,
            lockedUntil: outcome.lockedUntil ?? null,
            attemptsRemaining: outcome.attemptsRemaining ?? null,
          },
          {
            status: outcome.reason === "locked" ? 429 : 400,
            headers: PRIVATE_HEADERS,
          },
        );
      }

      const session = await establishSession(outcome.sessionEpoch);
      const response = NextResponse.json(
        { ok: true, usedRecoveryCode: outcome.usedRecoveryCode },
        { headers: PRIVATE_HEADERS },
      );
      response.headers.append(
        "Set-Cookie",
        buildSessionCookie(session.token, { expiresAtMs: session.claims.expiresAtMs }),
      );
      return response;
    }

    /* ---- new recovery codes ---- */
    if (action === "recovery_codes") {
      const record = await getStaffRecord(identity.email);
      if (!record?.mfaEnrolled) {
        return NextResponse.json(
          { message: "Set up two-step sign-in first.", code: "not_enrolled" },
          { status: 409, headers: PRIVATE_HEADERS },
        );
      }
      const codes = await issueRecoveryCodes(identity.email);
      return NextResponse.json({ ok: true, recoveryCodes: codes }, { headers: PRIVATE_HEADERS });
    }

    /**
     * Self-service reset, for replacing a phone you still have access to.
     *
     * Requires a working code, so it cannot be used by whoever is holding a
     * hijacked session to swap the factor out for their own.
     */
    if (action === "reset") {
      const outcome = await verifyMfaCode({ email: identity.email, code, clientHash });
      if (!outcome.ok) {
        await registerClientFailure();
        return NextResponse.json(
          {
            message:
              "Enter a current code or a recovery code to reset two-step sign-in. If you have neither, ask an owner.",
            code: outcome.reason,
          },
          { status: outcome.reason === "locked" ? 429 : 400, headers: PRIVATE_HEADERS },
        );
      }
      await resetMfa({ email: identity.email, actor: identity.email });
      const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
      // The reset bumped the epoch, so the cookie is already dead. Clearing it
      // keeps the browser from sending a token that can only ever be refused.
      response.headers.append("Set-Cookie", buildClearedSessionCookie());
      return response;
    }

    /* ---- sign out of the second factor on this device ---- */
    if (action === "sign_out") {
      const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
      response.headers.append("Set-Cookie", buildClearedSessionCookie());
      return response;
    }

    /**
     * End one other device.
     *
     * Needs no code: whoever is asking already holds a verified session for this
     * account, and demanding a second factor in order to *reduce* your own access
     * would only discourage people from tidying up after themselves.
     */
    if (action === "revoke_session") {
      const id = typeof body.sessionId === "string" ? body.sessionId : "";
      if (!id) return NextResponse.json({ message: "Unknown session." }, { status: 400 });
      const revoked = await revokeStaffSession({
        id,
        email: identity.email,
        actor: identity.email,
      });
      if (!revoked) {
        return NextResponse.json(
          { message: "That device is already signed out." },
          { status: 409, headers: PRIVATE_HEADERS },
        );
      }
      return NextResponse.json(
        { ok: true, sessions: await listStaffSessions(identity.email) },
        { headers: PRIVATE_HEADERS },
      );
    }

    /**
     * End every device, including this one.
     *
     * The answer to "I signed in somewhere I should not have, and I am no longer
     * sure where". Implemented by bumping the epoch, which sits inside every
     * token signature, so it does not depend on having a row for each session.
     */
    if (action === "sign_out_all") {
      await revokeAllStaffSessions({ email: identity.email, actor: identity.email });
      const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
      response.headers.append("Set-Cookie", buildClearedSessionCookie());
      return response;
    }

    return NextResponse.json({ message: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // A missing key is a deployment fault, not a bad request, and the operator
    // needs to be told which one it is.
    if (/STAFF_MFA_KEY|STAFF_SESSION_SECRET/.test(message)) {
      await reportError(error, { where: `POST /api/clinic/mfa ${action}` });
      return NextResponse.json(
        {
          message:
            "Two-step sign-in is not configured on this deployment. Set STAFF_MFA_KEY and STAFF_SESSION_SECRET.",
          code: "not_configured",
        },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    if (/not active|required|directory/i.test(message)) {
      return NextResponse.json(
        { message },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    await reportError(error, { where: `POST /api/clinic/mfa ${action || "unknown"}` });
    return NextResponse.json(
      { message: "That did not work. Please try again." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
