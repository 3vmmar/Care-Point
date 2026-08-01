import { NextRequest, NextResponse } from "next/server";
import { createClinicAppointment } from "@/db/bookings";
import { requireStaffPermission } from "@/lib/auth";
import { getCatalogue } from "@/db/catalogue";
import { isDateKey, isOpenDay, isSlotTime } from "@/lib/dates";
import { generateSlots } from "@/lib/schedule";
import { reportError } from "@/lib/observability";
import { recordAccess } from "@/db/audit";
import { clientFingerprint } from "@/lib/request";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };
const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/;

/**
 * A booking taken at the desk or over the phone.
 *
 * Most of a clinic's appointments never touch the website. Without this, the
 * dashboard shows only online traffic and the day view is a partial picture —
 * which makes it useless as the doctor's actual schedule.
 *
 * Staff bookings deliberately skip the lead-time rule: reception is allowed to
 * add someone arriving in twenty minutes. They still respect closed days and
 * the slot uniqueness index.
 */
export async function POST(request: NextRequest) {
  const gate = await requireStaffPermission("patient:write", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;
  const staff = gate.staff;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");

  // The live timetable, so a desk booking obeys the same hours the patient site
  // offers. Reception and the website must never disagree about when the clinic
  // is open.
  const catalogue = await getCatalogue();
  const context = {
    services: catalogue.services,
    closures: catalogue.closures,
    turnaround: catalogue.turnaroundMinutes,
  };
  const branch = catalogue.branches.find((item) => item.id === text("branch"));
  const service = catalogue.services.find((item) => item.id === text("service"));
  const slotDate = text("slotDate");
  const slotTime = text("slotTime");
  const patientName = text("patientName");
  const patientPhone = text("patientPhone");
  const patientEmail = text("patientEmail");
  const staffNote = text("staffNote");
  const source = ["phone", "walk_in", "clinic"].includes(text("source"))
    ? (text("source") as "phone" | "walk_in" | "clinic")
    : "clinic";

  if (!branch || !service) {
    return NextResponse.json({ message: "Choose a clinic and consultation type." }, { status: 400 });
  }
  if (!isDateKey(slotDate) || !isOpenDay(slotDate, catalogue.closures)) {
    return NextResponse.json({ message: "That is not a day the clinic opens." }, { status: 400 });
  }
  const offered = isSlotTime(slotTime)
    ? generateSlots(branch, slotDate, service.id, context).find(
        (slot) => slot.time === slotTime,
      )
    : undefined;
  if (!offered) {
    return NextResponse.json(
      { message: "That time is not a consultation slot for this service at this clinic." },
      { status: 400 },
    );
  }
  if (!patientName || !PHONE_PATTERN.test(patientPhone)) {
    return NextResponse.json(
      { message: "A name and a valid phone number are required." },
      { status: 400 },
    );
  }

  try {
    const appointment = await createClinicAppointment({
      branch: branch.id,
      service: service.id,
      slotDate,
      slotTime,
      patientName,
      patientPhone,
      patientEmail: patientEmail || undefined,
      staffNote: staffNote || undefined,
      language: text("language") === "ar" ? "ar" : "en",
      source,
      // Resolved from the schedule, so a desk booking occupies the same room
      // in the same grid as an online one.
      practitioner: offered.practitioner,
      actor: staff.email,
    });
    await recordAccess({
      actor: staff.email,
      action: "create",
      subjectId: appointment?.id ?? null,
      clientHash: await clientFingerprint(request),
      detail: `${source} booking`,
    });

    return NextResponse.json({ appointment }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
      return NextResponse.json(
        { message: "That slot is already taken at this clinic." },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    await reportError(error, { where: "POST /api/clinic/appointments" });
    return NextResponse.json({ message: "We could not add that appointment." }, { status: 500 });
  }
}
