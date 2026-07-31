/**
 * The trust boundary for staff identity.
 *
 * Staff authentication works by reading `oai-authenticated-user-email` from the
 * request. That header is injected by the hosting platform's authenticating
 * proxy — but the Worker sits on the open internet, so *any* caller can set it
 * too. Without the check in this module:
 *
 *     curl -H "oai-authenticated-user-email: dr.ashraf@clinic.eg" \
 *          https://clinic.example/api/bookings
 *
 * returns every patient's name, phone number and email address. The staff
 * allowlist does not help, because the attacker simply names someone on it.
 *
 * So identity headers are stripped at the edge unless the request proves it
 * came through the trusted proxy, by presenting a shared secret that only the
 * proxy knows. Requests that fail the check are not rejected — they are treated
 * as anonymous, which is what they are.
 */

/** Headers carrying identity. Stripped wholesale when the proxy is unproven. */
const IDENTITY_HEADER_PREFIX = "oai-authenticated-user-";

/** Where the proxy presents the shared secret. */
export const PROXY_AUTH_HEADER = "x-carepoint-proxy-auth";

function secret(): string | undefined {
  const value = process.env.AUTH_PROXY_SECRET;
  return value && value.trim() ? value.trim() : undefined;
}

export function proxyVerificationConfigured(): boolean {
  return Boolean(secret());
}

/**
 * Local development never receives platform headers, so stripping them there
 * would only get in the way. Production always enforces.
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Constant-time string comparison, to avoid leaking the secret byte by byte. */
async function matches(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  // Hashing first makes both operands the same length regardless of input, so
  // the comparison below cannot leak the secret's length either.
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export type ProxyDecision = {
  /** Whether the identity headers on this request may be believed. */
  trusted: boolean;
  /** Why, for logging and the health endpoint. */
  reason: "verified" | "development" | "no-secret-configured" | "bad-secret" | "absent";
};

export async function verifyTrustedProxy(request: Request): Promise<ProxyDecision> {
  const expected = secret();
  const presented = request.headers.get(PROXY_AUTH_HEADER);

  if (expected) {
    if (!presented) return { trusted: false, reason: "absent" };
    return (await matches(presented, expected))
      ? { trusted: true, reason: "verified" }
      : { trusted: false, reason: "bad-secret" };
  }

  // No secret configured. In development that is expected; in production it
  // means the trust boundary is undefined, so identity cannot be believed.
  // Failing closed locks staff out loudly — which is the correct outcome for a
  // surface that renders patient contact details.
  return isDevelopment()
    ? { trusted: true, reason: "development" }
    : { trusted: false, reason: "no-secret-configured" };
}

/**
 * Returns a request the application can safely reason about: identical to the
 * original, minus any identity headers it was not entitled to carry.
 */
export function stripIdentityHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  let stripped = false;

  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith(IDENTITY_HEADER_PREFIX)) {
      headers.delete(name);
      stripped = true;
    }
  }
  // The secret itself must never reach application code or a log line.
  headers.delete(PROXY_AUTH_HEADER);

  if (!stripped) return request;

  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    redirect: request.redirect,
    // Streaming a body through a reconstructed Request requires this in
    // workerd; without it a POST with a body throws.
    ...({ duplex: "half" } as RequestInit),
  });
}

/**
 * Edge guard: verifies the proxy and returns a sanitised request.
 * Call once, at the entry point, before anything reads identity.
 */
export async function sanitiseRequest(request: Request): Promise<{
  request: Request;
  decision: ProxyDecision;
}> {
  const decision = await verifyTrustedProxy(request);
  if (decision.trusted) {
    // Even when trusted, the secret is removed so it cannot be echoed or logged.
    const headers = new Headers(request.headers);
    if (headers.has(PROXY_AUTH_HEADER)) {
      headers.delete(PROXY_AUTH_HEADER);
      return {
        decision,
        request: new Request(request.url, {
          method: request.method,
          headers,
          body: request.body,
          redirect: request.redirect,
          ...({ duplex: "half" } as RequestInit),
        }),
      };
    }
    return { request, decision };
  }
  return { request: stripIdentityHeaders(request), decision };
}
