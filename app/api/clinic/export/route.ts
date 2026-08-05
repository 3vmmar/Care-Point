import { NextRequest, NextResponse } from "next/server";
import { listAppointments, type AppointmentStatus } from "@/db/bookings";
import { recordAccess } from "@/db/audit";
import { requireStaffPermission } from "@/lib/auth";
import { BRANCH_IDS } from "@/lib/clinic";
import {
  APPOINTMENT_EXPORT_HEADER,
  appointmentExportRow,
} from "@/lib/appointment-presentation";
import { isDateKey } from "@/lib/dates";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";
import { csvDocument } from "@/lib/csv";

/**
 * Bulk export of the appointment book.
 *
 * This exists as a server endpoint rather than a `Blob` assembled in the browser
 * for two reasons that matter more than convenience:
 *
 *  - **It can be refused.** `patient:export` is the one permission that separates
 *    "needs a patient's number to ring them" from "can walk out with the whole
 *    book", and reception does not hold it. A client-side export cannot enforce
 *    that, because the rows are already in the page.
 *  - **It can be recorded.** A file built in the browser leaves no trace. Under
 *    PDPL the practice has to be able to say who took a copy of the register and
 *    when; that answer only exists if the export goes through the server.
 */

const STATUSES: AppointmentStatus[] = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
];

export async function GET(request: NextRequest) {
  const clientHash = await clientFingerprint(request);
  const gate = await requireStaffPermission("patient:export", { clientHash });
  if (!gate.ok) return gate.response;
  const staff = gate.staff;

  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const branch = params.get("branch");
  const status = params.get("status");

  try {
    const list = await listAppointments({
      from: isDateKey(from) ? from : undefined,
      to: isDateKey(to) ? to : undefined,
      branch: branch && BRANCH_IDS.includes(branch as never) ? branch : undefined,
      status: STATUSES.includes(status as AppointmentStatus)
        ? (status as AppointmentStatus)
        : undefined,
      search: params.get("q")?.trim().slice(0, 120) || undefined,
      // Bounded so one request cannot pull an unbounded register into memory.
      limit: 1000,
      offset: 0,
    });

    const rows = list.appointments.map(appointmentExportRow);

    await recordAccess({
      actor: staff.email,
      action: "export",
      subjectCount: list.appointments.length,
      clientHash,
      detail: `csv export${params.toString() ? ` ${params.toString()}` : ""}`,
    });

    // `csvDocument` applies the formula guard and the byte-order mark, and is
    // shared with the data-subject export so the two cannot drift apart again.
    const csv = csvDocument(APPOINTMENT_EXPORT_HEADER, rows);
    const filename = `care-point-${from && isDateKey(from) ? from : "schedule"}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/export" });
    return NextResponse.json(
      { message: "The export could not be produced." },
      { status: 500, headers: { "Cache-Control": "no-store, private" } },
    );
  }
}
