/**
 * Access control for clinic-staff surfaces.
 *
 * The Clinic OS dashboard and the bookings API expose patient names, phone
 * numbers and email addresses, so both are gated. Identity comes from the
 * hosting platform, which injects `oai-authenticated-user-*` headers on
 * authenticated requests; see `app/chatgpt-auth.ts`.
 */

import { getChatGPTUser, requireChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";

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

/** For pages: returns the staff user, or redirects to sign-in. */
export async function requireClinicStaff(returnTo: string): Promise<ChatGPTUser> {
  if (ALLOW_UNAUTHENTICATED_DEV) {
    return (await getChatGPTUser()) ?? DEV_USER;
  }
  return requireChatGPTUser(returnTo);
}

/** For API routes: returns the staff user, or `null` so the caller can 401. */
export async function getClinicStaff(): Promise<ChatGPTUser | null> {
  const user = await getChatGPTUser();
  if (user) return user;
  return ALLOW_UNAUTHENTICATED_DEV ? DEV_USER : null;
}
