import { NextRequest, NextResponse } from "next/server";
import { recordAccess } from "@/db/audit";
import {
  deactivatePractitioner,
  getCatalogueForEditing,
  removeClosure,
  removeSession,
  saveClosure,
  savePractitioner,
  saveServiceDuration,
  saveSession,
} from "@/db/catalogue";
import { requireStaffPermission } from "@/lib/auth";
import { dayName } from "@/lib/schedule";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

/**
 * The clinic's own timetable, editable by the clinic.
 *
 * Until now branches, services, sessions and closures were constants in
 * `lib/clinic.ts`, which meant the practice could not change its opening hours
 * without a developer and a deploy — and the hours in that file were
 * acknowledged placeholders. This is the endpoint that makes the real timetable
 * enterable the moment the clinic supplies it.
 *
 * Reading needs no special permission beyond being staff: everyone who works
 * here needs to know when the clinic is open. Writing needs `catalogue:write`,
 * which reception does not have, because removing a session silently withdraws
 * every slot inside it from the public booking page.
 */

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

export async function GET(request: NextRequest) {
  const gate = await requireStaffPermission("patient:read", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;

  try {
    const catalogue = await getCatalogueForEditing();
    return NextResponse.json(
      { ...catalogue, canEdit: gate.staff.permissions.includes("catalogue:write") },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/catalogue" });
    return NextResponse.json(
      { message: "The clinic timetable is unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const clientHash = await clientFingerprint(request);
  const gate = await requireStaffPermission("catalogue:write", { clientHash });
  if (!gate.ok) return gate.response;
  const actor = gate.staff.email;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const text = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const number = (key: string) => Number(body[key]);

  try {
    let detail = action;

    if (action === "session") {
      const weekday = number("weekday");
      await saveSession({
        id: text("id") || undefined,
        branchId: text("branchId"),
        practitionerId: text("practitionerId"),
        weekday,
        start: text("start"),
        end: text("end"),
        interval: number("interval"),
        categories: Array.isArray(body.categories)
          ? body.categories.filter((entry): entry is string => typeof entry === "string")
          : [],
        actor,
      });
      detail = `session ${text("branchId")} ${dayName(weekday)} ${text("start")}–${text("end")}`;
    } else if (action === "remove_session") {
      if (!(await removeSession(text("id")))) {
        return NextResponse.json(
          { message: "That session has already been removed." },
          { status: 409, headers: PRIVATE_HEADERS },
        );
      }
      detail = `removed session ${text("id")}`;
    } else if (action === "service") {
      await saveServiceDuration({
        id: text("id"),
        durationMinutes: number("durationMinutes"),
        turnaroundMinutes:
          body.turnaroundMinutes === undefined ? undefined : number("turnaroundMinutes"),
      });
      detail = `service ${text("id")} → ${number("durationMinutes")} min`;
    } else if (action === "practitioner") {
      const id = await savePractitioner({
        id: text("id") || undefined,
        nameEn: text("nameEn"),
        nameAr: text("nameAr"),
        departmentId: text("departmentId"),
        titleEn: text("titleEn"),
        titleAr: text("titleAr"),
        actor,
      });
      detail = `practitioner ${id}`;
    } else if (action === "remove_practitioner") {
      await deactivatePractitioner(text("id"));
      detail = `removed practitioner ${text("id")}`;
    } else if (action === "closure") {
      await saveClosure({ date: text("date"), en: text("en"), ar: text("ar"), actor });
      detail = `closure ${text("date")}`;
    } else if (action === "remove_closure") {
      if (!(await removeClosure(text("date")))) {
        return NextResponse.json(
          { message: "There is no closure on that date." },
          { status: 409, headers: PRIVATE_HEADERS },
        );
      }
      detail = `reopened ${text("date")}`;
    } else {
      return NextResponse.json({ message: "Unknown timetable action." }, { status: 400 });
    }

    // A rota change alters what every patient is offered, so it belongs in the
    // same trail as a patient-record change rather than in a log nobody reads.
    await recordAccess({
      actor,
      action: "update",
      subjectId: "catalogue",
      clientHash,
      detail,
    });

    return NextResponse.json(
      { ok: true, ...(await getCatalogueForEditing()), canEdit: true },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "That change did not save.";
    // Validation messages are written for the clinic to read — a rejected rota
    // has to say which rule it broke, or the only way to find out is to guess.
    if (
      /must|cannot|choose|does not exist|overlapping|also at|no sessions|HH:mm|longer than|needs a name|Remove this practitioner|not in the directory/i.test(
        message,
      )
    ) {
      return NextResponse.json({ message }, { status: 400, headers: PRIVATE_HEADERS });
    }
    await reportError(error, { where: `POST /api/clinic/catalogue ${action || "unknown"}` });
    return NextResponse.json(
      { message: "That change did not save." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
