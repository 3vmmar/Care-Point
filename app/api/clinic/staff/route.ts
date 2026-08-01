import { NextRequest, NextResponse } from "next/server";
import {
  countActiveOwners,
  listStaff,
  resetMfa,
  setStaffActive,
  setStaffPassword,
  setStaffRoles,
  upsertStaffMember,
} from "@/db/staff";
import { requireStaffPermission } from "@/lib/auth";
import { generateTemporaryPassword } from "@/lib/password";
import { ROLE_DETAIL, STAFF_ROLES } from "@/lib/roles";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

/**
 * The staff directory.
 *
 * Reading it is `staff:read`, which most roles hold — knowing who else has access
 * is part of being accountable for a shared patient record. Changing it is
 * `staff:write`, which only an owner holds, because handing out roles is how
 * every other permission in the system is obtained.
 */

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

export async function GET(request: NextRequest) {
  const gate = await requireStaffPermission("staff:read", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;

  try {
    const staff = await listStaff();
    return NextResponse.json(
      {
        staff,
        roles: STAFF_ROLES.map((role) => ({ id: role, ...ROLE_DETAIL[role] })),
        activeOwners: await countActiveOwners(),
        canManage: gate.staff.permissions.includes("staff:write"),
        me: gate.staff.email,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/staff" });
    return NextResponse.json(
      { message: "The staff directory is unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const clientHash = await clientFingerprint(request);
  const gate = await requireStaffPermission("staff:write", { clientHash });
  if (!gate.ok) return gate.response;
  const actor = gate.staff.email;

  let body: {
    action?: unknown;
    email?: unknown;
    displayName?: unknown;
    roles?: unknown;
    active?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const roles = Array.isArray(body.roles) ? body.roles : [];

  try {
    if (action === "invite") {
      const displayName = typeof body.displayName === "string" ? body.displayName : "";
      await upsertStaffMember({ email, displayName, roles, actor });
    } else if (action === "roles") {
      await setStaffRoles({ email, roles, actor });
    } else if (action === "active") {
      if (typeof body.active !== "boolean") {
        return NextResponse.json({ message: "Choose active or inactive." }, { status: 400 });
      }
      await setStaffActive({ email, active: body.active, actor });
    } else if (action === "reset_password") {
      /**
       * Issues a temporary password for an owner to read out.
       *
       * There is no emailed reset link, because the practice does not send email
       * yet and a reset link that silently fails is worse than no reset at all.
       * The holder is forced to choose their own on first sign-in, and every
       * session they had ends immediately — a phoned-out password must not
       * coexist with a live session somebody else is using.
       */
      if (email === actor) {
        return NextResponse.json(
          {
            message:
              "Change your own password from the Security page, where it asks for the current one.",
          },
          { status: 400, headers: PRIVATE_HEADERS },
        );
      }
      const temporary = generateTemporaryPassword();
      await setStaffPassword({ email, password: temporary, actor, temporary: true });
      return NextResponse.json(
        {
          ok: true,
          temporaryPassword: temporary,
          staff: await listStaff(),
          activeOwners: await countActiveOwners(),
          message:
            "Read this out to them once. They must choose their own password when they sign in.",
        },
        { headers: PRIVATE_HEADERS },
      );
    } else if (action === "reset_mfa") {
      /**
       * An owner clearing somebody else's second factor.
       *
       * The path for a lost or stolen phone. It bumps the session epoch, so the
       * old device is signed out at the same moment rather than staying live
       * until its session happens to expire.
       */
      if (email === actor) {
        return NextResponse.json(
          {
            message:
              "Reset your own two-step sign-in from the Security page, where it asks for a current code.",
          },
          { status: 400, headers: PRIVATE_HEADERS },
        );
      }
      await resetMfa({ email, actor });
    } else {
      return NextResponse.json({ message: "Unknown staff action." }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, staff: await listStaff(), activeOwners: await countActiveOwners() },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "That change did not save.";
    // The owner-count guards and the validation messages are written for staff to
    // read, so they are returned rather than swallowed into a 500.
    if (/required|last|not in the directory|at least|active/i.test(message)) {
      return NextResponse.json({ message }, { status: 400, headers: PRIVATE_HEADERS });
    }
    await reportError(error, { where: `POST /api/clinic/staff ${action || "unknown"}` });
    return NextResponse.json(
      { message: "That change did not save." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
