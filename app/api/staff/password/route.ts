import { NextRequest, NextResponse } from "next/server";
import {
  checkAuthThrottle,
  recordAuthFailure,
  setStaffPassword,
  verifyStaffPassword,
} from "@/db/staff";
import { requireStaffIdentity } from "@/lib/auth";
import { buildClearedSessionCookie } from "@/lib/staff-session";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

/**
 * Changing your own password.
 *
 * Reachable before the gate is fully satisfied, because somebody holding a
 * temporary password has to be able to replace it — that is the only thing their
 * session is for. So it verifies the *current* password itself rather than relying
 * on the session alone: a borrowed session must not be enough to lock the real
 * owner out of their own account.
 */

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

export async function POST(request: NextRequest) {
  const identity = await requireStaffIdentity();
  if (!identity.ok) return identity.response;

  const clientHash = await clientFingerprint(request);
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
        headers: { ...PRIVATE_HEADERS, "Retry-After": String(throttle.retryAfterSeconds) },
      },
    );
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { message: "Enter your current password and the new one." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  if (currentPassword === newPassword) {
    return NextResponse.json(
      { message: "The new password has to be different from the current one." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const check = await verifyStaffPassword({
      email: identity.email,
      password: currentPassword,
      clientHash,
    });
    if (!check.ok) {
      await recordAuthFailure(clientHash);
      return NextResponse.json(
        {
          message:
            check.reason === "locked"
              ? "This account is locked after too many failed attempts. Try again shortly."
              : "That current password is not right.",
          code: check.reason,
        },
        { status: check.reason === "locked" ? 429 : 401, headers: PRIVATE_HEADERS },
      );
    }

    // Throws with wording the form can show if the new password is too weak.
    await setStaffPassword({
      email: identity.email,
      password: newPassword,
      actor: identity.email,
    });

    /**
     * Every session ends, including this one.
     *
     * `setStaffPassword` bumps the epoch, so the cookie in this browser is already
     * dead — clearing it means the next request is a clean sign-in rather than a
     * confusing refusal.
     */
    const response = NextResponse.json(
      { ok: true, message: "Password changed. Sign in again with the new one." },
      { headers: PRIVATE_HEADERS },
    );
    response.headers.append("Set-Cookie", buildClearedSessionCookie());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // The strength rules are written for the person at the form to read.
    if (/characters|password|different|active|directory/i.test(message)) {
      return NextResponse.json(
        { message, code: "weak_password" },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    await reportError(error, { where: "POST /api/staff/password" });
    return NextResponse.json(
      { message: "That change did not save." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
