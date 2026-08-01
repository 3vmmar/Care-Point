import { NextRequest, NextResponse } from "next/server";
import { recordAccess } from "@/db/audit";
import {
  createPilotIncident,
  createPilotReview,
  getPilotDashboard,
  resolvePilotIncident,
  updatePilotChecklist,
  updatePilotSettings,
  type PilotDecision,
  type PilotRecommendation,
  type PilotSeverity,
  type PilotStatus,
} from "@/db/pilot";
import { requireStaffPermission, staffSecurityConfiguration } from "@/lib/auth";
import { notificationsConfigured } from "@/lib/notify";
import { proxyVerificationConfigured } from "@/lib/trusted-proxy";
import { findBranch } from "@/lib/clinic";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/**
 * What the readiness gate needs to know about production configuration.
 *
 * Staff authentication is part of it: a pilot that takes real patients while the
 * dashboard is guarded by nothing but an email allowlist is not a pilot the
 * clinic can defend afterwards.
 */
function configuration() {
  const security = staffSecurityConfiguration();
  return {
    notifications: notificationsConfigured(),
    proxyVerification: proxyVerificationConfigured(),
    staffAllowlist: security.staffAllowlist,
    staffMfa: security.mfaRequired && security.mfaKey && security.sessionSecret,
  };
}

export async function GET(request: NextRequest) {
  const gate = await requireStaffPermission("pilot:read", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;

  try {
    const dashboard = await getPilotDashboard(configuration());
    await recordAccess({
      actor: gate.staff.email,
      action: "view",
      subjectId: "pilot",
      clientHash: await clientFingerprint(request),
      detail: "pilot control room",
    });
    return NextResponse.json(dashboard, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/pilot" });
    return NextResponse.json(
      { message: "Pilot controls are unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireStaffPermission("pilot:write", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const actor = gate.staff.email;
  const action = typeof body.action === "string" ? body.action : "";
  try {
    if (action === "configure") {
      const branchId = typeof body.branchId === "string" ? body.branchId : null;
      if (branchId && !findBranch(branchId)) {
        return NextResponse.json({ message: "Choose a valid pilot branch." }, { status: 400 });
      }
      await updatePilotSettings({
        status: body.status as PilotStatus,
        branchId,
        startDate: typeof body.startDate === "string" ? body.startDate : null,
        endDate: typeof body.endDate === "string" ? body.endDate : null,
        decision: body.decision as PilotDecision,
        decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
        actor,
      });
    } else if (action === "checklist") {
      if (typeof body.key !== "string" || typeof body.completed !== "boolean") {
        return NextResponse.json({ message: "Checklist item and state are required." }, { status: 400 });
      }
      await updatePilotChecklist({
        key: body.key,
        completed: body.completed,
        note: typeof body.note === "string" ? body.note : null,
        actor,
      });
    } else if (action === "incident") {
      await createPilotIncident({
        summary: typeof body.summary === "string" ? body.summary : "",
        severity: body.severity as PilotSeverity,
        actor,
      });
    } else if (action === "resolve_incident") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id || !(await resolvePilotIncident(id, actor))) {
        return NextResponse.json(
          { message: "That incident is already resolved or does not exist." },
          { status: 409, headers: PRIVATE_HEADERS },
        );
      }
    } else if (action === "review") {
      await createPilotReview({
        recommendation: body.recommendation as PilotRecommendation,
        note: typeof body.note === "string" ? body.note : null,
        actor,
      });
    } else {
      return NextResponse.json({ message: "Unknown pilot action." }, { status: 400 });
    }

    await recordAccess({
      actor,
      action: "update",
      subjectId: "pilot",
      clientHash: await clientFingerprint(request),
      detail: `pilot ${action}`,
    });
    return NextResponse.json(await getPilotDashboard(configuration()), {
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pilot update failed.";
    if (/invalid|required|choose|complete|before|unknown/i.test(message)) {
      return NextResponse.json(
        { message },
        { status: /complete every/i.test(message) ? 409 : 400, headers: PRIVATE_HEADERS },
      );
    }
    await reportError(error, { where: `PATCH /api/clinic/pilot ${action || "unknown"}` });
    return NextResponse.json(
      { message: "The pilot update could not be saved." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
