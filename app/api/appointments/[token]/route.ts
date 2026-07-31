import { NextRequest, NextResponse } from "next/server";
import {
  cancelByManageToken,
  getAppointmentByManageToken,
  rescheduleByManageToken,
} from "@/db/bookings";
import { AVAILABILITY_WINDOW_DAYS, findBranch } from "@/lib/clinic";
import { isSlotBookable, openDayKeys } from "@/lib/dates";
import { generateSlots } from "@/lib/schedule";
import { reportError } from "@/lib/observability";

/**
 * Patient self-service, authorised by an unguessable per-appointment token.
 *
 * Without this the only way to change a booking is to phone the clinic during
 * opening hours, which is the main reason no-show rates climb: a patient who
 * cannot cancel simply does not turn up.
 */
const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

function summarise(appointment: {
  id: string;
  status: string;
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  patientName: string | null;
  language: string;
}) {
  return {
    reference: appointment.id.slice(0, 8).toUpperCase(),
    status: appointment.status,
    branch: appointment.branch,
    service: appointment.service,
    slotDate: appointment.slotDate,
    slotTime: appointment.slotTime,
    // Enough to reassure the right person they have the right booking, without
    // exposing the phone number or email to anyone holding the link.
    patientName: appointment.patientName,
    language: appointment.language,
  };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const appointment = await getAppointmentByManageToken(token);
  if (!appointment) {
    return NextResponse.json(
      { message: "This booking link is no longer valid." },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }
  return NextResponse.json(
    { appointment: summarise(appointment) },
    { headers: PRIVATE_HEADERS },
  );
}

/** Reschedule to another offered slot. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;

  let body: { slotDate?: unknown; slotTime?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const existing = await getAppointmentByManageToken(token);
  if (!existing || existing.status !== "confirmed") {
    return NextResponse.json(
      { message: "This booking can no longer be changed online." },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }

  const slotDate = typeof body.slotDate === "string" ? body.slotDate : "";
  const slotTime = typeof body.slotTime === "string" ? body.slotTime : "";
  const branch = findBranch(existing.branch);
  const now = new Date();

  if (
    !branch ||
    !openDayKeys(AVAILABILITY_WINDOW_DAYS, now).includes(slotDate) ||
    !generateSlots(branch, slotDate, existing.service).some((s) => s.time === slotTime) ||
    !isSlotBookable(slotDate, slotTime, now)
  ) {
    return NextResponse.json({ message: "Please choose a valid time." }, { status: 400 });
  }

  try {
    const appointment = await rescheduleByManageToken({ token, slotDate, slotTime });
    if (!appointment) {
      return NextResponse.json(
        { message: "This booking can no longer be changed online." },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }

    return NextResponse.json(
      { appointment: summarise(appointment) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
      return NextResponse.json(
        { message: "That time was just taken. Please choose another." },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    await reportError(error, { where: "PATCH /api/appointments/[token]" });
    return NextResponse.json({ message: "We could not move that booking." }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const existing = await getAppointmentByManageToken(token);
  if (!existing) {
    return NextResponse.json(
      { message: "This booking link is no longer valid." },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }

  const cancelled = await cancelByManageToken(token);
  if (!cancelled) {
    return NextResponse.json(
      { message: "This booking has already been cancelled or has passed." },
      { status: 409, headers: PRIVATE_HEADERS },
    );
  }

  return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
}
