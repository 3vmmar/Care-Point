import type { Metadata } from "next";
import Link from "next/link";
import SecurityCenter from "./SecurityCenter";
import { requireStaffIdentityForPage } from "@/lib/auth";
import { hasPermission } from "@/lib/roles";

// See the note in `../verify/page.tsx`: the stylesheet is imported by the client
// component so it does not end up in the shared sheet every patient downloads.

export const metadata: Metadata = {
  title: "Security & access",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * Gated on identity only.
 *
 * Enrolling a second factor cannot require a second factor. The directory panel
 * below it is a separate matter and is gated on `staff:read` — and the API it
 * calls enforces that again, so a hand-crafted request gets nothing extra.
 */
export default async function SecurityPage() {
  const gate = await requireStaffIdentityForPage("/command-center/security");

  if (!gate.ok) {
    return (
      <main className="manage-page">
        <div className="manage-card">
          <span className="manage-kicker">CLINIC OS</span>
          <h1>
            {gate.reason === "deactivated"
              ? "This account is no longer active."
              : "This dashboard is for clinic staff."}
          </h1>
          <p style={{ color: "var(--muted)", lineHeight: 1.8, margin: "0 0 24px" }}>
            {gate.reason === "deactivated" ? (
              <>
                Access for <strong>{gate.email}</strong> has been switched off.
              </>
            ) : (
              <>
                <strong>{gate.email}</strong> is not on the clinic&rsquo;s staff list.
                Ask the practice manager to add you.
              </>
            )}
          </p>
          <div className="manage-footer" style={{ marginTop: 0 }}>
            <Link href="/">Back to the site</Link>
          </div>
        </div>
      </main>
    );
  }

  // A break-glass owner has no directory row yet, so their roles are empty here;
  // they are an owner by virtue of the environment list.
  const canSeeDirectory = gate.breakGlass || hasPermission(gate.roles, "staff:read");

  return <SecurityCenter canSeeDirectory={canSeeDirectory} />;
}
