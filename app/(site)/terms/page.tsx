import type { Metadata } from "next";
import LegalPage from "@/app/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms for using the Care Point appointment service.",
  alternates: {
    canonical: "/terms",
    languages: { en: "/terms", ar: "/ar/terms", "x-default": "/terms" },
  },
};

export default function Page() {
  return <LegalPage kind="terms" language="en" />;
}
