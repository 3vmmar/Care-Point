import type { Metadata } from "next";
import CommandCenter from "./CommandCenter";
import { requireClinicStaff } from "@/lib/auth";
import "./command-center.css";

export const metadata: Metadata = {
  title: "Clinic Command Center",
  description: "Appointment operations for Dr. Ashraf Metwally's clinic.",
  robots: { index: false, follow: false },
};

// Staff-only: this page renders patient contact details, so it must never be
// statically rendered or served without checking the caller first.
export const dynamic = "force-dynamic";

export default async function CommandCenterPage() {
  const staff = await requireClinicStaff("/command-center");
  return <CommandCenter staffName={staff.fullName ?? staff.displayName} />;
}
