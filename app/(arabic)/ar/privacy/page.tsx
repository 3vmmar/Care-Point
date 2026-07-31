import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const metadata: Metadata = {
  title: "سياسة الخصوصية",
  description: "كيف تجمع عيادة د. أشرف متولي بيانات المرضى وتحميها.",
  alternates: {
    canonical: "/ar/privacy",
    languages: { en: "/privacy", ar: "/ar/privacy", "x-default": "/privacy" },
  },
};

export default function Page() {
  return <LegalPage kind="privacy" language="ar" />;
}
