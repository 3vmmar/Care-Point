/**
 * Shared presentation rules for appointment records.
 *
 * Appointments created before practitioner attribution was introduced can have
 * a null practitioner. Falling back from the service category keeps those
 * legacy records useful without ever attributing a dental visit to the plastic
 * surgeon.
 */

import {
  PRACTITIONERS,
  SERVICE_CATEGORIES,
  branchLabel,
  findService,
  serviceLabel,
} from "./clinic.ts";

export function appointmentPractitioner(
  service: string,
  practitioner?: string | null,
): string {
  const stored = practitioner?.trim();
  if (stored) return stored;

  return findService(service)?.category === "dental"
    ? PRACTITIONERS.dental
    : PRACTITIONERS.surgeon;
}

export function treatmentCategoryLabel(
  service: string,
  locale: "en" | "ar" = "en",
): string {
  const categoryId = findService(service)?.category;
  const category = SERVICE_CATEGORIES.find((entry) => entry.id === categoryId);
  if (!category) return locale === "ar" ? "غير مصنف" : "Uncategorised";
  return locale === "ar" ? category.ar : category.en;
}

export const APPOINTMENT_EXPORT_HEADER = [
  "Date",
  "Time",
  "Patient",
  "Phone",
  "Email",
  "Consultation",
  "Treatment category",
  "Practitioner",
  "Clinic",
  "Status",
  "Source",
  "Note",
] as const;

export type ExportableAppointment = {
  slotDate: string;
  slotTime: string;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  service: string;
  practitioner?: string | null;
  branch: string;
  status: string;
  source: string;
  staffNote: string | null;
  patientNote: string | null;
};

export function appointmentExportRow(
  appointment: ExportableAppointment,
): Array<string | null> {
  return [
    appointment.slotDate,
    appointment.slotTime,
    appointment.patientName,
    appointment.patientPhone,
    appointment.patientEmail,
    serviceLabel(appointment.service),
    treatmentCategoryLabel(appointment.service),
    appointmentPractitioner(appointment.service, appointment.practitioner),
    branchLabel(appointment.branch),
    appointment.status,
    appointment.source,
    appointment.staffNote ?? appointment.patientNote,
  ];
}
