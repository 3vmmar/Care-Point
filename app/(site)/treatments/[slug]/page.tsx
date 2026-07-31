import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TreatmentPage from "@/app/components/TreatmentPage";
import { treatmentJsonLd } from "@/lib/site";
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
  const copy = treatmentCopy(treatment, "en");

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: {
      canonical: `/treatments/${slug}`,
      languages: {
        en: `/treatments/${slug}`,
        ar: `/ar/treatments/${slug}`,
        "x-default": `/treatments/${slug}`,
      },
    },
    openGraph: {
      type: "article",
      locale: "en_GB",
      title: copy.metaTitle,
      description: copy.metaDescription,
      url: `/treatments/${slug}`,
    },
  };
}

export default async function EnglishTreatment({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const treatment = findTreatment(slug);
  if (!treatment) notFound();

  return (
    <>
      <TreatmentPage treatment={treatment} language="en" />
      {/* Procedure and FAQ structured data — what produces rich results. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(treatmentJsonLd(treatment, "en")),
        }}
      />
    </>
  );
}
