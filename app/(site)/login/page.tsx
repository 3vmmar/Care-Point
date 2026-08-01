import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { resolveStaffAccess } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Staff sign-in",
  description: "Clinic Command Center sign-in for Dr. Ashraf Metwally's practice.",
  // Not a page for search engines. It names no patient data, but a login form in
  // an index is an invitation and adds nothing for the practice.
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * Staff sign-in, served from the patient site rather than a separate hostname.
 *
 * That is a deliberate reversal: the two surfaces used to be disjoint, and the
 * public Worker could not serve a staff route at all. Putting them on one origin
 * means a flaw in the marketing site sits next to the appointment book, which the
 * split existed to prevent — the trade is that the clinic gets one address to
 * remember and no dependency on the hosting platform's proxy. The split remains
 * available: build with `CAREPOINT_SURFACE=patient` and this page 404s again.
 */
export default async function LoginPage() {
  /**
   * Somebody already signed in has no business on a sign-in form.
   *
   * The synthetic development principal is excluded deliberately: locally there is
   * no identity at all, so treating it as "already signed in" would redirect away
   * from this page every time and make it impossible to work on — or to test.
   */
  const decision = await resolveStaffAccess();
  if (decision.ok && !decision.staff.development) redirect("/command-center");

  return <LoginForm nextPath="/command-center" />;
}
