import type { Branch, Closure, Service } from "@/lib/clinic";
export type { AnalyticsWindowDays, ClinicAnalytics } from "@/db/analytics";

export type AppointmentStatus =
  | "confirmed"
  | "checked_in"
  | "completed"
  | "no_show"
  | "cancelled";

export type Appointment = {
  id: string;
  status: AppointmentStatus;
  branch: string;
  practitioner: string | null;
  service: string;
  slotDate: string;
  slotTime: string;
  durationMinutes: number;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  patientNote: string | null;
  staffNote: string | null;
  language: string;
  source: string;
  createdAt?: string;
  confirmedAt: string | null;
  checkedInAt: string | null;
  cancelledAt: string | null;
};

/** Booked vs available per day, derived server-side from the published slots. */
export type CapacityDay = {
  date: string;
  open: boolean;
  booked: number;
  total: number;
  percent: number;
};

/**
 * The live timetable, as the dashboard receives it from `/api/bookings`.
 *
 * The rota, service durations and closures now live in D1 so the clinic can edit
 * them. Anything on this surface that draws a schedule has to use this rather
 * than the constants in `lib/clinic.ts`, or the dashboard shows the hours the
 * code was deployed with while the booking page offers the ones the clinic set.
 */
export type LiveCatalogue = {
  revision: string;
  live: boolean;
  branches: Branch[];
  services: Service[];
  closures: Closure[];
  turnaroundMinutes: number;
};

export type Summary = {
  /** Why the last thirty days of cancellations happened; null reason = not asked. */
  cancellationReasons: Array<{ reason: string | null; total: number }>;
  today: number;
  todayRemaining: number;
  upcoming: number;
  next7Days: number;
  bookedLast7Days: number;
  cancelledLast30Days: number;
  noShowLast30Days: number;
  completedLast30Days: number;
  noShowRate: number;
  byBranch: Array<{ branch: string; total: number }>;
  byService: Array<{ service: string; total: number }>;
  byDay: Array<{ date: string; total: number }>;
  newestBookingAt: string | null;
};

export const STATUS_META: Record<AppointmentStatus, { label: string; tone: string }> = {
  confirmed: { label: "Confirmed", tone: "confirmed" },
  checked_in: { label: "Checked in", tone: "checked" },
  completed: { label: "Completed", tone: "completed" },
  no_show: { label: "No-show", tone: "missed" },
  cancelled: { label: "Cancelled", tone: "cancelled" },
};

export function initials(name: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
