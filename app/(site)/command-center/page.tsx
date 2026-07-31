import type { Metadata } from "next";
import Link from "next/link";
import CommandCenter from "./CommandCenter";
import { requireClinicStaff } from "@/lib/auth";
import { CONTACT } from "@/lib/clinic";
import "./command-center.css";

export const metadata: Metadata = {
  title: "Clinic Command Center",
  description: "Appointment operations for Dr. Ashraf Metwally's clinic.",
  robots: { index: false, follow: false, nocache: true },
};

// Staff-only: this page renders patient contact details, so it must never be
// statically rendered or served without checking the caller first.
export const dynamic = "force-dynamic";

export default async function CommandCenterPage() {
  const gate = await requireClinicStaff("/command-center");

  if (!gate.ok) {
    return (
      <main className="manage-page">
        <div className="manage-card">
          <span className="manage-kicker">CLINIC OS</span>
          <h1>This dashboard is for clinic staff.</h1>
          <p style={{ color: "var(--muted)", lineHeight: 1.8, margin: "0 0 24px" }}>
            You are signed in as <strong>{gate.email}</strong>, which is not on the
            clinic&rsquo;s staff list. If you should have access, ask the practice
            manager to add your address to <code>STAFF_EMAILS</code>.
          </p>
          <div className="manage-footer" style={{ marginTop: 0 }}>
            <a href={`tel:${CONTACT.phone}`}>Call the clinic</a>
            <Link href="/">Back to the site</Link>
          </div>
        </div>
      </main>
    );
  }

  return <CommandCenter staffName={gate.user.fullName ?? gate.user.displayName} />;
}
