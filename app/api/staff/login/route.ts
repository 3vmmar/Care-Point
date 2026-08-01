import { NextRequest, NextResponse } from "next/server";
import {
  checkAuthThrottle,
  clearAuthThrottle,
  describeDevice,
  getStaffRecord,
  recordAuthFailure,
  recordStaffSession,
  setStaffPassword,
  verifyStaffPassword,
} from "@/db/staff";
import { isBreakGlassEmail, parseBreakGlassEmails } from "@/lib/staff-gate";
import { mfaEnforced } from "@/lib/auth";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  issueStaffSession,
  sessionTokenDigest,
} from "@/lib/staff-session";
import { checkPasswordStrength, describePasswordProblem } from "@/lib/password";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

/**
 * Staff sign-in with an email and password the clinic owns.
 *
 * This is the front door. Everything about it is written on the assumption that it
 * is the most attacked endpoint in the system, because it is: it is public, it
 * names a real person, and success is worth the entire patient register.
 *
 * What it does *not* do is tell the caller anything they did not already know. A
 * wrong password, an address that was never here, a deactivated colleague and an
 * account with no password set all produce the same refusal — because staff
 * addresses are on the practice website, and the only thing left to discover is
 * which of them are real.
 */

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/** One message for every credential failure. See above. */
const REFUSED = "That email and password do not match an active staff account.";

export async function POST(request: NextRequest) {
  const clientHash = await clientFingerprint(request);

  // Checked before the password is even read, so a blocked client costs us no
  // key derivations at all.
  const throttle = await checkAuthThrottle(clientHash);
  if (!throttle.allowed) {
    return NextResponse.json(
      {
        message: "Too many sign-in attempts from this connection. Try again shortly.",
        code: "throttled",
        retryAfterSeconds: throttle.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { ...PRIVATE_HEADERS, "Retry-After": String(throttle.retryAfterSeconds) },
      },
    );
  }

  let body: { email?: unknown; password?: unknown; setupToken?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { message: "Enter your email and password.", code: "incomplete" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    /**
     * First-run claim.
     *
     * A fresh deployment has a staff directory with no passwords in it, so there
     * would be no way in at all. An owner named in `STAFF_EMAILS` may claim their
     * account by presenting `STAFF_SETUP_TOKEN` alongside the password they want —
     * once, because the claim only works while the account has no password.
     *
     * The token lives in the environment, so claiming requires deploy access.
     * Remove it once the first owner is in.
     */
    const setupToken = typeof body.setupToken === "string" ? body.setupToken.trim() : "";
    const expectedToken = process.env.STAFF_SETUP_TOKEN?.trim();
    if (setupToken && expectedToken && setupToken === expectedToken) {
      const claim = await claimAccount({ email, password, clientHash });
      if (claim) return claim;
    }

    const outcome = await verifyStaffPassword({ email, password, clientHash });
    if (!outcome.ok) {
      const failure = await recordAuthFailure(clientHash);
      if (!failure.allowed) {
        return NextResponse.json(
          {
            message: "Too many sign-in attempts from this connection. Try again shortly.",
            code: "throttled",
            retryAfterSeconds: failure.retryAfterSeconds,
          },
          {
            status: 429,
            headers: { ...PRIVATE_HEADERS, "Retry-After": String(failure.retryAfterSeconds) },
          },
        );
      }

      /**
       * A locked account is the one thing worth saying out loud.
       *
       * It tells an attacker only what their own failed attempts already told them,
       * and it saves a receptionist from typing the right password five more times
       * wondering why it stopped working.
       */
      if (outcome.reason === "locked") {
        return NextResponse.json(
          {
            message:
              "This account is locked after too many failed attempts. Try again shortly, or ask an owner to reset it.",
            code: "locked",
            lockedUntil: outcome.lockedUntil ?? null,
          },
          { status: 429, headers: PRIVATE_HEADERS },
        );
      }

      return NextResponse.json(
        { message: REFUSED, code: "refused" },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    }

    const record = outcome.record;
    await clearAuthThrottle(clientHash);

    const session = await issueStaffSession({
      email,
      epoch: record.sessionEpoch,
      // The password is proved. Whether that is *enough* is the gate's decision,
      // which is why the factor is recorded rather than assumed sufficient.
      factors: ["password"],
    });
    await recordStaffSession({
      id: session.claims.sessionId,
      email,
      tokenDigest: await sessionTokenDigest(session.token),
      device: describeDevice(request.headers.get("user-agent")),
      clientHash,
      expiresAtMs: session.claims.expiresAtMs,
    });

    /**
     * Where to send them, decided here so the browser makes one round trip.
     *
     * A temporary password outranks MFA in the response, but not in the gate: the
     * gate still demands the second factor first, so somebody holding a phoned-out
     * password cannot change it without also holding the phone.
     */
    const next = mfaEnforced()
      ? record.mfaEnrolled
        ? "/command-center/verify"
        : "/command-center/security"
      : outcome.mustChangePassword
        ? "/command-center/security"
        : "/command-center";

    const response = NextResponse.json(
      {
        ok: true,
        next,
        mfa: { required: mfaEnforced(), enrolled: record.mfaEnrolled },
        mustChangePassword: outcome.mustChangePassword,
      },
      { headers: PRIVATE_HEADERS },
    );
    response.headers.append(
      "Set-Cookie",
      buildSessionCookie(session.token, { expiresAtMs: session.claims.expiresAtMs }),
    );
    return response;
  } catch (error) {
    await reportError(error, { where: "POST /api/staff/login" });
    return NextResponse.json(
      { message: "Sign-in is unavailable. Please try again." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

/**
 * Signing out. Clears the cookie; the session row is marked by the MFA endpoint's
 * `sign_out` action when a fuller teardown is wanted.
 *
 * Callers must send `Content-Type: application/json` even with no body — the CSRF
 * guard in `worker/index.ts` rejects any mutation that is not declared as JSON,
 * which is what stops a cross-site HTML form from reaching this at all.
 */
export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  response.headers.append("Set-Cookie", buildClearedSessionCookie());
  return response;
}

/**
 * Sets the first password for a break-glass owner who has none.
 *
 * Returns null when the claim does not apply, so the caller falls through to a
 * normal sign-in attempt rather than getting a different-shaped refusal — which
 * would reveal whether the token was right.
 */
async function claimAccount(input: {
  email: string;
  password: string;
  clientHash: string | null;
}): Promise<NextResponse | null> {
  const allowlist = parseBreakGlassEmails(process.env.STAFF_EMAILS);
  if (!isBreakGlassEmail(input.email, allowlist)) return null;

  const existing = await getStaffRecord(input.email);
  // Only ever for an account with no password. A second claim would be a password
  // reset available to anyone holding the setup token.
  if (existing?.hasPassword) return null;

  const problems = checkPasswordStrength(input.password, input.email);
  if (problems.length > 0) {
    return NextResponse.json(
      {
        message: problems.map(describePasswordProblem).join(" "),
        code: "weak_password",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  if (!existing) {
    // The directory row has to exist before a password can hang off it.
    const { upsertStaffMember } = await import("@/db/staff");
    await upsertStaffMember({
      email: input.email,
      displayName: input.email,
      roles: ["owner"],
      actor: input.email,
    });
  }
  await setStaffPassword({
    email: input.email,
    password: input.password,
    actor: input.email,
  });

  return NextResponse.json(
    {
      ok: true,
      claimed: true,
      next: "/command-center",
      message: "Password set. Sign in with it now, and remove STAFF_SETUP_TOKEN.",
    },
    { headers: PRIVATE_HEADERS },
  );
}
