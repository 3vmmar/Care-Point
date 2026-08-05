/**
 * iCalendar generation for confirmed appointments.
 *
 * A booking that exists only on a web page is a booking the patient forgets.
 * The `.ics` puts it in whatever calendar they actually use, with the clinic
 * address and a reminder already attached.
 */

// Explicit extensions so the Node test runner's type stripping, which uses real
// ESM resolution, can load this module directly.
import { CONTACT, findBranch, serviceLabel } from "./clinic.ts";
import { appointmentPractitioner } from "./appointment-presentation.ts";
import { addMinutesToSlot, clinicInstant, type DateKey } from "./dates.ts";

export type CalendarEvent = {
  id: string;
  branch: string;
  service: string;
  slotDate: DateKey;
  slotTime: string;
  durationMinutes: number;
  practitioner?: string | null;
  language?: string;
  manageUrl?: string;
};

/** `20260801T130000Z` — the only timestamp form RFC 5545 accepts unzoned. */
function icsStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Escapes the characters RFC 5545 gives meaning to. Missing this is why so many
 * generated invites break on an address containing a comma.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds long lines to the 75-octet limit, as required by the spec. */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const chunks: string[] = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    chunks.push(` ${rest.slice(0, 72)}`);
    rest = rest.slice(72);
  }
  if (rest) chunks.push(` ${rest}`);
  return chunks.join("\r\n");
}

export function buildAppointmentIcs(event: CalendarEvent): string {
  const locale = event.language === "ar" ? "ar" : "en";
  const branch = findBranch(event.branch);
  const start = clinicInstant(event.slotDate, event.slotTime);
  const end = clinicInstant(
    event.slotDate,
    addMinutesToSlot(event.slotTime, event.durationMinutes),
  );

  const practitioner = appointmentPractitioner(event.service, event.practitioner);
  const branchName = branch ? (locale === "ar" ? branch.ar : branch.en) : event.branch;
  const address = branch
    ? locale === "ar"
      ? branch.addressAr
      : branch.addressEn
    : branchName;

  const description = [
    `${serviceLabel(event.service, locale)} — ${practitioner}`,
    branch ? `${locale === "ar" ? "الاتجاهات" : "Directions"}: ${branch.mapUrl}` : "",
    `${locale === "ar" ? "العيادة" : "Clinic"}: ${CONTACT.phoneDisplay}`,
    event.manageUrl
      ? `${locale === "ar" ? "إدارة الحجز" : "Manage this booking"}: ${event.manageUrl}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Care Point//Clinic OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@care-point`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${escapeText(`${serviceLabel(event.service, locale)} · ${practitioner}`)}`,
    `LOCATION:${escapeText(`${branchName} — ${address}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(
      locale === "ar" ? "موعدك في العيادة بعد ساعتين" : "Your clinic appointment is in 2 hours",
    )}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(fold).join("\r\n")}\r\n`;
}

export function icsFilename(event: Pick<CalendarEvent, "slotDate" | "slotTime">): string {
  return `care-point-${event.slotDate}-${event.slotTime.replace(":", "")}.ics`;
}
