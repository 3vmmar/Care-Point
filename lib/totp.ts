/**
 * Time-based one-time passwords (RFC 6238) over WebCrypto.
 *
 * The second factor for clinic staff. Identity arrives from the platform proxy,
 * which proves someone signed in to a platform account — not that the person
 * holding that account is the receptionist. A stolen or shared platform
 * password otherwise reads the whole patient book, and a practice cannot rotate
 * a credential it does not own.
 *
 * TOTP was chosen over WebAuthn/passkeys because a Cairo clinic's reception
 * shares a desktop between shifts and staff use their own phones: an
 * authenticator app works on any handset, survives a browser reinstall, and
 * needs no platform enrolment ceremony. Passkeys would be stronger and remain
 * the right upgrade once the practice is on its own domain.
 *
 * Implemented here rather than pulled in as a dependency because the whole
 * algorithm is forty lines of WebCrypto, and it is verified against the test
 * vectors published in RFC 6238 Appendix B — an external oracle, so this file
 * cannot be green while being wrong in the way a self-mirroring test allows.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 defaults. The clinic has no reason to deviate. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/**
 * Codes from one step either side are accepted, so a phone clock a few seconds
 * out still works. Wider would be friendlier and weaker: every extra step is
 * another 10^6-space code valid at the same moment.
 */
export const TOTP_DRIFT_STEPS = 1;

/** RFC 4226 §4 recommends at least 128 bits; 160 matches the HMAC-SHA1 block. */
const SECRET_BYTES = 20;

export function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];

  // Pad to a multiple of eight characters, as RFC 4648 requires.
  while (output.length % 8 !== 0) output += "=";
  return output;
}

/**
 * Tolerant by design: staff type these by hand, and authenticator apps display
 * secrets in lowercase, in groups of four, with or without padding.
 */
export function decodeBase32(value: string): Uint8Array {
  const cleaned = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!cleaned) return new Uint8Array(0);

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("That is not a valid base32 secret.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // Any leftover bits are the encoder's padding, not data.
  return new Uint8Array(bytes);
}

/** A fresh enrolment secret, base32 for the authenticator app. */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase32(bytes);
}

/** The RFC 6238 time step for a moment. `Date.now()` when not given one. */
export function counterFor(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  // Counter is a 64-bit big-endian integer. Above 2^32 steps JavaScript's
  // bitwise operators would truncate, so the high word is derived by division.
  let high = Math.floor(counter / 0x100000000);
  let low = counter % 0x100000000;
  for (let index = 7; index >= 4; index -= 1) {
    bytes[index] = low & 0xff;
    low = Math.floor(low / 256);
  }
  for (let index = 3; index >= 0; index -= 1) {
    bytes[index] = high & 0xff;
    high = Math.floor(high / 256);
  }
  return bytes;
}

/** HOTP (RFC 4226): the code for one counter value. */
export async function hotp(
  secret: string,
  counter: number,
  digits: number = TOTP_DIGITS,
): Promise<string> {
  const keyBytes = decodeBase32(secret);
  if (keyBytes.length === 0) throw new Error("A one-time password secret is required.");

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counterBytes(counter) as unknown as ArrayBuffer),
  );

  // Dynamic truncation, RFC 4226 §5.4: the low nibble of the last byte selects
  // which four bytes of the MAC become the code.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The code a correctly configured authenticator is showing right now. */
export function totp(
  secret: string,
  atMs: number = Date.now(),
  digits: number = TOTP_DIGITS,
): Promise<string> {
  return hotp(secret, counterFor(atMs), digits);
}

/**
 * Compares without an early exit.
 *
 * A string `===` returns as soon as two characters differ, which in principle
 * lets a caller learn the expected code one digit at a time. Not a practical
 * attack against a code that changes every thirty seconds, but the loop costs
 * nothing.
 */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

export type TotpVerification =
  | { ok: true; counter: number }
  | { ok: false; reason: "malformed" | "mismatch" | "reused" };

/**
 * Checks a submitted code and reports which time step it came from.
 *
 * The counter matters: RFC 6238 §5.2 requires a code to be accepted only once,
 * so the caller stores the returned value and passes it back as `minCounter`.
 * Without that, a code shoulder-surfed or read from a screenshot stays valid for
 * the rest of its window — and with drift accepted either side, a replay window
 * of up to ninety seconds is plenty to hijack a session on a shared reception
 * desktop.
 */
export async function verifyTotp(
  secret: string,
  submitted: string,
  options: { atMs?: number; minCounter?: number; driftSteps?: number } = {},
): Promise<TotpVerification> {
  const code = submitted.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "malformed" };

  const drift = options.driftSteps ?? TOTP_DRIFT_STEPS;
  const current = counterFor(options.atMs ?? Date.now());
  const minCounter = options.minCounter ?? -1;

  let sawReuse = false;
  // Newest first, so a code valid at more than one step records the latest
  // counter and burns the widest range of replays.
  for (let step = drift; step >= -drift; step -= 1) {
    const counter = current + step;
    if (counter < 0) continue;
    if (!equals(await hotp(secret, counter), code)) continue;
    if (counter <= minCounter) {
      sawReuse = true;
      continue;
    }
    return { ok: true, counter };
  }

  return { ok: false, reason: sawReuse ? "reused" : "mismatch" };
}

/**
 * The `otpauth://` URI an authenticator app consumes.
 *
 * Rendered as text and as a QR code on the enrolment page. The label carries the
 * issuer twice — as a prefix and as a parameter — because older apps read only
 * one of the two.
 */
export function otpauthUri(options: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = `${options.issuer}:${options.account}`;
  const parameters = new URLSearchParams({
    secret: options.secret.replace(/=+$/, ""),
    issuer: options.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  // `URLSearchParams` renders spaces as `+`, which some apps show literally.
  return `otpauth://totp/${encodeURIComponent(label)}?${parameters.toString().replace(/\+/g, "%20")}`;
}
