import { NextRequest, NextResponse } from "next/server";
import {
  confirmAppointment,
  dailyLoad,
  getDashboardSummary,
  listAppointments,
  type AppointmentStatus,
} from "@/db/bookings";
import { requireStaffPermission, staffAllowlistConfigured } from "@/lib/auth";
import {
  getCatalogue,
  listCancellationReasons,
  type Catalogue,
} from "@/db/catalogue";
import { addDays, clinicTimeNow, clinicToday, isDateKey, isOpenDay } from "@/lib/dates";
import { capacityServiceIds, dayCapacity } from "@/lib/schedule";
import { reportError } from "@/lib/observability";
import { recordAccess } from "@/db/audit";
import { clientFingerprint } from "@/lib/request";

const NAME_MAX = 120;
const EMAIL_MAX = 200;
const NOTE_MAX = 500;
/** Deliberately permissive: international formats vary, we only reject nonsense. */
const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/;

const VALID_STATUSES: AppointmentStatus[] = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
];

/** Patient records must never sit in a shared or browser cache. */
const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/**
 * Booked-vs-available for the next fortnight.
 *
 * The number of consultation slots a day holds is simply the length of the
 * branch's slot list, so utilisation needs no extra table — and it cannot drift
 * out of date when the clinic changes its hours, because it is derived from the
 * same live rota the booking page offers.
 */
function buildCapacity(
  today: string,
  branchFilter: string | undefined,
  load: Array<{ date: string; branch: string; total: number }>,
  catalogue: Catalogue,
) {
  const context = {
    branches: catalogue.branches,
    services: catalogue.services,
    closures: catalogue.closures,
    turnaround: catalogue.turnaroundMinutes,
  };
  // Surgical/non-surgical and Dental sessions are independent care tracks.
  // A Dental booking must therefore contribute both load and capacity; the
  // former aesthetic-only denominator made busy dental days look overbooked.
  // Shared with the growth analytics so both measure against one denominator.
  const capacityServices = capacityServiceIds(catalogue.services);
  return Array.from({ length: 14 }, (_, index) => {
    const date = addDays(today, index);
    const open = isOpenDay(date, catalogue.closures);
    const booked = load
      .filter((row) => row.date === date)
      .reduce((sum, row) => sum + row.total, 0);
    // Capacity varies by weekday, because the sessions do.
    const total = open
      ? capacityServices.reduce(
          (sum, service) => sum + dayCapacity(date, service, branchFilter, context),
          0,
        )
      : 0;
    return {
      date,
      open,
      booked,
      total,
      percent: total > 0 ? Math.round((booked / total) * 100) : 0,
    };
  });
}

/**
 * Staff-only: this response contains patient names, phone numbers and email
 * addresses. It must never be reachable unauthenticated, and a role that has no
 * business reading patient contact details — the read-only auditor — is refused
 * here rather than being handed the list and asked not to look.
 */
export async function GET(request: NextRequest) {
  const gate = await requireStaffPermission("patient:read", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;
  const staff = gate.staff;

  const params = request.nextUrl.searchParams;
  const statusParam = params.get("status");
  const branchParam = params.get("branch");
  const from = params.get("from");
  const to = params.get("to");

  try {
    const today = clinicToday();
    const catalogue = await getCatalogue();
    const branchFilter = catalogue.branches.some((branch) => branch.id === branchParam)
      ? (branchParam as string)
      : undefined;

    const [list, summary, load] = await Promise.all([
      listAppointments({
        from: isDateKey(from) ? from : undefined,
        to: isDateKey(to) ? to : undefined,
        branch: branchFilter,
        status:
          statusParam === "active"
            ? "active"
            : VALID_STATUSES.includes(statusParam as AppointmentStatus)
              ? (statusParam as AppointmentStatus)
              : undefined,
        search: params.get("q")?.trim().slice(0, 120) || undefined,
        limit: Number(params.get("limit")) || 100,
        offset: Number(params.get("offset")) || 0,
      }),
      getDashboardSummary({ branch: branchFilter }),
      dailyLoad({ from: today, to: addDays(today, 13), branch: branchFilter }),
    ]);

    const timeNow = clinicTimeNow();

    // Reading the list is a read of patient contact details, so it is audited
    // like any other. Awaited rather than fired-and-forgotten: a Worker can be
    // torn down the moment the response is returned.
    await recordAccess({
      actor: staff.email,
      action: "list",
      subjectCount: list.appointments.length,
      clientHash: await clientFingerprint(request),
      detail: params.toString() || null,
    });

    return NextResponse.json(
      {
        appointments: list.appointments,
        // Kept for any client still reading the original field name.
        bookings: list.appointments,
        total: list.total,
        limit: list.limit,
        offset: list.offset,
        summary: {
          ...summary,
          // Counted here because only the request knows the clinic wall clock.
          todayRemaining: list.appointments.filter(
            (appointment) =>
              appointment.slotDate === today &&
              appointment.slotTime >= timeNow &&
              (appointment.status === "confirmed" || appointment.status === "checked_in"),
          ).length,
        },
        // Capacity is derived from the published slot lists rather than stored,
        // so "how full are we" stays correct the moment opening times change.
        capacity: buildCapacity(today, branchFilter, load, catalogue),
        /**
         * The live timetable, so the dashboard's branch and service pickers, its
         * day timeline and its "add appointment" form all offer exactly what the
         * booking API will accept.
         */
        catalogue: {
          revision: catalogue.revision,
          live: catalogue.live,
          // The whole branch, so the dashboard's schedule views can pass these
          // straight to the same `generateSlots` the server uses. Three rows of
          // addresses is a trivial payload next to two divergent timetables.
          branches: catalogue.branches,
          services: catalogue.services,
          closures: catalogue.closures,
          turnaroundMinutes: catalogue.turnaroundMinutes,
        },
        /** Offered when staff cancel, so the reason is picked rather than typed. */
        cancellationReasons: await listCancellationReasons("staff"),
        clinicToday: today,
        clinicTime: timeNow,
        staff: {
          name: staff.displayName,
          email: staff.email,
          roles: staff.roles,
          // The dashboard hides what this person cannot do rather than offering
          // buttons that return 403. The server still enforces every one of them.
          permissions: staff.permissions,
        },
        allowlistConfigured: staffAllowlistConfigured(),
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "GET /api/bookings" });
    return NextResponse.json(
      { message: "The appointment database is unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    holdToken?: unknown;
    patientName?: unknown;
    patientPhone?: unknown;
    patientEmail?: unknown;
    patientNote?: unknown;
    language?: unknown;
    consent?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const holdToken = typeof body.holdToken === "string" ? body.holdToken.trim() : "";
  const patientName =
    typeof body.patientName === "string" ? body.patientName.trim() : "";
  const patientPhone =
    typeof body.patientPhone === "string" ? body.patientPhone.trim() : "";
  const patientEmail =
    typeof body.patientEmail === "string" ? body.patientEmail.trim() : "";
  const patientNote =
    typeof body.patientNote === "string" ? body.patientNote.trim() : "";
  const language = body.language === "ar" ? "ar" : "en";

  if (!holdToken || !patientName || !patientPhone) {
    return NextResponse.json(
      { message: "Name and phone number are required." },
      { status: 400 },
    );
  }
  if (
    patientName.length > NAME_MAX ||
    patientEmail.length > EMAIL_MAX ||
    patientNote.length > NOTE_MAX
  ) {
    return NextResponse.json({ message: "Those details look too long." }, { status: 400 });
  }
  if (!PHONE_PATTERN.test(patientPhone)) {
    return NextResponse.json(
      { message: "Please enter a valid phone number." },
      { status: 400 },
    );
  }
  // Consent to be contacted is a condition of booking and is recorded against
  // the appointment, so it has to be verified server-side rather than trusted
  // to a `required` checkbox in the browser.
  if (body.consent !== true) {
    return NextResponse.json(
      { message: "Please agree to be contacted so the clinic can confirm your visit." },
      { status: 400 },
    );
  }

  try {
    const booking = await confirmAppointment({
      holdToken,
      patientName,
      patientPhone,
      patientEmail: patientEmail || undefined,
      patientNote: patientNote || undefined,
      language,
    });
    if (!booking) {
      return NextResponse.json(
        { message: "This hold expired. Please choose a new time." },
        { status: 410 },
      );
    }

    const manageUrl = booking.manageToken
      ? new URL(`/appointment/${booking.manageToken}`, request.nextUrl.origin).toString()
      : undefined;

    return NextResponse.json(
      {
        booking: {
          id: booking.id,
          reference: booking.id.slice(0, 8).toUpperCase(),
          branch: booking.branch,
          service: booking.service,
          slotDate: booking.slotDate,
          slotTime: booking.slotTime,
          manageToken: booking.manageToken,
          manageUrl,
        },
      },
      { status: 201, headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "POST /api/bookings" });
    return NextResponse.json(
      { message: "We could not confirm the appointment." },
      { status: 500 },
    );
  }
}
