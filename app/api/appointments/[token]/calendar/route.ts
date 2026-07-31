import { NextRequest } from "next/server";
import { getAppointmentByManageToken } from "@/db/bookings";
import { buildAppointmentIcs, icsFilename } from "@/lib/ics";

/**
 * The `.ics` for a confirmed appointment.
 *
 * Served from the manage token rather than the appointment id, so the link is
 * safe to put in a confirmation email: it exposes nothing the recipient does
 * not already hold, and it stops working once the booking is cancelled.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const appointment = await getAppointmentByManageToken(token);

  if (!appointment || appointment.status === "cancelled") {
    return new Response("This booking link is no longer valid.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const manageUrl = new URL(`/appointment/${token}`, request.nextUrl.origin).toString();
  const body = buildAppointmentIcs({
    id: appointment.id,
    branch: appointment.branch,
    service: appointment.service,
    slotDate: appointment.slotDate,
    slotTime: appointment.slotTime,
    durationMinutes: appointment.durationMinutes,
    language: appointment.language,
    manageUrl,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFilename(appointment)}"`,
      "Cache-Control": "no-store, private",
    },
  });
}
