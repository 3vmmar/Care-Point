import { BRANCHES, CONTACT, DOCTOR, PRACTITIONERS, SERVICES } from "./clinic.ts";
import type { Language } from "./i18n.ts";
import { treatmentCopy, treatmentPath, type Treatment } from "./treatments.ts";

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
    /**
     * Only what this physician personally performs.
     *
     * Every service used to be listed here, which asserted in machine-readable
     * form that a consultant plastic surgeon performs dental implants and
     * veneers. That is wrong as data, and in Egypt it is worse than wrong: the
     * Medical Syndicate regulates how medical services may be advertised, and
     * attributing another practitioner's speciality to the named doctor is
     * exactly the kind of claim that invites a complaint.
     *
     * Dentistry is emitted separately below, against the clinic rather than the
     * surgeon.
     */
    availableService: SERVICES.filter((service) => service.category !== "dental").map(
      (service) => ({
        "@type": "MedicalProcedure",
        name: service.en,
        alternateName: service.ar,
      }),
    ),
  };

  /**
   * The dental line of care, attributed to the practice.
   *
   * Emitted as a `Dentistry` medical business so the services are discoverable
   * without being claimed by the plastic surgeon. Only rendered when dental
   * services actually exist, so removing the category removes the node.
   */
  const dentalServices = SERVICES.filter((service) => service.category === "dental");
  const dentistry =
    dentalServices.length > 0
      ? {
          "@type": "Dentist",
          "@id": `${SITE_URL}#dentistry`,
          name: `${DOCTOR.nameEn} — ${PRACTITIONERS.dental}`,
          medicalSpecialty: "Dentistry",
          url: SITE_URL,
          telephone: CONTACT.phone,
          availableService: dentalServices.map((service) => ({
            "@type": "MedicalProcedure",
            name: service.en,
            alternateName: service.ar,
          })),
        }
      : null;

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
      // Only present while the practice actually offers dentistry.
      ...(dentistry ? [dentistry] : []),
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
  const dental = treatment.provider?.kind === "dental";
  const provider = dental
    ? {
        "@type": "Dentist",
        "@id": `${SITE_URL}#dentistry`,
        name: treatment.provider!.en,
        alternateName: treatment.provider!.ar,
        medicalSpecialty: "Dentistry",
      }
    : { "@id": `${SITE_URL}#physician` };

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
        // The Dental page spans preventive, cosmetic and implant assessment.
        // Calling that whole line a SurgicalProcedure would be false, so it is
        // described by its specialty while surgical pages retain their type.
        ...(dental
          ? { medicalSpecialty: "Dentistry", bodyLocation: "Teeth, gums and jaw" }
          : {
              procedureType: "https://schema.org/SurgicalProcedure",
              bodyLocation: copy.title,
            }),
        howPerformed: copy.intro,
        performer: provider,
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
            name: dental ? "Care Point" : DOCTOR.nameEn,
            item: `${SITE_URL}${language === "ar" ? "/ar" : "/"}`,
          },
          { "@type": "ListItem", position: 2, name: copy.title, item: url },
        ],
      },
    ],
  };
}


/**
 * Serialises structured data for embedding in a `<script>` block.
 *
 * `JSON.stringify` does not escape `<`, so a value containing `</script>`
 * would close the block early and turn the rest into markup. Nothing in this
 * app's configuration contains that today — but the treatments file is edited
 * by hand, and this is the difference between "safe" and "safe by accident".
 */
export function serialiseJsonLd(value: unknown): string {
  // Built from character codes rather than hand-written escape sequences, so
  // there is no literal backslash-u string in this file to get subtly wrong.
  // U+2028 and U+2029 are included because they are legal inside JSON but
  // terminate a line in JavaScript, breaking the parser reading the block.
  const BACKSLASH = String.fromCharCode(92);
  const UNSAFE = new RegExp(
    "[<>&" + String.fromCharCode(0x2028, 0x2029) + "]",
    "g",
  );

  return JSON.stringify(value).replace(
    UNSAFE,
    (character) =>
      BACKSLASH + "u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
