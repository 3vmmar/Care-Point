import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const metadata: Metadata = {
  title: "شروط الاستخدام",
  description: "شروط استخدام خدمة حجز المواعيد.",
  alternates: {
    canonical: "/ar/terms",
    languages: { en: "/terms", ar: "/ar/terms", "x-default": "/terms" },
  },
};

export default function Page() {
  return <LegalPage kind="terms" language="ar" />;
}
