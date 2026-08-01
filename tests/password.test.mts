import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  checkPasswordStrength,
  describePasswordProblem,
  generateTemporaryPassword,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "../lib/password.ts";

/**
 * The real module, not a mirror.
 *
 * A password check that silently returns true is the worst possible defect in this
 * codebase, so every assertion below is about a way it could be wrong: a hash that
 * does not depend on the password, a comparison that accepts anything, a stored
 * value an attacker could craft.
 */

const PASSWORD = "correct horse battery staple";

test("a password verifies against its own hash and nothing else", async () => {
  const stored = await hashPassword(PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, stored), true);
  assert.equal(await verifyPassword("wrong horse battery staple", stored), false);
  assert.equal(await verifyPassword(PASSWORD.toUpperCase(), stored), false);
  // Trailing whitespace is a different password, not a forgiving one.
  assert.equal(await verifyPassword(`${PASSWORD} `, stored), false);
});

test("the same password hashes differently every time", async () => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);
  // Per-user salts: two staff choosing the same password must not be visibly
  // identical in the table, and a precomputed table must not help.
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(PASSWORD, first), true);
  assert.equal(await verifyPassword(PASSWORD, second), true);
});

test("the stored form carries its algorithm, cost and salt", async () => {
  const stored = await hashPassword(PASSWORD);
  const [algorithm, iterations, salt, hash] = stored.split("$");
  assert.equal(algorithm, "pbkdf2-sha256");
  assert.equal(Number(iterations), PBKDF2_ITERATIONS);
  assert.ok(salt.length > 0);
  assert.ok(hash.length > 0);
  // The plaintext must not appear anywhere in it.
  assert.ok(!stored.includes(PASSWORD));
});

test("a missing or malformed stored hash reads as a wrong password", async () => {
  // Never a throw: a corrupt row must not become a 500 that tells an attacker the
  // account exists and is broken.
  for (const stored of [
    null,
    undefined,
    "",
    "not-a-hash",
    "pbkdf2-sha256$only$three",
    "bcrypt$12$salt$hash",
    "pbkdf2-sha256$abc$c2FsdA==$aGFzaA==",
    // Absurd cost, which would otherwise be a denial-of-service on our own CPU.
    "pbkdf2-sha256$99999999$c2FsdA==$aGFzaA==",
    "pbkdf2-sha256$10$c2FsdA==$aGFzaA==",
  ]) {
    assert.equal(await verifyPassword(PASSWORD, stored), false, String(stored));
  }
});

test("a hash with non-base64 salt fails rather than throwing", async () => {
  assert.equal(
    await verifyPassword(PASSWORD, "pbkdf2-sha256$210000$!!!not-base64!!!$aGFzaA=="),
    false,
  );
});

test("an empty password does not match a real hash", async () => {
  const stored = await hashPassword(PASSWORD);
  assert.equal(await verifyPassword("", stored), false);
});

test("a weaker stored cost is flagged for upgrade on next sign-in", async () => {
  const weak = await hashPassword(PASSWORD, 1_000);
  assert.equal(needsRehash(weak), true);
  // It still verifies — raising the cost must not lock anybody out.
  assert.equal(await verifyPassword(PASSWORD, weak), true);

  const current = await hashPassword(PASSWORD);
  assert.equal(needsRehash(current), false);

  // Anything unrecognised is worth replacing.
  assert.equal(needsRehash("bcrypt$12$x$y"), true);
  assert.equal(needsRehash(null), false);
});

test("hashing costs enough to matter and not enough to time out", async () => {
  const started = Date.now();
  await hashPassword(PASSWORD);
  const elapsed = Date.now() - started;
  // A fast hash would make an offline attack on a leaked table cheap; a slow one
  // would exceed a Worker's CPU budget on a cold start. This is the window.
  assert.ok(elapsed > 15, `too fast to be a real KDF: ${elapsed}ms`);
  assert.ok(elapsed < 3_000, `too slow for a Worker request: ${elapsed}ms`);
});

/* -------------------------------------------------------------------------- */
/* Strength rules                                                             */
/* -------------------------------------------------------------------------- */

test("a decent passphrase is accepted", () => {
  assert.deepEqual(checkPasswordStrength("clinic mornings in maadi", "dr@clinic.eg"), []);
  assert.deepEqual(checkPasswordStrength("Tuesday-Rota-Nineteen", "dr@clinic.eg"), []);
});

test("short passwords are refused however clever", () => {
  assert.ok(checkPasswordStrength("Xy7!qP2z").includes("too-short"));
  assert.equal(checkPasswordStrength("a".repeat(MIN_PASSWORD_LENGTH - 1)).includes("too-short"), true);
});

test("length without variety is refused", () => {
  // The rule exists because "aaaaaaaaaaaaaaa" satisfies a naive length check.
  assert.ok(checkPasswordStrength("aaaaaaaaaaaaaaaa").includes("too-simple"));
  assert.ok(checkPasswordStrength("abababababababab").includes("too-simple"));
});

test("passwords built from the account's own email are refused", () => {
  assert.ok(
    checkPasswordStrength("reception2026clinic", "reception@drashrafmetwally.com").includes(
      "contains-email",
    ),
  );
  // A short local part is not treated as a substring worth banning.
  assert.equal(
    checkPasswordStrength("drawbridge mornings", "dr@clinic.eg").includes("contains-email"),
    false,
  );
});

test("the obvious breached passwords are refused", () => {
  for (const value of ["password123", "PASSWORD123", "carepoint123", "drashraf123"]) {
    assert.ok(checkPasswordStrength(value).includes("common"), value);
  }
});

test("every rule has wording a person can act on", () => {
  for (const problem of [
    "too-short",
    "too-long",
    "too-simple",
    "contains-email",
    "common",
  ] as const) {
    const message = describePasswordProblem(problem);
    assert.ok(message.length > 20, problem);
    // No jargon: these are read by reception, not by a developer.
    assert.ok(!/entropy|hash|kdf/i.test(message), message);
  }
});

test("an over-long password is refused rather than silently truncated", () => {
  assert.ok(checkPasswordStrength("a1B2".repeat(100)).includes("too-long"));
});

/* -------------------------------------------------------------------------- */
/* Temporary passwords                                                        */
/* -------------------------------------------------------------------------- */

test("a temporary password is readable aloud and strong enough to survive the call", () => {
  const codes = new Set<string>();
  for (let index = 0; index < 50; index += 1) {
    const temp = generateTemporaryPassword();
    assert.match(temp, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/, temp);
    // I, L, O, U, 0 and 1 are absent because this gets spoken over a phone.
    assert.ok(!/[ILOU01]/.test(temp), temp);
    codes.add(temp);
  }
  assert.equal(codes.size, 50);
});

test("a temporary password passes the strength rules it will be checked against", () => {
  // It is set by an owner through the same validation path, so it must not be
  // rejected by the rules the clinic's own passwords are held to.
  for (let index = 0; index < 20; index += 1) {
    assert.deepEqual(checkPasswordStrength(generateTemporaryPassword()), []);
  }
});
