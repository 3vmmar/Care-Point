import Link from "next/link";
import { ArrowRight, CalendarDays, Check, MapPin, Navigation, ShieldCheck } from "lucide-react";
import { BRANCHES, CONTACT, DOCTOR, WHATSAPP_URL } from "@/lib/clinic";
import { copyFor, LOCALE_PATH, otherLanguage, type Language } from "@/lib/i18n";
import { treatmentCopy, treatmentPath, TREATMENTS, type Treatment } from "@/lib/treatments";

/**
 * A single treatment page, rendered on the server in one language.
 *
 * Deliberately a server component with no client JavaScript: this is a page
 * whose whole job is to be readable by a crawler and to load instantly on a
 * phone over mobile data. The booking call to action is a link into the main
 * experience rather than an embedded modal.
 */
export default function TreatmentPage({
  treatment,
  language,
}: {
  treatment: Treatment;
  language: Language;
}) {
  const t = copyFor(language);
  const c = treatmentCopy(treatment, language);
  const rtl = language === "ar";
  const home = LOCALE_PATH[language];
  const alt = otherLanguage(language);

  return (
    <main className="treatment-page" dir={rtl ? "rtl" : "ltr"}>
      <header className="treatment-header">
        <Link className="treatment-back" href={home}>
          {rtl ? "→" : "←"} {t.brandName}
        </Link>
        <Link
          className="treatment-lang"
          href={treatmentPath(treatment.slug, alt)}
          hrefLang={alt}
        >
          {t.languageShort}
        </Link>
      </header>

      <article className="treatment-hero">
        <span className="treatment-index">
          {treatment.number} · {rtl ? "استشارة" : "CONSULTATION"}
        </span>
        <h1>{c.title}</h1>
        <p className="treatment-feeling">&ldquo;{c.feeling}&rdquo;</p>
        <p className="treatment-intro">{c.intro}</p>
        <div className="treatment-actions">
          <Link className="button button--burgundy" href={`${home}#book`}>
            <CalendarDays size={18} />
            {t.book}
          </Link>
          <a href={`tel:${CONTACT.phone}`}>{t.callClinic}</a>
        </div>
        <p className="treatment-credential">
          <ShieldCheck size={16} />
          {rtl ? DOCTOR.nameAr : DOCTOR.nameEn} · {DOCTOR.credentials}
        </p>
      </article>

      <section className="treatment-section">
        <h2>{c.exploreTitle}</h2>
        <ul className="treatment-checks">
          {c.explore.map((item) => (
            <li key={item}>
              <Check size={16} />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="treatment-section">
        <h2>{c.optionsTitle}</h2>
        <div className="treatment-tags">
          {c.options.map((option) => (
            <span key={option}>{option}</span>
          ))}
        </div>
      </section>

      <section className="treatment-section">
        <h2>{c.recoveryTitle}</h2>
        <div className="treatment-phases">
          {c.recovery.map((phase, index) => (
            <article key={phase.label}>
              <strong>0{index + 1}</strong>
              <small>{phase.label}</small>
              <p>{phase.text}</p>
            </article>
          ))}
        </div>
        <p className="treatment-disclaimer">
          <ShieldCheck size={15} />
          {rtl
            ? "كل خطة ومدة تعافٍ تختلف حسب الفحص والإجراء والصحة العامة. هذه المعلومات تثقيفية وليست تشخيصاً."
            : "Every plan and recovery timeline is individual and depends on assessment, procedure and overall health. This is educational information, not a diagnosis."}
        </p>
      </section>

      <section className="treatment-section">
        <h2>{c.faqTitle}</h2>
        <div className="treatment-faq">
          {c.faq.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="treatment-section">
        <h2>{t.locationsTitle}</h2>
        <div className="treatment-clinics">
          {BRANCHES.map((branch) => (
            <a
              key={branch.id}
              href={branch.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin size={16} />
              <span>
                <strong>{rtl ? branch.ar : branch.en}</strong>
                <small>{rtl ? branch.addressAr : branch.addressEn}</small>
              </span>
              <Navigation size={15} />
            </a>
          ))}
        </div>
      </section>

      <section className="treatment-cta">
        <h2>{t.finalTitle}</h2>
        <div className="treatment-actions">
          <Link className="button button--burgundy button--large" href={`${home}#book`}>
            {t.book}
            <ArrowRight size={18} />
          </Link>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
        </div>
      </section>

      <nav className="treatment-more" aria-label={rtl ? "استشارات أخرى" : "Other consultations"}>
        <span>{rtl ? "استشارات أخرى" : "OTHER CONSULTATIONS"}</span>
        <div>
          {TREATMENTS.filter((item) => item.slug !== treatment.slug).map((item) => (
            <Link key={item.slug} href={treatmentPath(item.slug, language)}>
              {treatmentCopy(item, language).title}
              <ArrowRight size={14} />
            </Link>
          ))}
        </div>
      </nav>
    </main>
  );
}
