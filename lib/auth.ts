/**
 * Access control for clinic-staff surfaces.
 *
 * The Clinic OS dashboard and the bookings API expose patient names, phone
 * numbers and email addresses, so both are gated. Identity comes from the
 * hosting platform, which injects `oai-authenticated-user-*` headers on
 * authenticated requests; see `app/chatgpt-auth.ts`.
 *
 * Authentication alone is not authorisation. The platform will happily
 * authenticate *any* account, so a verified identity must also appear in the
 * clinic's own staff allowlist before it sees a single patient record.
 */

import { getChatGPTUser, requireChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";

/**
 * Comma-separated staff addresses, e.g.
 *   STAFF_EMAILS="dr.ashraf@clinic.eg, reception@clinic.eg"
 *
 * Matching is case-insensitive and whitespace-tolerant. An empty or missing
 * value means nobody is authorised — failing closed is the only safe default
 * for a surface that renders patient contact details.
 */
const STAFF_EMAILS = new Set(
  (process.env.STAFF_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Local development never receives the platform's identity headers, so the gate
 * would lock the dashboard out entirely. Production always enforces it.
 */
const ALLOW_UNAUTHENTICATED_DEV = process.env.NODE_ENV !== "production";

const DEV_USER: ChatGPTUser = {
  displayName: "Local development",
  email: "dev@localhost",
  fullName: "Local development",
};

export function isStaffEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return STAFF_EMAILS.has(email.trim().toLowerCase());
}

/**
 * True when no allowlist is configured at all. Surfaced in the dashboard so a
 * misconfigured deployment is visible to the clinic rather than silently
 * locking every staff member out.
 */
export function staffAllowlistConfigured(): boolean {
  return STAFF_EMAILS.size > 0;
}

export type StaffGate =
  | { ok: true; user: ChatGPTUser }
  | { ok: false; email: string };

/**
 * For pages: resolves the staff user, redirects an anonymous visitor to
 * sign-in, and reports an authenticated non-staff visitor as denied.
 *
 * A denial is returned rather than thrown so the dashboard can explain itself.
 * Bouncing a signed-in colleague back through sign-in would just loop.
 */
export async function requireClinicStaff(returnTo: string): Promise<StaffGate> {
  const user = await getChatGPTUser();

  if (user && isStaffEmail(user.email)) return { ok: true, user };
  if (ALLOW_UNAUTHENTICATED_DEV) return { ok: true, user: user ?? DEV_USER };
  if (user) return { ok: false, email: user.email };

  // Never returns: `requireChatGPTUser` redirects to the sign-in flow.
  return { ok: true, user: await requireChatGPTUser(returnTo) };
}

/** For API routes: returns the staff user, or `null` so the caller can 401. */
export async function getClinicStaff(): Promise<ChatGPTUser | null> {
  const user = await getChatGPTUser();
  if (user && isStaffEmail(user.email)) return user;
  if (ALLOW_UNAUTHENTICATED_DEV) return user ?? DEV_USER;
  return null;
}
