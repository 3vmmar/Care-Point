import type { Metadata } from "next";
import Link from "next/link";
import CommandCenter from "./CommandCenter";
import { requireClinicStaff } from "@/lib/auth";
import { CONTACT } from "@/lib/clinic";
import { describeRoles } from "@/lib/roles";

/**
 * `command-center.css` is imported by the dashboard component, not here.
 *
 * At page level it was folded into the shared stylesheet, so all 47KB of Clinic OS
 * styling was downloaded by every patient visiting the marketing site — for markup
 * they will never see. The refusal shells below therefore use the `manage-*`
 * styles from globals, which the patient bundle needs anyway.
 */

export const metadata: Metadata = {
  title: "Clinic Command Center",
  description: "Appointment operations for Dr. Ashraf Metwally's clinic.",
  robots: { index: false, follow: false, nocache: true },
};

// Staff-only: this page renders patient contact details, so it must never be
// statically rendered or served without checking the caller first.
export const dynamic = "force-dynamic";

/** Shell for every refusal, so a denied visitor still sees a usable page. */
function Gate({
  heading,
  children,
  action,
}: {
  heading: string;
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <main className="manage-page">
      <div className="manage-card">
        <span className="manage-kicker">CLINIC OS</span>
        <h1>{heading}</h1>
        <div style={{ color: "var(--muted)", lineHeight: 1.8, margin: "0 0 24px" }}>
          {children}
        </div>
        <div className="manage-footer" style={{ marginTop: 0 }}>
          {action ? <Link href={action.href}>{action.label}</Link> : null}
          <a href={`tel:${CONTACT.phone}`}>Call the clinic</a>
          <Link href="/">Back to the site</Link>
        </div>
      </div>
    </main>
  );
}

export default async function CommandCenterPage() {
  const gate = await requireClinicStaff("/command-center");

  if (!gate.ok) {
    // Each refusal is a different situation with a different next step. Telling
    // a receptionist who needs to enrol a phone that they are "not staff" costs
    // the practice a support call and an afternoon.
    if (gate.reason === "not-staff") {
      return (
        <Gate heading="This dashboard is for clinic staff.">
          You are signed in as <strong>{gate.email}</strong>, which is not on the
          clinic&rsquo;s staff list. If you should have access, ask the practice
          manager to add you in Clinic OS under Security.
        </Gate>
      );
    }
    if (gate.reason === "deactivated") {
      return (
        <Gate heading="This account is no longer active.">
          Access for <strong>{gate.email}</strong> has been switched off. An owner
          can restore it from the Security page.
        </Gate>
      );
    }
    if (gate.reason === "mfa-enrolment-required") {
      return (
        <Gate
          heading="Set up your authenticator app."
          action={{ href: "/command-center/security", label: "Set up two-step sign-in" }}
        >
          The dashboard shows patient names, phone numbers and notes, so it needs a
          second factor as well as your sign-in. It takes about a minute and you
          only do it once per phone.
        </Gate>
      );
    }
    return (
      <Gate
        heading="Enter your two-step code."
        action={{ href: "/command-center/verify", label: "Enter code" }}
      >
        Signed in as <strong>{gate.email}</strong>. Open your authenticator app and
        enter the six-digit code to continue.
      </Gate>
    );
  }

  return (
    <CommandCenter
      staffName={gate.staff.displayName}
      roleSummary={describeRoles(gate.staff.roles)}
      permissions={gate.staff.permissions}
    />
  );
}
