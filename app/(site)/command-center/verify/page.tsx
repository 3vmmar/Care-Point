import type { Metadata } from "next";
import Link from "next/link";
import VerifyCode from "./VerifyCode";
import { requireStaffIdentityForPage } from "@/lib/auth";
import { STAFF_SESSION_HOURS } from "@/lib/staff-session";

// `security.css` is imported by the client component rather than here, so it
// travels with that chunk. Imported at the page level it was folded into the
// shared stylesheet and shipped to every patient visitor — a staff-only
// stylesheet on the marketing site, and 1KB over the performance budget.
// The refusal shells below therefore reuse the `manage-*` styles from globals.

export const metadata: Metadata = {
  title: "Two-step sign-in",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * Gated on identity only, deliberately.
 *
 * This page exists to satisfy the MFA requirement, so it cannot itself require
 * MFA to be satisfied — that is a locked door with the key on the inside.
 */
export default async function VerifyPage() {
  const gate = await requireStaffIdentityForPage("/command-center/verify");

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
                Access for <strong>{gate.email}</strong> has been switched off. An
                owner can restore it.
              </>
            ) : (
              <>
                <strong>{gate.email}</strong> is not on the clinic&rsquo;s staff list.
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

  return <VerifyCode email={gate.email} sessionHours={STAFF_SESSION_HOURS} />;
}
