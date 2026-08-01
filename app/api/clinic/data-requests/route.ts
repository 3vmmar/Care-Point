import { NextRequest, NextResponse } from "next/server";
import {
  erasePatientData,
  exportPatientData,
  getDataRequest,
  listDataRequests,
  resolveDataRequest,
  type DataRequestStatus,
} from "@/db/dsr";
import { recordAccess } from "@/db/audit";
import { requireStaffPermission } from "@/lib/auth";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };
const STATUSES: DataRequestStatus[] = ["pending", "fulfilled", "rejected"];

/** The queue of outstanding data-subject requests. */
export async function GET(request: NextRequest) {
  const gate = await requireStaffPermission("dsr:read", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;

  const statusParam = request.nextUrl.searchParams.get("status");
  const status = STATUSES.includes(statusParam as DataRequestStatus)
    ? (statusParam as DataRequestStatus)
    : undefined;

  try {
    const requests = await listDataRequests(status);
    return NextResponse.json({ requests }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/data-requests" });
    return NextResponse.json(
      { message: "Could not load data requests." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}

/**
 * Fulfil or reject a request.
 *
 * The `confirmed` flag is required for an erasure and is not a formality: this
 * is the only irreversible operation in the system, and it must be the result
 * of a staff member deliberately confirming that they have verified who they
 * are speaking to.
 *
 * Held behind `dsr:fulfil`, which reception does not have. Anonymising a
 * patient's history cannot be undone, and the person who verified the requester's
 * identity out of band should be the person who acts on it.
 */
export async function POST(request: NextRequest) {
  const gate = await requireStaffPermission("dsr:fulfil", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;
  const staff = gate.staff;

  let body: {
    id?: unknown;
    action?: unknown;
    resolution?: unknown;
    confirmed?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const action = typeof body.action === "string" ? body.action : "";
  const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";

  if (!id || !["fulfil", "reject"].includes(action)) {
    return NextResponse.json({ message: "Unknown request or action." }, { status: 400 });
  }

  try {
    const dsr = await getDataRequest(id);
    if (!dsr) {
      return NextResponse.json(
        { message: "Unknown request." },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }
    if (dsr.status !== "pending") {
      return NextResponse.json(
        { message: "That request has already been resolved." },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }

    if (action === "reject") {
      await resolveDataRequest({
        id,
        status: "rejected",
        actor: staff.email,
        resolution: resolution || "Rejected without a recorded reason.",
      });
      await recordAccess({
        actor: staff.email,
        action: "update",
        subjectId: id,
        clientHash: await clientFingerprint(request),
        detail: "data request rejected",
      });
      return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
    }

    /* ---- access / correction: return the data for the clinic to send ---- */
    if (dsr.kind !== "erase") {
      const records = await exportPatientData(dsr.requesterPhone);
      await recordAccess({
        actor: staff.email,
        action: "export",
        subjectId: id,
        subjectCount: records.length,
        clientHash: await clientFingerprint(request),
        detail: `data-subject ${dsr.kind}`,
      });
      await resolveDataRequest({
        id,
        status: "fulfilled",
        actor: staff.email,
        resolution: resolution || `Exported ${records.length} record(s).`,
        affectedCount: records.length,
      });
      return NextResponse.json({ ok: true, records }, { headers: PRIVATE_HEADERS });
    }

    /* ---- erasure: irreversible, so it needs an explicit confirmation ---- */
    if (body.confirmed !== true) {
      return NextResponse.json(
        {
          message:
            "Erasure is irreversible. Confirm that the requester's identity has been verified.",
          code: "confirmation-required",
        },
        { status: 428, headers: PRIVATE_HEADERS },
      );
    }

    const outcome = await erasePatientData(dsr.requesterPhone, staff.email);

    if (!outcome.ok && outcome.reason === "upcoming-appointments") {
      return NextResponse.json(
        {
          message: `This patient still has ${outcome.upcoming} upcoming appointment(s). Cancel them first, then erase.`,
          code: outcome.reason,
        },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    if (!outcome.ok) {
      await resolveDataRequest({
        id,
        status: "fulfilled",
        actor: staff.email,
        resolution: "No records found for that phone number.",
        affectedCount: 0,
      });
      return NextResponse.json(
        { ok: true, erased: 0, message: "No records were found for that number." },
        { headers: PRIVATE_HEADERS },
      );
    }

    await resolveDataRequest({
      id,
      status: "fulfilled",
      actor: staff.email,
      resolution: resolution || `Anonymised ${outcome.erased} record(s).`,
      affectedCount: outcome.erased,
    });

    return NextResponse.json(
      { ok: true, erased: outcome.erased },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "POST /api/clinic/data-requests" });
    return NextResponse.json(
      { message: "Could not action that request." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
