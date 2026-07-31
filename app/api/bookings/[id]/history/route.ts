import { NextRequest, NextResponse } from "next/server";
import { getAppointmentById, patientHistory } from "@/db/bookings";
import { getClinicStaff } from "@/lib/auth";
import { reportError } from "@/lib/observability";
import { recordAccess } from "@/db/audit";
import { clientFingerprint } from "@/lib/request";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/**
 * Previous visits for the patient on a given appointment.
 *
 * Loaded on demand rather than joined into the schedule response: most rows are
 * never expanded, and the day view should not carry every patient's back
 * catalogue just in case.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const staff = await getClinicStaff();
  if (!staff) {
    return NextResponse.json(
      { message: "Authentication required." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const { id } = await context.params;

  try {
    // The appointment's own phone number is the lookup key, so it is read back
    // here rather than trusted from the query string — otherwise the endpoint
    // would happily dump any patient's history to any caller.
    const appointment = await getAppointmentById(id);

    if (!appointment) {
      return NextResponse.json(
        { message: "Unknown appointment." },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }
    if (!appointment.patientPhone) {
      return NextResponse.json({ history: [] }, { headers: PRIVATE_HEADERS });
    }

    const history = await patientHistory(appointment.patientPhone, id);

    // Pulling a patient's back catalogue is the most sensitive read the
    // dashboard offers, so it is recorded against the appointment it was
    // opened from.
    await recordAccess({
      actor: staff.email,
      action: "view",
      subjectId: id,
      subjectCount: history.length,
      clientHash: await clientFingerprint(request),
      detail: "patient history",
    });

    return NextResponse.json(
      {
        history,
        visits: history.filter((item) => item.status === "completed").length,
        returning: history.length > 0,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "GET /api/bookings/[id]/history" });
    return NextResponse.json(
      { message: "Could not load this patient's history." },
      { status: 500 },
    );
  }
}
