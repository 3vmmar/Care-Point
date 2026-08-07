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

/**
 * Days the clinic is closed, as JS day indices (0 = Sunday).
 *
 * Empty at the practice's instruction: every branch consults seven days a week,
 * including Friday, which is the customary closed day in Cairo and was coded as
 * such until 2026-08-07. Put `5` back to restore it.
 */
export const CLOSED_WEEKDAYS: number[] = [];

/**
 * Whether one practitioner may be rostered at more than one branch at the same
 * time.
 *
 * **This is off by default for a reason, and it is on at the practice's explicit
 * instruction.** The rota now lists Dr. Ashraf Metwally at Maadi and Fifth
 * Settlement 11:00–19:00 every day, and at Mohandessin 18:00–22:00, so the
 * overlaps are deliberate rather than an editing slip.
 *
 * What this actually changes, and what it does not:
 *
 *  - `validateSchedule` stops reporting cross-branch concurrency. It still
 *    refuses two overlapping sessions for the same person *at one branch*,
 *    which is always a mistake.
 *  - The database never enforced this anyway. `appointment_cells` is keyed on
 *    (branch, practitioner, date, cell), so the same clinician at two branches
 *    in the same fifteen minutes was always representable. The validator was
 *    the only thing objecting, at configuration time.
 *
 * So the consequence is operational, not technical: the public booking page can
 * now offer the same clinician in Maadi and New Cairo at 12:00 on the same day,
 * and nothing downstream will catch it. Whoever runs the desk has to.
 *
 * Set this back to `false` and the guard returns immediately.
 */
export const PRACTITIONERS_MAY_SPAN_BRANCHES = true;

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
   * Set by the practice on 2026-08-07: every branch, every day. Maadi and Fifth
   * Settlement 11:00–19:00, Mohandessin 18:00–22:00.
   *
   * These are the seed and the fallback. The live rota is in D1 and is edited
   * from Clinic OS → Hours; a change there does not come back here, so treat
   * this as the shape a fresh database starts from rather than as the current
   * truth.
   */
  sessions: Session[];
};

/**
 * The same sitting on every day of the week.
 *
 * The practice runs a single daily window per branch rather than a rotating
 * rota, so writing forty-two literal rows would be seven chances per branch to
 * fat-finger a time and no way to see at a glance that they match.
 */
function daily(
  start: string,
  end: string,
  practitioner: string,
  categories: ServiceCategory[],
  interval = 30,
): Session[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    start,
    end,
    interval,
    practitioner,
    categories,
  }));
}

export const BRANCHES: Branch[] = [
  {
    id: "Maadi",
    en: "Maadi",
    ar: "المعادي",
    addressEn: "Othman Towers, Maadi, Cairo",
    addressAr: "أبراج عثمان، المعادي، القاهرة",
    mapUrl: "https://maps.google.com/?q=Othman+Towers+Maadi+Cairo",
    // 11:00–19:00, seven days. Dental runs the same window in its own room.
    sessions: [
      ...daily("11:00", "19:00", PRACTITIONERS.surgeon, ["surgical", "nonsurgical"]),
      ...daily("11:00", "19:00", PRACTITIONERS.dental, ["dental"]),
    ],
  },
  {
    id: "Mohandessin",
    en: "Mohandessin",
    ar: "المهندسين",
    addressEn: "Syria Street, Mohandessin, Giza",
    addressAr: "شارع سوريا، المهندسين، الجيزة",
    mapUrl: "https://maps.google.com/?q=Syria+Street+Mohandessin+Giza",
    // 18:00–22:00, seven days. The evening branch.
    sessions: [
      ...daily("18:00", "22:00", PRACTITIONERS.surgeon, ["surgical", "nonsurgical"]),
      ...daily("18:00", "22:00", PRACTITIONERS.dental, ["dental"]),
    ],
  },
  {
    id: "Fifth Settlement",
    en: "Fifth Settlement",
    ar: "التجمع الخامس",
    addressEn: "North 95, Fifth Settlement, New Cairo",
    addressAr: "شمال ٩٥، التجمع الخامس، القاهرة الجديدة",
    mapUrl: "https://maps.google.com/?q=North+95+Fifth+Settlement+New+Cairo",
    // 11:00–19:00, seven days, matching Maadi.
    sessions: [
      ...daily("11:00", "19:00", PRACTITIONERS.surgeon, ["surgical", "nonsurgical"]),
      ...daily("11:00", "19:00", PRACTITIONERS.dental, ["dental"]),
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

/**
 * Anatomical reporting groups used by Clinic OS.
 *
 * These deliberately sit beside, rather than replace, `ServiceCategory`.
 * `ServiceCategory` answers which rota can take a booking (surgical,
 * non-surgical, or dental); this taxonomy answers what area patients are asking
 * the clinic about. Conflating the two made it impossible to compare Face,
 * Breast and Body demand because all three legitimately use the surgical rota.
 */
export const REPORTING_CATEGORIES = [
  { id: "dental", label: "Dental" },
  { id: "face", label: "Face" },
  { id: "breast", label: "Breast" },
  { id: "body", label: "Body" },
  { id: "other", label: "Other" },
] as const;

export type ReportingCategory = (typeof REPORTING_CATEGORIES)[number]["id"];

/**
 * The service catalogue is code-reviewed and Clinic OS currently edits only
 * durations, not arbitrary service ids, so one explicit mapping is safer than
 * guessing from display copy. Prefix handling keeps separately named Dental
 * services in the correct group when that catalogue expands.
 *
 * Anything unrecognised reports as "other" rather than being guessed at, which
 * is also what happens to rows left behind by a retired line of care: a booking
 * taken before a service was withdrawn still counts toward the clinic's totals,
 * it simply stops claiming a column of its own.
 */
export function reportingCategoryForService(serviceId: string): ReportingCategory {
  const id = serviceId.trim().toLowerCase();
  if (id === "dental" || id.startsWith("dental-")) return "dental";
  if (["face", "nose", "nonsurgical", "skin"].includes(id)) return "face";
  if (id === "breast") return "breast";
  if (id === "body") return "body";
  return "other";
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
