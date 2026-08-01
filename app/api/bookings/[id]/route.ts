import { NextRequest, NextResponse } from "next/server";
import {
  STAFF_STATUS_ACTIONS,
  setStaffNote,
  updateAppointmentStatus,
  type StaffStatusAction,
} from "@/db/bookings";
import { requireStaffPermission } from "@/lib/auth";
import { isValidCancellationReason } from "@/db/catalogue";
import { reportError } from "@/lib/observability";
import { recordAccess } from "@/db/audit";
import { clientFingerprint } from "@/lib/request";

const NOTE_MAX = 500;
const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

function isStaffStatus(value: unknown): value is StaffStatusAction {
  return (
    typeof value === "string" &&
    (STAFF_STATUS_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * Staff-only appointment updates: check a patient in, mark a visit complete or
 * a no-show, cancel, or attach a clinic note.
 *
 * The dashboard was read-only, which meant the clinic's real day — arrivals,
 * cancellations, no-shows — lived in someone's head or on paper and never
 * reached the reporting the same dashboard was drawing.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireStaffPermission("patient:write", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;
  const staff = gate.staff;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ message: "Unknown appointment." }, { status: 400 });
  }

  let body: {
    status?: unknown;
    staffNote?: unknown;
    cancellationReason?: unknown;
    cancellationNote?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const hasStatus = body.status !== undefined;
  const hasNote = typeof body.staffNote === "string";

  if (!hasStatus && !hasNote) {
    return NextResponse.json({ message: "Nothing to update." }, { status: 400 });
  }
  if (hasStatus && !isStaffStatus(body.status)) {
    return NextResponse.json(
      { message: "That status is not one the dashboard can set." },
      { status: 400 },
    );
  }
  if (hasNote && (body.staffNote as string).length > NOTE_MAX) {
    return NextResponse.json({ message: "That note is too long." }, { status: 400 });
  }

  try {
    if (hasNote) {
      await setStaffNote(id, body.staffNote as string);
    }

    if (!hasStatus) {
      await recordAccess({
        actor: staff.email,
        action: "update",
        subjectId: id,
        clientHash: await clientFingerprint(request),
        detail: "staff note",
      });
      return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
    }

    const reason =
      typeof body.cancellationReason === "string" ? body.cancellationReason.trim() : "";
    const appointment = await updateAppointmentStatus({
      id,
      status: body.status as StaffStatusAction,
      actor: staff.email,
      // Validated against the staff list, so a hand-crafted request cannot invent
      // a reason code that then pollutes the breakdown nobody can interpret.
      cancellationReason:
        reason && (await isValidCancellationReason(reason, "staff")) ? reason : null,
      cancellationNote:
        typeof body.cancellationNote === "string" ? body.cancellationNote : null,
    });

    if (!appointment) {
      return NextResponse.json(
        { message: "That appointment could not be updated." },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }

    await recordAccess({
      actor: staff.email,
      action: "update",
      subjectId: appointment.id,
      clientHash: await clientFingerprint(request),
      detail: `status=${appointment.status}`,
    });

    return NextResponse.json({ appointment }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "PATCH /api/bookings/[id]" });
    return NextResponse.json(
      { message: "We could not update that appointment." },
      { status: 500 },
    );
  }
}
