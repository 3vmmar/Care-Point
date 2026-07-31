/**
 * Request-derived identifiers.
 *
 * Shared by the hold rate limiter and the staff audit log, which both need a
 * stable-ish handle on "who is calling" without ever storing an IP address.
 * The raw address never reaches the database — only a truncated digest, which
 * is enough to notice that one caller is behaving oddly and not enough to
 * reconstruct who they were.
 */

/** Truncated SHA-256 of the caller's address and user agent. */
export async function clientFingerprint(request: Request): Promise<string> {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip}|${agent}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
