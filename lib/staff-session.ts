/**
 * The MFA session: proof that this browser has already passed a code challenge.
 *
 * Without it, a second factor would have to be typed on every request, which
 * reception would abandon within a morning. With a *badly built* one, it becomes
 * the weakest link in the whole system — so the token here is signed, expiring,
 * and bound to three things that make a stolen copy useless:
 *
 *  1. **The staff email.** The gate only accepts a session whose subject matches
 *     the identity the proxy asserted, so a token lifted from one account cannot
 *     be presented alongside another account's sign-in.
 *  2. **An epoch counter held on the staff row.** Resetting someone's MFA or
 *     deactivating them bumps it, which invalidates every session they already
 *     had. A revocation that leaves live sessions running is not a revocation.
 *  3. **An absolute expiry**, carried inside the signature rather than only in a
 *     cookie attribute, because a client controls its cookie jar and does not
 *     control an HMAC.
 *
 * Deliberately free of `next/headers` and `cloudflare:workers`: it takes header
 * strings and returns header strings, so the forgery and expiry cases can be
 * tested against the real implementation.
 */

const SECRET_ENV = "STAFF_SESSION_SECRET";
const TOKEN_VERSION = "v1";

export const STAFF_SESSION_COOKIE = "carepoint_staff_mfa";

/**
 * One clinic day. Long enough that a receptionist verifies at the start of a
 * shift and is not asked again; short enough that a browser left signed in on a
 * shared desktop stops being useful by the next morning.
 */
export const STAFF_SESSION_HOURS = 12;

function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Development signing key. Production has no fallback: with no configured
 * secret, no session can be issued or verified, so the dashboard refuses
 * everyone rather than accepting a token anyone could mint.
 */
const DEVELOPMENT_SECRET = "carepoint-development-only-session-secret";

let warnedAboutDevelopmentSecret = false;

function secret(): string {
  const configured = process.env[SECRET_ENV];
  if (configured && configured.trim()) return configured.trim();

  if (!isDevelopment()) {
    throw new Error(`${SECRET_ENV} is not configured, so staff MFA sessions cannot be signed.`);
  }
  if (!warnedAboutDevelopmentSecret) {
    warnedAboutDevelopmentSecret = true;
    console.warn(
      `[security] ${SECRET_ENV} is not set; staff MFA sessions are signed with the ` +
        "development key and must not be trusted outside local development.",
    );
  }
  return DEVELOPMENT_SECRET;
}

export function staffSessionSecretConfigured(): boolean {
  const configured = process.env[SECRET_ENV];
  return Boolean(configured && configured.trim());
}

let cachedKey: { material: string; key: Promise<CryptoKey> } | null = null;

function signingKey(): Promise<CryptoKey> {
  const material = secret();
  if (cachedKey?.material === material) return cachedKey.key;

  const key = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(material) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedKey = { material, key };
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sign(payload: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(payload) as unknown as ArrayBuffer,
  );
  return toBase64Url(new Uint8Array(signature));
}

/** Constant-time comparison, so a forged signature cannot be refined byte by byte. */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * What the holder actually proved.
 *
 * Identity used to come from a proxy header, so a session meant one thing: the
 * second factor was satisfied. With the clinic issuing its own passwords a session
 * can exist having proved *only* the password, which is not the same as being let
 * in — so the session records which factors it stands on and the gate decides
 * whether that is enough.
 */
export type StaffFactor = "password" | "totp" | "proxy";

export type StaffSessionClaims = {
  email: string;
  /** Matches `staff_users.session_epoch`; a bump revokes this token. */
  epoch: number;
  factors: StaffFactor[];
  verifiedAtMs: number;
  expiresAtMs: number;
  /**
   * Identifies this session, so one device can be signed out without ending
   * every other. Doubles as the nonce that keeps two sessions issued in the same
   * millisecond from being the same string.
   */
  sessionId: string;
};

/** Issues a token for a staff member who has just proved their second factor. */
export async function issueStaffSession(input: {
  email: string;
  epoch: number;
  /** Defaults to the second factor alone, which is what the proxy path proves. */
  factors?: readonly StaffFactor[];
  verifiedAtMs?: number;
  lifetimeMs?: number;
}): Promise<{ token: string; claims: StaffSessionClaims }> {
  const verifiedAtMs = input.verifiedAtMs ?? Date.now();
  const lifetimeMs = input.lifetimeMs ?? STAFF_SESSION_HOURS * 60 * 60 * 1000;
  const claims: StaffSessionClaims = {
    email: input.email.trim().toLowerCase(),
    epoch: input.epoch,
    factors: normaliseFactors(input.factors ?? ["totp"]),
    verifiedAtMs,
    expiresAtMs: verifiedAtMs + lifetimeMs,
    sessionId: crypto.randomUUID(),
  };

  const payload = [
    TOKEN_VERSION,
    toBase64Url(new TextEncoder().encode(claims.email)),
    String(claims.epoch),
    String(claims.verifiedAtMs),
    String(claims.expiresAtMs),
    toBase64Url(new TextEncoder().encode(claims.sessionId)),
    // Inside the signature, so a client cannot promote its own session from
    // password-only to fully verified by editing a cookie.
    toBase64Url(new TextEncoder().encode(claims.factors.join(","))),
  ].join(".");

  return { token: `${payload}.${await sign(payload)}`, claims };
}

/**
 * Digest of a token, for storing a session without storing a way back into it.
 *
 * `staff_sessions` is a list of who is signed in where. If it held the tokens it
 * would instead be a set of spare keys, and reading the table would be equivalent
 * to holding every live session.
 */
export async function sessionTokenDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token) as unknown as ArrayBuffer,
  );
  return toBase64Url(new Uint8Array(digest));
}


const KNOWN_FACTORS: StaffFactor[] = ["password", "totp", "proxy"];

/**
 * Keeps only recognised factors, deduplicated and in a fixed order.
 *
 * A factor name this build does not know must not count towards anything — the
 * alternative is a token minted by a future version granting access here on the
 * strength of a word this code cannot evaluate.
 */
function normaliseFactors(values: readonly string[]): StaffFactor[] {
  const seen = new Set(values.map((value) => value.trim()));
  return KNOWN_FACTORS.filter((factor) => seen.has(factor));
}

/**
 * Whether a session proves enough to be let in.
 *
 * A password alone is sufficient only when the clinic is not requiring a second
 * factor, or when the account has none enrolled yet. The proxy path is treated as
 * already-authenticated identity, because that is what it is.
 */
export function factorsSatisfied(
  factors: readonly StaffFactor[],
  options: { mfaRequired: boolean; mfaEnrolled: boolean },
): boolean {
  const hasIdentity = factors.includes("password") || factors.includes("proxy");
  if (!hasIdentity) return false;
  if (!options.mfaRequired || !options.mfaEnrolled) return true;
  return factors.includes("totp");
}

export type StaffSessionVerification =
  | { ok: true; claims: StaffSessionClaims }
  | { ok: false; reason: "absent" | "malformed" | "bad-signature" | "expired" | "subject-mismatch" | "revoked" };

/**
 * Verifies a token against the identity the proxy asserted.
 *
 * `email` and `epoch` are the *expected* values, taken from the request identity
 * and the staff row. Checking the signature alone would accept a valid token
 * belonging to somebody else.
 */
export async function verifyStaffSession(
  token: string | null | undefined,
  expected: { email: string; epoch: number; atMs?: number },
): Promise<StaffSessionVerification> {
  if (!token) return { ok: false, reason: "absent" };

  const parts = token.split(".");
  if (parts.length !== 8 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const payload = parts.slice(0, 7).join(".");
  const signature = parts[7];

  let expectedSignature: string;
  try {
    expectedSignature = await sign(payload);
  } catch {
    // No signing secret in production: nothing can be verified, so nothing is.
    return { ok: false, reason: "bad-signature" };
  }
  if (!equals(signature, expectedSignature)) return { ok: false, reason: "bad-signature" };

  let claims: StaffSessionClaims;
  try {
    claims = {
      email: new TextDecoder().decode(fromBase64Url(parts[1])),
      epoch: Number(parts[2]),
      verifiedAtMs: Number(parts[3]),
      expiresAtMs: Number(parts[4]),
      sessionId: new TextDecoder().decode(fromBase64Url(parts[5])),
      factors: normaliseFactors(
        new TextDecoder().decode(fromBase64Url(parts[6])).split(","),
      ),
    };
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isFinite(claims.epoch) || !Number.isFinite(claims.expiresAtMs)) {
    return { ok: false, reason: "malformed" };
  }

  // Signature verified, so the claims are ours. Now: are they still true, and
  // are they about the person currently making the request?
  if ((expected.atMs ?? Date.now()) >= claims.expiresAtMs) {
    return { ok: false, reason: "expired" };
  }
  if (!equals(claims.email, expected.email.trim().toLowerCase())) {
    return { ok: false, reason: "subject-mismatch" };
  }
  if (claims.epoch !== expected.epoch) return { ok: false, reason: "revoked" };

  return { ok: true, claims };
}

/* -------------------------------------------------------------------------- */
/* Cookie plumbing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `SameSite=Strict` rather than `Lax`: there is no legitimate cross-site
 * navigation into Clinic OS, and Strict means the MFA session is not attached to
 * a request that began on somebody else's page even for a top-level GET.
 */
export function buildSessionCookie(
  token: string,
  options: { expiresAtMs: number; secure?: boolean; nowMs?: number } = {
    expiresAtMs: 0,
  },
): string {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((options.expiresAtMs - (options.nowMs ?? Date.now())) / 1000),
  );
  const attributes = [
    `${STAFF_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (options.secure ?? !isDevelopment()) attributes.push("Secure");
  return attributes.join("; ");
}

export function buildClearedSessionCookie(options: { secure?: boolean } = {}): string {
  const attributes = [
    `${STAFF_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (options.secure ?? !isDevelopment()) attributes.push("Secure");
  return attributes.join("; ");
}

/** Pulls the session token out of a raw `Cookie` header. */
export function readSessionCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== STAFF_SESSION_COOKIE) continue;
    const value = pair.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}
