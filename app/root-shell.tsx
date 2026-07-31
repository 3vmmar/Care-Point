import type { Metadata } from "next";
import { Cormorant_Garamond, IBM_Plex_Sans_Arabic, Manrope } from "next/font/google";
import { clinicJsonLd, SITE_URL } from "@/lib/site";
import { directionFor, LOCALE_PATH, type Language } from "@/lib/i18n";
import "./globals.css";

/**
 * The document shell, shared by both language route groups.
 *
 * The site has two root layouts — one per language — so that `<html lang>` and
 * `<html dir>` are correct in the server-rendered HTML rather than being patched
 * in by an effect after hydration. A crawler that never runs the script still
 * sees Arabic markup declared as Arabic, which is the entire point of giving the
 * Arabic experience its own URL.
 */

const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const arabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

/**
 * Shared metadata. Each language layout overlays its own title, description and
 * canonical; `alternates.languages` is what tells Google the two URLs are the
 * same page in different languages rather than duplicate content.
 */
export function baseMetadata(language: Language): Metadata {
  const arabicSite = language === "ar";
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: arabicSite
        ? "د. أشرف متولي | مستقبل الرعاية التجميلية"
        : "Dr. Ashraf Metwally | The Future of Aesthetic Care",
      template: arabicSite ? "%s | د. أشرف متولي" : "%s | Dr. Ashraf Metwally",
    },
    description: arabicSite
      ? "تجربة رعاية تجميلية متكاملة مع إرشاد ذكي وحجز مواعيد مباشر في ثلاث عيادات بالقاهرة."
      : "A future-facing aesthetic care experience with intelligent guidance and live appointment booking across three Cairo clinics.",
    keywords: arabicSite
      ? ["جراح تجميل القاهرة", "تجميل الأنف القاهرة", "عيادة تجميل المعادي", "استشاري جراحات التجميل"]
      : [
          "plastic surgeon Cairo",
          "rhinoplasty Cairo",
          "aesthetic clinic Maadi",
          "جراح تجميل القاهرة",
        ],
    alternates: {
      canonical: LOCALE_PATH[language],
      languages: {
        en: LOCALE_PATH.en,
        ar: LOCALE_PATH.ar,
        "x-default": LOCALE_PATH.en,
      },
    },
    icons: {
      icon: "/logo.png",
      shortcut: "/logo.png",
    },
    openGraph: {
      type: "website",
      locale: arabicSite ? "ar_EG" : "en_GB",
      alternateLocale: arabicSite ? "en_GB" : "ar_EG",
      url: `${SITE_URL}${LOCALE_PATH[language] === "/" ? "" : LOCALE_PATH[language]}`,
      siteName: arabicSite ? "د. أشرف متولي — كير بوينت" : "Dr. Ashraf Metwally — Care Point",
      title: arabicSite
        ? "د. أشرف متولي — مستقبل الرعاية التجميلية"
        : "Dr. Ashraf Metwally — The Future of Aesthetic Care",
      description: arabicSite
        ? "تعرّف على نور، استكشف العلاجات، واحجز زيارتك مباشرة."
        : "Meet NOOR, explore treatments, and reserve a visit in real time.",
      images: [{ url: "/og.jpg", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: arabicSite
        ? "د. أشرف متولي — مستقبل الرعاية التجميلية"
        : "Dr. Ashraf Metwally — The Future of Aesthetic Care",
      description: arabicSite
        ? "تعرّف على نور، استكشف العلاجات، واحجز زيارتك مباشرة."
        : "Meet NOOR, explore treatments, and reserve a visit in real time.",
      images: ["/og.jpg"],
    },
  };
}

export default function RootShell({
  language,
  children,
}: {
  language: Language;
  children: React.ReactNode;
}) {
  return (
    <html lang={language} dir={directionFor(language)} suppressHydrationWarning>
      <body
        className={`${manrope.variable} ${cormorant.variable} ${arabic.variable}`}
      >
        {children}
        {/*
          Practice, physician and per-branch structured data. This is what puts
          a clinic into local search results; without it three Cairo locations
          are just paragraphs of text to a crawler.
        */}
        <script
          type="application/ld+json"
          // Serialised from our own configuration, never from user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(clinicJsonLd()) }}
        />
      </body>
    </html>
  );
}
