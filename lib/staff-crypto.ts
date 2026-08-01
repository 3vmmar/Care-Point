/**
 * At-rest protection for the things that let someone log in as a staff member.
 *
 * A TOTP secret is not a password hash. It is a symmetric key: whoever holds it
 * can generate valid codes forever, silently, from anywhere. So if the staff
 * table were ever read — a leaked D1 export, a misdirected backup, a query run
 * by the wrong person — plaintext secrets would hand over a permanent second
 * factor for every account, and nobody would know to rotate them. They are
 * therefore encrypted with a key that lives in the Worker's environment rather
 * than in the database, so reading the database is not sufficient.
 *
 * Recovery codes are hashed rather than encrypted, because nothing ever needs to
 * read them back — only to check whether a submitted one matches.
 */

const KEY_ENV = "STAFF_MFA_KEY";
const CIPHER_VERSION = "v1";

/**
 * Unambiguous by design: no I, L, O, U, 0 or 1, so a code read off a screen and
 * typed on a phone under pressure does not fail on a character that looks like
 * another one.
 */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const RECOVERY_GROUPS = 4;
const RECOVERY_GROUP_SIZE = 4;
export const RECOVERY_CODE_COUNT = 10;

function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Development key.
 *
 * Local work must not require a secret to be provisioned, but a fixed key must
 * never protect a real secret. Production refuses to encrypt at all without a
 * configured key, so this value can only ever guard synthetic local data.
 */
const DEVELOPMENT_KEY = "carepoint-development-only-mfa-key";

let warnedAboutDevelopmentKey = false;

function keyMaterial(): string {
  const configured = process.env[KEY_ENV];
  if (configured && configured.trim()) return configured.trim();

  if (!isDevelopment()) {
    // Failing closed is the only honest option: the alternative is writing a
    // permanent login credential to the database in the clear.
    throw new Error(
      `${KEY_ENV} is not configured, so staff MFA secrets cannot be stored safely.`,
    );
  }
  if (!warnedAboutDevelopmentKey) {
    warnedAboutDevelopmentKey = true;
    console.warn(
      `[security] ${KEY_ENV} is not set; staff MFA secrets are encrypted with the ` +
        "development key. Never carry a database written this way into production.",
    );
  }
  return DEVELOPMENT_KEY;
}

export function mfaKeyConfigured(): boolean {
  const configured = process.env[KEY_ENV];
  return Boolean(configured && configured.trim());
}

let cachedKey: { material: string; key: Promise<CryptoKey> } | null = null;

function aesKey(): Promise<CryptoKey> {
  const material = keyMaterial();
  // Re-derive whenever the material changes so a test can swap keys, but avoid a
  // digest and an import on every single read.
  if (cachedKey?.material === material) return cachedKey.key;

  const key = (async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(material),
    );
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  })();
  cachedKey = { material, key };
  return key;
}

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

/**
 * Encrypts an enrolment secret for storage.
 *
 * A fresh 96-bit IV per record, as AES-GCM requires: reusing one across two
 * records with the same key is the failure mode that leaks both plaintexts.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
      await aesKey(),
      new TextEncoder().encode(plaintext) as unknown as ArrayBuffer,
    ),
  );
  return `${CIPHER_VERSION}.${toBase64(iv)}.${toBase64(ciphertext)}`;
}

/**
 * Reverses `encryptSecret`. Throws on a payload that has been tampered with —
 * GCM authenticates, so a modified ciphertext fails rather than decrypting to
 * something plausible.
 */
export async function decryptSecret(payload: string): Promise<string> {
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== CIPHER_VERSION) {
    throw new Error("Stored MFA secret is not in a recognised format.");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(parts[1]) as unknown as ArrayBuffer },
    await aesKey(),
    fromBase64(parts[2]) as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * One-time codes for the day a phone is lost or replaced.
 *
 * Without these, losing a handset means an owner has to reset the account — and
 * if the person who lost the phone *is* the only owner, the practice is locked
 * out of its own appointment book.
 *
 * Sixteen characters from a thirty-character alphabet is about 78 bits, which is
 * why a single SHA-256 is enough to store them. The usual objection to fast
 * hashing applies to human-chosen passwords, whose entropy is low enough to
 * enumerate; it does not apply to a machine-generated secret this size. Raising
 * the entropy is a better answer here than a slow KDF, which on a Worker would
 * mean ten expensive derivations per attempt against the CPU budget.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const bytes = new Uint8Array(RECOVERY_GROUPS * RECOVERY_GROUP_SIZE);
    crypto.getRandomValues(bytes);
    let code = "";
    for (let position = 0; position < bytes.length; position += 1) {
      if (position > 0 && position % RECOVERY_GROUP_SIZE === 0) code += "-";
      // Modulo bias across a 30-character alphabet from a 256-value byte is
      // negligible next to 78 bits of total entropy.
      code += RECOVERY_ALPHABET[bytes[position] % RECOVERY_ALPHABET.length];
    }
    codes.push(code);
  }
  return codes;
}

/** Accepts a code however it was typed: lowercase, spaced, or without dashes. */
export function normaliseRecoveryCode(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normaliseRecoveryCode(code)) as unknown as ArrayBuffer,
  );
  return toBase64(new Uint8Array(digest));
}

/** Compares two digests without an early exit. */
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
