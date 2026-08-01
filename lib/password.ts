/**
 * Staff passwords.
 *
 * Until now identity came entirely from the hosting platform: a header injected
 * by an authenticating proxy, believed only because `lib/trusted-proxy.ts` strips
 * it unless the proxy proves itself. That worked, but it made the practice
 * dependent on a credential it neither issued nor could rotate — and on the
 * platform being able to send a custom header, which was the single largest
 * unanswered question blocking production.
 *
 * A password the clinic owns removes both problems. It also introduces the one
 * this file exists to handle: a human-chosen secret is low-entropy, so how it is
 * stored is the whole game.
 *
 * **PBKDF2-SHA256, not bcrypt or Argon2.** Those are the better algorithms and
 * neither is available here: Workers expose WebCrypto and no native crypto, so
 * anything else would mean shipping WASM into a Worker that must cold-start fast.
 * PBKDF2 with a high iteration count is what the platform actually offers, and it
 * is a great deal better than a fast hash.
 *
 * Deliberately free of `cloudflare:workers` and `next/headers` so the node test
 * runner can exercise the real implementation rather than a mirror of it.
 */

/**
 * Cost parameter.
 *
 * OWASP currently suggests 600,000 for PBKDF2-HMAC-SHA256. That is measurably
 * too slow inside a Worker's CPU budget once a cold start is in the same request,
 * so this sits lower and says so rather than quietly claiming the higher number.
 * The trade is acceptable because it is defended in depth: sign-in is rate limited
 * per client and per account, every account can carry a second factor, and the
 * hash is never the only thing between an attacker and the data.
 *
 * Stored *inside* each hash, so raising it later does not invalidate existing
 * passwords — `needsRehash` reports which ones to upgrade on next sign-in.
 */
export const PBKDF2_ITERATIONS = 210_000;

const ALGORITHM = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Long enough that the iteration count is not carrying the whole burden. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    key,
    KEY_BITS,
  );
  return toBase64(new Uint8Array(bits));
}

/**
 * Hashes a password for storage.
 *
 * The result carries its own algorithm, cost and salt, so verification never has
 * to guess and the cost can be raised without a migration.
 */
export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, iterations);
  return `${ALGORITHM}$${iterations}$${toBase64(salt)}$${hash}`;
}

/** Compares two digests without an early exit. */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Checks a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt row
 * must read as "wrong password", not as a 500 that tells an attacker the account
 * exists and is broken.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1_000 || iterations > 5_000_000) {
    return false;
  }
  try {
    const candidate = await derive(password, fromBase64(parts[2]), iterations);
    return equals(candidate, parts[3]);
  } catch {
    return false;
  }
}

/**
 * Whether a stored hash was made with a weaker cost than we now use.
 *
 * The caller re-hashes on a successful sign-in, which is the only moment the
 * plaintext is available — so raising `PBKDF2_ITERATIONS` upgrades the estate
 * gradually as people sign in, rather than never.
 */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return true;
  const iterations = Number(parts[1]);
  return !Number.isInteger(iterations) || iterations < PBKDF2_ITERATIONS;
}

export type PasswordProblem =
  | "too-short"
  | "too-long"
  | "too-simple"
  | "contains-email"
  | "common";

/**
 * A short list of passwords that appear at the top of every breach corpus.
 *
 * Not a substitute for a real breached-password check — that needs a dataset and
 * a network call, and is worth adding once the practice is live. This catches the
 * handful that a rushed first-time setup actually produces.
 */
const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "letmein123",
  "welcome123",
  "iloveyou",
  "admin1234",
  "clinic123",
  "carepoint",
  "carepoint123",
  "drashraf",
  "drashraf123",
]);

/**
 * Rules chosen to stop the passwords people actually pick, and no more.
 *
 * Deliberately not a character-class matrix. Forcing a symbol and a digit
 * reliably produces `Password1!` — it raises the floor by nothing and the
 * annoyance by a lot. Length plus a variety check plus rejecting the obvious is
 * a better trade for a clinic where the alternative is a sticky note.
 */
export function checkPasswordStrength(
  password: string,
  email?: string,
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push("too-short");
  if (password.length > MAX_PASSWORD_LENGTH) problems.push("too-long");

  const normalised = password.trim().toLowerCase();
  if (COMMON.has(normalised)) problems.push("common");

  // A single repeated character, or a straight run, is length without entropy.
  const distinct = new Set(normalised).size;
  if (password.length >= MIN_PASSWORD_LENGTH && distinct < 5) problems.push("too-simple");

  const localPart = email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && normalised.includes(localPart)) {
    problems.push("contains-email");
  }

  return problems;
}

/** Human wording for each rule, shown on the form rather than a generic refusal. */
export function describePasswordProblem(problem: PasswordProblem): string {
  switch (problem) {
    case "too-short":
      return `Use at least ${MIN_PASSWORD_LENGTH} characters — length matters more than symbols.`;
    case "too-long":
      return `Keep it under ${MAX_PASSWORD_LENGTH} characters.`;
    case "too-simple":
      return "Too few different characters. A short phrase works well.";
    case "contains-email":
      return "Do not build the password out of your own email address.";
    case "common":
      return "That password appears on every breached-password list.";
  }
}

/**
 * A temporary password an owner can read out over the phone.
 *
 * Unambiguous alphabet and grouped, because it is going to be spoken aloud and
 * typed once. Long enough that it is not guessable in the window before the
 * person changes it — which they are forced to do on first sign-in.
 */
const TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export function generateTemporaryPassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    if (index > 0 && index % 4 === 0) out += "-";
    out += TEMP_ALPHABET[bytes[index] % TEMP_ALPHABET.length];
  }
  return out;
}
