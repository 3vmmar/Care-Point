import { BRANCHES, CONTACT, DOCTOR, SERVICES } from "./clinic";
import type { Language } from "./i18n";
import { treatmentCopy, treatmentPath, type Treatment } from "./treatments";

/**
 * Set SITE_URL to the clinic's real domain at build time. The preview host is
 * only a fallback so absolute OpenGraph and canonical URLs still resolve before
 * launch.
 */
const SCHEMA_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const SITE_URL = (
  process.env.SITE_URL ?? "https://dr-ashraf-future-clinic.nimble-pig-6675.chatgpt.site"
).replace(/\/$/, "");

/**
 * Structured data for the practice.
 *
 * A Cairo clinic is found through local search far more often than through a
 * brand query, and none of that works without machine-readable opening hours,
 * addresses and specialties. Each branch is emitted as its own `MedicalClinic`
 * so the three locations can rank independently.
 */
export function clinicJsonLd() {
  const physician = {
    "@type": "Physician",
    "@id": `${SITE_URL}#physician`,
    name: DOCTOR.nameEn,
    alternateName: DOCTOR.nameAr,
    jobTitle: DOCTOR.titleEn,
    medicalSpecialty: "PlasticSurgery",
    url: SITE_URL,
    image: `${SITE_URL}/og.jpg`,
    telephone: CONTACT.phone,
    availableService: SERVICES.map((service) => ({
      "@type": "MedicalProcedure",
      name: service.en,
      alternateName: service.ar,
    })),
  };

  const clinics = BRANCHES.map((branch) => ({
    "@type": "MedicalClinic",
    "@id": `${SITE_URL}#${branch.id.toLowerCase().replace(/\s+/g, "-")}`,
    name: `${DOCTOR.nameEn} — ${branch.en}`,
    alternateName: `${DOCTOR.nameAr} — ${branch.ar}`,
    url: SITE_URL,
    telephone: CONTACT.phone,
    hasMap: branch.mapUrl,
    address: {
      "@type": "PostalAddress",
      streetAddress: branch.addressEn,
      addressLocality: branch.en,
      addressRegion: "Cairo",
      addressCountry: "EG",
    },
    // Friday is the clinic's closed day; every other day runs the published
    // consultation slots.
    // One entry per session, so search engines see the real timetable rather
    // than a single invented open-to-close range.
    openingHoursSpecification: branch.sessions.map((session) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: SCHEMA_DAYS[session.weekday],
      opens: session.start,
      closes: session.end,
    })),
    physician: { "@id": `${SITE_URL}#physician` },
  }));

  return {
    "@context": "https://schema.org",
    "@graph": [
      physician,
      ...clinics,
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}#website`,
        url: SITE_URL,
        name: `${DOCTOR.nameEn} | Care Point`,
        inLanguage: ["en", "ar"],
        publisher: { "@id": `${SITE_URL}#physician` },
      },
    ],
  };
}

/**
 * Per-treatment structured data.
 *
 * `MedicalProcedure` describes what the page is about and `FAQPage` is what
 * produces the expandable answers directly in a search result — which is worth
 * more to a clinic than the ranking position alone, because the patient's
 * question is answered before they choose whose link to open.
 */
export function treatmentJsonLd(treatment: Treatment, language: Language) {
  const copy = treatmentCopy(treatment, language);
  const url = `${SITE_URL}${treatmentPath(treatment.slug, language)}`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "MedicalProcedure",
        "@id": `${url}#procedure`,
        name: copy.title,
        description: copy.metaDescription,
        url,
        inLanguage: language,
        procedureType: "https://schema.org/SurgicalProcedure",
        bodyLocation: copy.title,
        howPerformed: copy.intro,
        performer: { "@id": `${SITE_URL}#physician` },
        availableService: copy.options.map((option) => ({
          "@type": "MedicalTherapy",
          name: option,
        })),
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        inLanguage: language,
        mainEntity: copy.faq.map((entry) => ({
          "@type": "Question",
          name: entry.q,
          acceptedAnswer: { "@type": "Answer", text: entry.a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: DOCTOR.nameEn,
            item: `${SITE_URL}${language === "ar" ? "/ar" : "/"}`,
          },
          { "@type": "ListItem", position: 2, name: copy.title, item: url },
        ],
      },
    ],
  };
}
