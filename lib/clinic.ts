/**
 * Single source of truth for clinic configuration.
 *
 * Everything a non-developer might need to change lives here: branches, opening
 * times, closed days, holiday closures, contact details and consultation types.
 * These values are shared by the API routes, the patient UI and the Clinic OS
 * dashboard so the three can never drift apart.
 *
 * Contact details and branch addresses below are taken from the practice's
 * public website (drashrafmetwally.com). Confirm the WhatsApp number and the
 * exact Google Maps pins with the clinic before launch — the map links are
 * address searches, not verified place IDs.
 */

export const CLINIC_TIMEZONE = "Africa/Cairo";

/** Days the clinic is closed, as JS day indices (0 = Sunday). Friday in Cairo. */
export const CLOSED_WEEKDAYS = [5];

/**
 * One-off closures: public holidays, Eid, conference travel, planned leave.
 * Dates are clinic-local `YYYY-MM-DD`. Past entries are harmless — the booking
 * window only ever looks forward — but pruning them yearly keeps this readable.
 */
export type Closure = { date: string; en: string; ar: string };

export const CLINIC_CLOSURES: Closure[] = [
  // Example shape — replace with the clinic's real calendar:
  // { date: "2026-04-20", en: "Eid al-Fitr", ar: "عيد الفطر" },
];

const CLOSURE_DATES = new Set(CLINIC_CLOSURES.map((closure) => closure.date));

export function isClosureDate(date: string): boolean {
  return CLOSURE_DATES.has(date);
}

export function findClosure(date: string): Closure | undefined {
  return CLINIC_CLOSURES.find((closure) => closure.date === date);
}

/** How many open days the booking calendar offers at a time. */
export const AVAILABILITY_WINDOW_DAYS = 14;

/**
 * Minimum notice before a consultation, in hours. Same-day booking is allowed
 * as long as the slot is still this far away, so late-afternoon demand is not
 * thrown away — which a hard "tomorrow onwards" rule used to do.
 */
export const BOOKING_LEAD_HOURS = 4;

/** How long a slot is held while the patient completes their details. */
export const HOLD_DURATION_MINUTES = 5;

export const DEFAULT_APPOINTMENT_MINUTES = 45;

/** Bumped whenever the consent wording changes, so stored consent is auditable. */
export const CONSENT_VERSION = "2026-07-contact-consent-v1";

/**
 * How long confirmed patient contact details are retained after the visit.
 * A scheduled purge clears name/phone/email past this point while keeping the
 * anonymous appointment row for reporting. Egypt's PDPL (151/2018) expects a
 * defined retention period rather than indefinite storage.
 */
export const PII_RETENTION_DAYS = 540;

/**
 * How long the staff access audit trail is kept.
 *
 * Deliberately longer than patient contact details: an audit log is only useful
 * if it outlives the incident someone needs it to investigate. Not indefinite,
 * because it identifies staff.
 */
export const AUDIT_RETENTION_DAYS = 1095;

/**
 * Minutes left between the end of one appointment and the start of the next,
 * for notes, cleaning and turning the room around.
 */
export const CLINIC_TURNAROUND_MINUTES = 10;

export const PRACTITIONERS = {
  surgeon: "Dr. Ashraf Metwally",
  dental: "Dental team",
} as const;

export type PractitionerId = (typeof PRACTITIONERS)[keyof typeof PRACTITIONERS];

/**
 * A block of time a practitioner is physically at a branch.
 *
 * This replaced a flat list of start times that was identical every day of the
 * week. Slots are now generated from sessions and the requested service's
 * duration, so a 60-minute rhinoplasty consultation and a 30-minute laser
 * follow-up no longer pretend to occupy the same amount of the day.
 */
export type Session = {
  /** JS day index, 0 = Sunday. */
  weekday: number;
  /** Clinic-local `HH:mm`, on a 15-minute boundary. */
  start: string;
  end: string;
  /** Gap between offered start times, in minutes. */
  interval: number;
  practitioner: string;
  /** Lines of care bookable in this session. */
  categories: ServiceCategory[];
};

export type BranchId = "Maadi" | "Mohandessin" | "Fifth Settlement";

export type Branch = {
  id: BranchId;
  en: string;
  ar: string;
  addressEn: string;
  addressAr: string;
  mapUrl: string;
  /**
   * TODO(clinic): PLACEHOLDER HOURS. These have a realistic shape but are not
   * the practice's real timetable. Replace with the confirmed schedule before
   * launch — `validateSchedule` will catch structural mistakes, but it cannot
   * know whether the clinic actually opens on a Tuesday.
   */
  sessions: Session[];
};

export const BRANCHES: Branch[] = [
  {
    id: "Maadi",
    en: "Maadi",
    ar: "المعادي",
    addressEn: "Othman Towers, Maadi, Cairo",
    addressAr: "أبراج عثمان، المعادي، القاهرة",
    mapUrl: "https://maps.google.com/?q=Othman+Towers+Maadi+Cairo",
    sessions: [
      // Surgeon: Sunday, Tuesday, Thursday evenings.
      { weekday: 0, start: "16:00", end: "21:00", interval: 30, practitioner: PRACTITIONERS.surgeon, categories: ["surgical", "nonsurgical"] },
      { weekday: 2, start: "16:00", end: "21:00", interval: 30, practitioner: PRACTITIONERS.surgeon, categories: ["surgical", "nonsurgical"] },
      { weekday: 4, start: "16:00", end: "21:00", interval: 30, practitioner: PRACTITIONERS.surgeon, categories: ["surgical", "nonsurgical"] },
      // Dental runs in parallel, in a different room, earlier in the day.
      { weekday: 0, start: "12:00", end: "16:00", interval: 30, practitioner: PRACTITIONERS.dental, categories: ["dental"] },
      { weekday: 2, start: "12:00", end: "16:00", interval: 30, practitioner: PRACTITIONERS.dental, categories: ["dental"] },
      { weekday: 4, start: "12:00", end: "16:00", interval: 30, practitioner: PRACTITIONERS.dental, categories: ["dental"] },
    ],
  },
  {
    id: "Mohandessin",
    en: "Mohandessin",
    ar: "المهندسين",
    addressEn: "Syria Street, Mohandessin, Giza",
    addressAr: "شارع سوريا، المهندسين، الجيزة",
    mapUrl: "https://maps.google.com/?q=Syria+Street+Mohandessin+Giza",
    sessions: [
      // Surgeon: Monday and Wednesday mornings.
      { weekday: 1, start: "10:00", end: "14:00", interval: 30, practitioner: PRACTITIONERS.surgeon, categories: ["surgical", "nonsurgical"] },
      { weekday: 3, start: "10:00", end: "14:00", interval: 30, practitioner: PRACTITIONERS.surgeon, categories: ["surgical", "nonsurgical"] },
      { weekday: 1, start: "14:00", end: "18:00", interval: 30, practitioner: PRACTITIONERS.dental, categories: ["dental"] },
      { weekday: 3, start: "14:00", end: "18:00", interval: 30, practitioner: PRACTITIONERS.dental, categories: ["dental"] },
    ],
  },
  {
    id: "Fifth Settlement",
    en: "Fifth Settlement",
    ar: "التجمع الخامس",
    addressEn: "North 95, Fifth Settlement, New Cairo",
    addressAr: "شمال ٩٥، التجمع الخامس، القاهرة الجديدة",
    mapUrl: "https://maps.google.com/?q=North+95+Fifth+Settlement+New+Cairo",
    sessions: [
      // Surgeon: Saturday daytime and Monday evening.
      { weekday: 6, start: "12:00", end: "17:00", interval: 30, practitioner: PRACTITIONERS.surgeon, categories: ["surgical", "nonsurgical"] },
      { weekday: 1, start: "17:00", end: "21:00", interval: 30, practitioner: PRACTITIONERS.surgeon, categories: ["surgical", "nonsurgical"] },
      { weekday: 6, start: "10:00", end: "12:00", interval: 30, practitioner: PRACTITIONERS.dental, categories: ["dental"] },
    ],
  },
];

export const BRANCH_IDS = BRANCHES.map((branch) => branch.id);

export function findBranch(id: string | null | undefined): Branch | undefined {
  return BRANCHES.find((branch) => branch.id === id);
}

/**
 * Every distinct start time a branch runs across the week, for display only.
 * Real bookable slots depend on the service and the day — see `lib/schedule.ts`.
 */
export function branchSessionSummary(branch: Branch): string[] {
  return Array.from(new Set(branch.sessions.map((session) => session.start))).sort();
}

/** `Sun · Tue · Thu` — the days a branch opens, for the locations section. */
export function branchOpenDays(branch: Branch, locale: "en" | "ar" = "en"): string[] {
  const names =
    locale === "ar"
      ? ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = Array.from(new Set(branch.sessions.map((s) => s.weekday))).sort();
  return days.map((day) => names[day]);
}

export function branchLabel(id: string, locale: "en" | "ar" = "en"): string {
  const branch = findBranch(id);
  if (!branch) return id;
  return locale === "ar" ? branch.ar : branch.en;
}

/** The practice runs three lines of care; the booking form groups by these. */
export type ServiceCategory = "surgical" | "nonsurgical" | "dental";

export const SERVICE_CATEGORIES: Array<{
  id: ServiceCategory;
  en: string;
  ar: string;
}> = [
  { id: "surgical", en: "Surgical", ar: "جراحي" },
  { id: "nonsurgical", en: "Non-surgical", ar: "بدون جراحة" },
  { id: "dental", en: "Dental", ar: "الأسنان" },
];

export type Service = {
  id: string;
  en: string;
  ar: string;
  category: ServiceCategory;
  /** Chair time, used for the calendar invite and the clinic day view. */
  durationMinutes: number;
};

export const SERVICES: Service[] = [
  { id: "aesthetic", en: "Aesthetic consultation", ar: "استشارة تجميلية", category: "surgical", durationMinutes: 45 },
  { id: "face", en: "Face & neck consultation", ar: "استشارة الوجه والرقبة", category: "surgical", durationMinutes: 45 },
  { id: "nose", en: "Rhinoplasty consultation", ar: "استشارة تجميل الأنف", category: "surgical", durationMinutes: 60 },
  { id: "body", en: "Body contouring consultation", ar: "استشارة تنسيق القوام", category: "surgical", durationMinutes: 60 },
  { id: "breast", en: "Breast surgery consultation", ar: "استشارة جراحات الثدي", category: "surgical", durationMinutes: 60 },
  { id: "nonsurgical", en: "Non-surgical aesthetics", ar: "تجميل بدون جراحة", category: "nonsurgical", durationMinutes: 30 },
  { id: "skin", en: "Laser & skin rejuvenation", ar: "الليزر وتجديد البشرة", category: "nonsurgical", durationMinutes: 30 },
  { id: "dental-check", en: "Dental consultation & cleaning", ar: "استشارة وتنظيف الأسنان", category: "dental", durationMinutes: 45 },
  { id: "dental-cosmetic", en: "Veneers & whitening", ar: "الفينير وتبييض الأسنان", category: "dental", durationMinutes: 60 },
  { id: "dental-implant", en: "Dental implants", ar: "زراعة الأسنان", category: "dental", durationMinutes: 60 },
];

export function servicesInCategory(category: ServiceCategory): Service[] {
  return SERVICES.filter((service) => service.category === category);
}

export const SERVICE_IDS = SERVICES.map((service) => service.id);

export function findService(id: string | null | undefined): Service | undefined {
  return SERVICES.find((service) => service.id === id);
}

export function serviceLabel(id: string, locale: "en" | "ar" = "en"): string {
  const service = findService(id);
  if (!service) return id;
  return locale === "ar" ? service.ar : service.en;
}

export function serviceDuration(id: string): number {
  return findService(id)?.durationMinutes ?? DEFAULT_APPOINTMENT_MINUTES;
}

export const CONTACT = {
  phone: "+201002202453",
  phoneDisplay: "0100 220 2453",
  /** International format, no leading zero — required by wa.me links. */
  whatsapp: "201002202453",
  email: "info@drashrafmetwally.com",
};

export const WHATSAPP_URL = `https://wa.me/${CONTACT.whatsapp}`;

export const DOCTOR = {
  nameEn: "Dr. Ashraf Metwally",
  nameAr: "د. أشرف متولي",
  titleEn: "Consultant Plastic Surgeon",
  titleAr: "استشاري جراحات التجميل",
  credentials: "FRCS · EBOPRAS",
};
