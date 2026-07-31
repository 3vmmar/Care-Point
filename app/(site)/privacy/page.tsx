import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Dr. Ashraf Metwally's clinic collects, uses and protects patient data.",
  alternates: {
    canonical: "/privacy",
    languages: { en: "/privacy", ar: "/ar/privacy", "x-default": "/privacy" },
  },
};

export default function Page() {
  return <LegalPage kind="privacy" language="en" />;
}
