import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TreatmentPage from "@/app/components/TreatmentPage";
import { treatmentJsonLd, serialiseJsonLd } from "@/lib/site";
import { findTreatment, TREATMENTS, treatmentCopy } from "@/lib/treatments";

export function generateStaticParams() {
  return TREATMENTS.map((treatment) => ({ slug: treatment.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const treatment = findTreatment(slug);
  if (!treatment) return {};
  const copy = treatmentCopy(treatment, "ar");

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: {
      canonical: `/ar/treatments/${slug}`,
      languages: {
        en: `/treatments/${slug}`,
        ar: `/ar/treatments/${slug}`,
        "x-default": `/treatments/${slug}`,
      },
    },
    openGraph: {
      type: "article",
      locale: "ar_EG",
      title: copy.metaTitle,
      description: copy.metaDescription,
      url: `/ar/treatments/${slug}`,
    },
  };
}

export default async function ArabicTreatment({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const treatment = findTreatment(slug);
  if (!treatment) notFound();

  return (
    <>
      <TreatmentPage treatment={treatment} language="ar" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serialiseJsonLd(treatmentJsonLd(treatment, "ar")),
        }}
      />
    </>
  );
}
