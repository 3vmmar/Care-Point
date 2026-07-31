import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  AUDIT_RETENTION_DAYS,
  CONTACT,
  DOCTOR,
  HOLD_DURATION_MINUTES,
  PII_RETENTION_DAYS,
} from "@/lib/clinic";
import { copyFor, LOCALE_PATH, type Language } from "@/lib/i18n";

/**
 * Privacy policy and terms.
 *
 * The factual sections are accurate — they were written against the code, so
 * what they say the system collects, keeps and deletes is what it actually
 * does. The *legal* framing is not: lawful basis under Egypt's PDPL, any
 * registration duty, medical-record retention obligations and the liability
 * wording all need a qualified local lawyer.
 *
 * That distinction is surfaced to the reader rather than buried, because a
 * confident-sounding policy nobody has reviewed is worse than an obviously
 * provisional one.
 */

export type LegalKind = "privacy" | "terms";

type Section = { heading: string; body: string[] };

function privacySections(language: Language): Section[] {
  const years = Math.round(PII_RETENTION_DAYS / 365);
  const auditYears = Math.round(AUDIT_RETENTION_DAYS / 365);

  if (language === "ar") {
    return [
      {
        heading: "البيانات التي نجمعها",
        body: [
          "عند حجز موعد نجمع: اسمك، رقم هاتفك، بريدك الإلكتروني (اختياري)، وأي ملاحظة تكتبها للعيادة، بالإضافة إلى الفرع ونوع الاستشارة والموعد الذي اخترته.",
          "نسجّل أيضاً موافقتك على التواصل معك، مع نص الموافقة الذي عُرض عليك وتاريخها.",
          "لأغراض الحماية من الحجوزات الآلية، نحتفظ ببصمة مختصرة ومشفّرة لعنوان الإنترنت والمتصفح. لا نخزّن عنوان الإنترنت نفسه.",
        ],
      },
      {
        heading: "لماذا نستخدمها",
        body: [
          "لتأكيد موعدك وتذكيرك به، وللتواصل معك إذا احتجنا لتغييره.",
          "لتشغيل جدول العيادة اليومي.",
          "لا نبيع بياناتك ولا نستخدمها للإعلانات.",
        ],
      },
      {
        heading: "من يمكنه الاطلاع عليها",
        body: [
          "فريق العيادة المصرّح له فقط. كل اطلاع على بيانات المرضى يُسجَّل: من اطّلع، وعلى ماذا، ومتى.",
          `يُحتفظ بسجل الاطلاع هذا لمدة ${auditYears} سنوات تقريباً.`,
        ],
      },
      {
        heading: "مدة الاحتفاظ",
        body: [
          `تُمحى بيانات التواصل تلقائياً بعد حوالي ${years} سنة من موعد الزيارة، مع الاحتفاظ بسجل مجهول الهوية لأغراض التشغيل والإحصاء.`,
          `الموعد المحجوز مؤقتاً وغير المكتمل يُلغى تلقائياً بعد ${HOLD_DURATION_MINUTES} دقائق.`,
        ],
      },
      {
        heading: "حقوقك",
        body: [
          "يمكنك طلب نسخة من بياناتك، أو تصحيحها، أو محوها.",
          "للتحقق من هويتك، سيتواصل معك فريق العيادة قبل تنفيذ أي طلب — لا نتصرف بناءً على رقم هاتف وحده.",
          "لا يمكن محو بيانات مريض لديه موعد قادم؛ يجب إلغاء الموعد أولاً.",
        ],
      },
      {
        heading: "التواصل",
        body: [
          `للأسئلة المتعلقة بالخصوصية: ${CONTACT.email} أو ${CONTACT.phoneDisplay}.`,
        ],
      },
    ];
  }

  return [
    {
      heading: "What we collect",
      body: [
        "When you book an appointment we collect your name, phone number, email address (optional), and any note you write for the clinic — along with the clinic, consultation type and time you chose.",
        "We record your consent to be contacted, together with the exact wording you were shown and the date you gave it.",
        "To protect against automated bookings we keep a short, one-way hash of your network address and browser. The address itself is never stored.",
      ],
    },
    {
      heading: "Why we use it",
      body: [
        "To confirm your appointment, remind you about it, and contact you if it has to change.",
        "To run the clinic's daily schedule.",
        "We do not sell your data, and we do not use it for advertising.",
      ],
    },
    {
      heading: "Who can see it",
      body: [
        "Only authorised clinic staff. Every access to patient data is logged — who looked, at what, and when.",
        `That access log is itself kept for about ${auditYears} years.`,
      ],
    },
    {
      heading: "How long we keep it",
      body: [
        `Contact details are cleared automatically about ${years} years after the appointment. An anonymous record of the visit remains for the clinic's own operational history.`,
        `An appointment you start but do not complete is released automatically after ${HOLD_DURATION_MINUTES} minutes.`,
      ],
    },
    {
      heading: "Your rights",
      body: [
        "You can ask for a copy of your data, ask us to correct it, or ask us to erase it.",
        "The clinic will contact you to verify your identity before acting on any request — we never act on a phone number alone, because that would let anyone holding your number access or destroy your records.",
        "Data cannot be erased while you have an upcoming appointment; that appointment must be cancelled first.",
      ],
    },
    {
      heading: "Contact",
      body: [`For privacy questions: ${CONTACT.email} or ${CONTACT.phoneDisplay}.`],
    },
  ];
}

function termsSections(language: Language): Section[] {
  if (language === "ar") {
    return [
      {
        heading: "طبيعة الخدمة",
        body: [
          "يتيح هذا الموقع حجز موعد استشارة. الحجز طلب لموعد وليس تشخيصاً ولا خطة علاج.",
          "تُحدَّد أي خطة علاج بعد الكشف الطبي المباشر فقط.",
        ],
      },
      {
        heading: "المعلومات على الموقع",
        body: [
          "المحتوى التثقيفي والإجابات الإرشادية على الموقع للتوعية العامة فقط، ولا تُغني عن استشارة طبية.",
          "الحالات العاجلة تتطلب تواصلاً طبياً مباشراً أو التوجه لأقرب طوارئ.",
        ],
      },
      {
        heading: "المواعيد",
        body: [
          `يُحجز الموعد مؤقتاً لمدة ${HOLD_DURATION_MINUTES} دقائق أثناء إدخال بياناتك.`,
          "يمكنك تغيير موعدك أو إلغاؤه من الرابط المرسل إليك، أو بالاتصال بالعيادة.",
          "تحتفظ العيادة بحق تغيير أو إلغاء موعد لأسباب تشغيلية، مع إخطارك.",
        ],
      },
      {
        heading: "التواصل",
        body: [`${CONTACT.email} · ${CONTACT.phoneDisplay}`],
      },
    ];
  }

  return [
    {
      heading: "What this service is",
      body: [
        "This website lets you request a consultation appointment. A booking is a request for a time — it is not a diagnosis and not a treatment plan.",
        "Any treatment plan follows an in-person assessment.",
      ],
    },
    {
      heading: "Information on this site",
      body: [
        "Educational content and guided answers on this site are general information only. They do not replace a medical consultation.",
        "Urgent concerns require direct medical care or your nearest emergency department.",
      ],
    },
    {
      heading: "Appointments",
      body: [
        `A time is held for ${HOLD_DURATION_MINUTES} minutes while you enter your details.`,
        "You can change or cancel your appointment from the link sent to you, or by calling the clinic.",
        "The clinic may need to move or cancel an appointment for operational reasons, and will contact you if so.",
      ],
    },
    {
      heading: "Contact",
      body: [`${CONTACT.email} · ${CONTACT.phoneDisplay}`],
    },
  ];
}

export default function LegalPage({
  kind,
  language,
}: {
  kind: LegalKind;
  language: Language;
}) {
  const t = copyFor(language);
  const rtl = language === "ar";
  const sections = kind === "privacy" ? privacySections(language) : termsSections(language);

  const title =
    kind === "privacy"
      ? rtl
        ? "سياسة الخصوصية"
        : "Privacy Policy"
      : rtl
        ? "شروط الاستخدام"
        : "Terms of Use";

  return (
    <main className="legal-page" dir={rtl ? "rtl" : "ltr"}>
      <article className="legal-body">
        <Link className="legal-back" href={LOCALE_PATH[language]}>
          {rtl ? "→ العودة للموقع" : "← Back to the site"}
        </Link>

        <span className="legal-kicker">{rtl ? DOCTOR.nameAr : DOCTOR.nameEn}</span>
        <h1>{title}</h1>

        {/*
          Deliberately prominent. This document describes the system accurately,
          but it has not been reviewed by a lawyer — and publishing it as though
          it had would mislead the very patients it is meant to protect.
        */}
        <aside className="legal-review" role="note">
          <AlertTriangle size={17} />
          <div>
            <strong>
              {rtl ? "مسودة بانتظار المراجعة القانونية" : "Draft — pending legal review"}
            </strong>
            <p>
              {rtl
                ? "هذه المسودة تصف بدقة ما يفعله النظام فعلياً، لكنها لم تُراجع بعد من مستشار قانوني مصري بخصوص قانون حماية البيانات الشخصية (رقم ١٥١ لسنة ٢٠١٨) وقواعد الإعلان الطبي. يجب مراجعتها قبل النشر."
                : "This draft accurately describes what the system does, but it has not yet been reviewed by an Egyptian lawyer against the Personal Data Protection Law (151/2018) or medical-advertising rules. It must be reviewed before launch."}
            </p>
          </div>
        </aside>

        {sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}

        {kind === "privacy" && (
          <section>
            <h2>{rtl ? "تقديم طلب" : "Make a request"}</h2>
            <p>
              {rtl
                ? "لطلب نسخة من بياناتك أو تصحيحها أو محوها، تواصل مع العيادة وسنوجّهك خلال خطوات التحقق."
                : "To request a copy of your data, a correction, or its erasure, contact the clinic and we will take you through the verification steps."}
            </p>
            <p>
              <a className="legal-contact" href={`tel:${CONTACT.phone}`}>
                {CONTACT.phoneDisplay}
              </a>
              {" · "}
              <a className="legal-contact" href={`mailto:${CONTACT.email}`}>
                {CONTACT.email}
              </a>
            </p>
          </section>
        )}

        <footer className="legal-footer">
          <Link href={LOCALE_PATH[language]}>{t.brandName}</Link>
          <Link href={rtl ? "/ar/privacy" : "/privacy"}>
            {rtl ? "الخصوصية" : "Privacy"}
          </Link>
          <Link href={rtl ? "/ar/terms" : "/terms"}>{rtl ? "الشروط" : "Terms"}</Link>
        </footer>
      </article>
    </main>
  );
}
