/**
 * Single source of truth for clinic configuration.
 *
 * Everything a non-developer might need to change lives here: branches, opening
 * times, closed days, contact details and consultation types. These values are
 * shared by the API routes and the patient UI so the two can never drift apart.
 *
 * TODO(clinic): the contact details below are placeholders. Replace them with
 * the real clinic numbers before launch — they are rendered on the public site.
 */

export const CLINIC_TIMEZONE = "Africa/Cairo";

/** Days the clinic is closed, as JS day indices (0 = Sunday). Friday in Cairo. */
export const CLOSED_WEEKDAYS = [5];

/** How many open days the booking calendar offers at a time. */
export const AVAILABILITY_WINDOW_DAYS = 6;

/** How long a slot is held while the patient completes their details. */
export const HOLD_DURATION_MINUTES = 5;

export const DEFAULT_APPOINTMENT_MINUTES = 45;

/** Bumped whenever the consent wording changes, so stored consent is auditable. */
export const CONSENT_VERSION = "2026-07-contact-consent-v1";

export type BranchId = "Maadi" | "Mohandessin" | "Fifth Settlement";

export type Branch = {
  id: BranchId;
  en: string;
  ar: string;
  /** Consultation start times in clinic-local (Africa/Cairo) 24h time. */
  slots: string[];
};

export const BRANCHES: Branch[] = [
  {
    id: "Maadi",
    en: "Maadi",
    ar: "المعادي",
    slots: ["11:00", "13:00", "16:30", "19:00"],
  },
  {
    id: "Mohandessin",
    en: "Mohandessin",
    ar: "المهندسين",
    slots: ["10:30", "14:00", "17:30", "20:00"],
  },
  {
    id: "Fifth Settlement",
    en: "Fifth Settlement",
    ar: "التجمع الخامس",
    slots: ["12:00", "15:30", "18:00", "20:30"],
  },
];

export const BRANCH_IDS = BRANCHES.map((branch) => branch.id);

export function findBranch(id: string | null | undefined): Branch | undefined {
  return BRANCHES.find((branch) => branch.id === id);
}

export type Service = {
  id: string;
  en: string;
  ar: string;
};

export const SERVICES: Service[] = [
  { id: "aesthetic", en: "Aesthetic consultation", ar: "استشارة تجميلية" },
  { id: "face", en: "Face & neck consultation", ar: "استشارة الوجه والرقبة" },
  { id: "nose", en: "Rhinoplasty consultation", ar: "استشارة تجميل الأنف" },
  { id: "body", en: "Body contouring consultation", ar: "استشارة تنسيق القوام" },
  { id: "breast", en: "Breast surgery consultation", ar: "استشارة جراحات الثدي" },
  { id: "nonsurgical", en: "Non-surgical aesthetics", ar: "تجميل بدون جراحة" },
];

export const SERVICE_IDS = SERVICES.map((service) => service.id);

export function findService(id: string | null | undefined): Service | undefined {
  return SERVICES.find((service) => service.id === id);
}

/** Placeholder contact details — see the TODO at the top of this file. */
export const CONTACT = {
  phone: "+201000000000",
  phoneDisplay: "+20 100 000 0000",
  whatsapp: "201000000000",
};

export const WHATSAPP_URL = `https://wa.me/${CONTACT.whatsapp}`;
