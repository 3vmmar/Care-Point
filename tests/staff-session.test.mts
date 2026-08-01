import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  issueStaffSession,
  readSessionCookie,
  staffSessionSecretConfigured,
  verifyStaffSession,
  STAFF_SESSION_COOKIE,
  STAFF_SESSION_HOURS,
} from "../lib/staff-session.ts";
import {
  decryptSecret,
  digestsMatch,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  mfaKeyConfigured,
  normaliseRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "../lib/staff-crypto.ts";

/**
 * The MFA session token and the at-rest protection around enrolment secrets,
 * both imported rather than mirrored.
 *
 * Every test here describes an attack: a forged token, an expired one, one
 * belonging to somebody else, one that survived a revocation, a tampered
 * ciphertext, a recovery code reused. A mirrored version of these modules would
 * pass all of them while shipping a signature check that always returns true.
 */

process.env.STAFF_SESSION_SECRET = "test-session-secret-not-a-real-one";
process.env.STAFF_MFA_KEY = "test-mfa-key-not-a-real-one";

const EMAIL = "reception@drashrafmetwally.com";
const NOW = 1_800_000_000_000;

/* -------------------------------------------------------------------------- */
/* Session tokens                                                             */
/* -------------------------------------------------------------------------- */

test("a freshly issued session verifies for the person it was issued to", async () => {
  const { token, claims } = await issueStaffSession({
    email: EMAIL,
    epoch: 3,
    verifiedAtMs: NOW,
  });
  assert.equal(claims.email, EMAIL);
  assert.equal(claims.expiresAtMs, NOW + STAFF_SESSION_HOURS * 3_600_000);

  const result = await verifyStaffSession(token, { email: EMAIL, epoch: 3, atMs: NOW });
  assert.equal(result.ok, true);
});

test("the email is matched case-insensitively, as addresses are", async () => {
  const { token } = await issueStaffSession({ email: EMAIL.toUpperCase(), epoch: 1 });
  const result = await verifyStaffSession(token, { email: EMAIL, epoch: 1 });
  assert.equal(result.ok, true);
});

test("no token at all is refused", async () => {
  for (const value of [null, undefined, ""]) {
    const result = await verifyStaffSession(value, { email: EMAIL, epoch: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "absent");
  }
});

test("a token with a tampered signature is refused", async () => {
  const { token } = await issueStaffSession({ email: EMAIL, epoch: 1, verifiedAtMs: NOW });
  const parts = token.split(".");
  // Flip one character of the signature.
  parts[6] = parts[6].startsWith("A") ? `B${parts[6].slice(1)}` : `A${parts[6].slice(1)}`;
  const result = await verifyStaffSession(parts.join("."), {
    email: EMAIL,
    epoch: 1,
    atMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad-signature");
});

test("extending the expiry inside the payload is refused, not honoured", async () => {
  // The interesting attack: the cookie is under the client's control, so the
  // expiry has to be inside the signature rather than only in a Max-Age.
  const { token } = await issueStaffSession({ email: EMAIL, epoch: 1, verifiedAtMs: NOW });
  const parts = token.split(".");
  parts[4] = String(NOW + 10 * 365 * 24 * 3_600_000);
  const result = await verifyStaffSession(parts.join("."), {
    email: EMAIL,
    epoch: 1,
    atMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad-signature");
});

test("a token that has expired is refused", async () => {
  const { token, claims } = await issueStaffSession({
    email: EMAIL,
    epoch: 1,
    verifiedAtMs: NOW,
  });
  const justBefore = await verifyStaffSession(token, {
    email: EMAIL,
    epoch: 1,
    atMs: claims.expiresAtMs - 1,
  });
  assert.equal(justBefore.ok, true);

  const atExpiry = await verifyStaffSession(token, {
    email: EMAIL,
    epoch: 1,
    atMs: claims.expiresAtMs,
  });
  assert.equal(atExpiry.ok, false);
  assert.equal(atExpiry.ok === false && atExpiry.reason, "expired");
});

test("a valid token belonging to somebody else does not open this account", async () => {
  // The whole reason the subject is inside the signature. Without this check, a
  // token lifted from one colleague's browser works alongside another's sign-in.
  const { token } = await issueStaffSession({ email: "doctor@clinic.eg", epoch: 1 });
  const result = await verifyStaffSession(token, { email: EMAIL, epoch: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "subject-mismatch");
});

test("bumping the epoch revokes a session that is otherwise still valid", async () => {
  const { token } = await issueStaffSession({ email: EMAIL, epoch: 4, verifiedAtMs: NOW });
  const before = await verifyStaffSession(token, { email: EMAIL, epoch: 4, atMs: NOW });
  assert.equal(before.ok, true);

  // What an MFA reset or a deactivation does. A revocation that leaves live
  // sessions running is not a revocation.
  const after = await verifyStaffSession(token, { email: EMAIL, epoch: 5, atMs: NOW });
  assert.equal(after.ok, false);
  assert.equal(after.ok === false && after.reason, "revoked");
});

test("a malformed token is refused rather than throwing", async () => {
  for (const value of ["nonsense", "v1.a.b", "v2.a.b.c.d.e.f", "....."]) {
    const result = await verifyStaffSession(value, { email: EMAIL, epoch: 1 });
    assert.equal(result.ok, false, value);
    assert.ok(
      result.ok === false && ["malformed", "bad-signature"].includes(result.reason),
      `${value} → ${result.ok === false ? result.reason : "ok"}`,
    );
  }
});

test("two sessions issued at the same instant are different strings", async () => {
  const [a, b] = await Promise.all([
    issueStaffSession({ email: EMAIL, epoch: 1, verifiedAtMs: NOW }),
    issueStaffSession({ email: EMAIL, epoch: 1, verifiedAtMs: NOW }),
  ]);
  assert.notEqual(a.token, b.token);
});

test("a token signed with a different secret is refused", async () => {
  const original = process.env.STAFF_SESSION_SECRET;
  process.env.STAFF_SESSION_SECRET = "an-attackers-guess";
  const { token } = await issueStaffSession({ email: EMAIL, epoch: 1, verifiedAtMs: NOW });
  process.env.STAFF_SESSION_SECRET = original;

  const result = await verifyStaffSession(token, { email: EMAIL, epoch: 1, atMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad-signature");
  assert.equal(staffSessionSecretConfigured(), true);
});

/* -------------------------------------------------------------------------- */
/* Cookie plumbing                                                            */
/* -------------------------------------------------------------------------- */

test("the session cookie cannot be read by script or sent cross-site", () => {
  const cookie = buildSessionCookie("token-value", {
    expiresAtMs: NOW + 3_600_000,
    nowMs: NOW,
    secure: true,
  });
  assert.match(cookie, /^carepoint_staff_mfa=token-value/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(cookie, /Path=\//);
});

test("clearing the cookie expires it immediately", () => {
  const cookie = buildClearedSessionCookie({ secure: true });
  assert.match(cookie, /^carepoint_staff_mfa=;/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
});

test("the token is found among other cookies, and only under its own name", () => {
  assert.equal(
    readSessionCookie(`other=1; ${STAFF_SESSION_COOKIE}=abc123; another=2`),
    "abc123",
  );
  assert.equal(readSessionCookie(`${STAFF_SESSION_COOKIE}=abc123`), "abc123");
  // A cookie whose name merely contains ours must not be mistaken for it.
  assert.equal(readSessionCookie(`not_${STAFF_SESSION_COOKIE}=abc123`), null);
  assert.equal(readSessionCookie(`${STAFF_SESSION_COOKIE}=`), null);
  assert.equal(readSessionCookie(""), null);
  assert.equal(readSessionCookie(null), null);
});

test("a cookie round-trips from Set-Cookie back through verification", async () => {
  const { token, claims } = await issueStaffSession({ email: EMAIL, epoch: 2 });
  const header = buildSessionCookie(token, { expiresAtMs: claims.expiresAtMs });
  // Simulate the browser echoing it back on the next request.
  const echoed = header.split(";")[0];
  const result = await verifyStaffSession(readSessionCookie(echoed), {
    email: EMAIL,
    epoch: 2,
  });
  assert.equal(result.ok, true);
});

/* -------------------------------------------------------------------------- */
/* Secret encryption                                                          */
/* -------------------------------------------------------------------------- */

test("an enrolment secret round-trips through encryption", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const stored = await encryptSecret(secret);
  assert.notEqual(stored, secret);
  assert.ok(!stored.includes(secret), "the plaintext must not appear in the payload");
  assert.equal(await decryptSecret(stored), secret);
  assert.equal(mfaKeyConfigured(), true);
});

test("the same secret encrypts differently every time", async () => {
  // A reused IV under one key is the failure that leaks both plaintexts.
  const first = await encryptSecret("SAME-SECRET");
  const second = await encryptSecret("SAME-SECRET");
  assert.notEqual(first, second);
  assert.equal(await decryptSecret(first), "SAME-SECRET");
  assert.equal(await decryptSecret(second), "SAME-SECRET");
});

test("a tampered ciphertext fails instead of decrypting to something else", async () => {
  const stored = await encryptSecret("GEZDGNBVGY3TQOJQ");
  const parts = stored.split(".");
  const body = parts[2];
  parts[2] = (body[0] === "A" ? "B" : "A") + body.slice(1);
  await assert.rejects(() => decryptSecret(parts.join(".")));
});

test("a payload in an unknown format is rejected by shape", async () => {
  await assert.rejects(() => decryptSecret("not-a-payload"), /recognised format/);
  await assert.rejects(() => decryptSecret("v9.aaaa.bbbb"), /recognised format/);
});

test("a secret cannot be read back with the wrong key", async () => {
  const stored = await encryptSecret("GEZDGNBVGY3TQOJQ");
  const original = process.env.STAFF_MFA_KEY;
  process.env.STAFF_MFA_KEY = "a-different-key";
  await assert.rejects(() => decryptSecret(stored));
  process.env.STAFF_MFA_KEY = original;
  // And still readable once the right key is back.
  assert.equal(await decryptSecret(stored), "GEZDGNBVGY3TQOJQ");
});

/* -------------------------------------------------------------------------- */
/* Recovery codes                                                             */
/* -------------------------------------------------------------------------- */

test("recovery codes avoid the characters people misread", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  for (const code of codes) {
    assert.match(code, /^[A-HJ-NP-TV-Z2-9]{4}(-[A-HJ-NP-TV-Z2-9]{4}){3}$/, code);
    // I, L, O, U, 0 and 1 are absent because they look like each other.
    assert.ok(!/[ILOU01]/.test(code), code);
  }
  assert.equal(new Set(codes).size, codes.length);
});

test("recovery codes carry enough entropy that a fast hash is safe", () => {
  // Sixteen characters from a thirty-character alphabet is about 78 bits, which
  // is what justifies a single SHA-256 rather than a slow KDF.
  const codes = generateRecoveryCodes(200);
  assert.equal(new Set(codes).size, 200);
});

test("a recovery code is accepted however it was typed", async () => {
  const [code] = generateRecoveryCodes(1);
  const canonical = await hashRecoveryCode(code);
  assert.equal(await hashRecoveryCode(code.toLowerCase()), canonical);
  assert.equal(await hashRecoveryCode(code.replace(/-/g, "")), canonical);
  assert.equal(await hashRecoveryCode(code.replace(/-/g, " ")), canonical);
  assert.equal(normaliseRecoveryCode("abcd-efgh"), "ABCDEFGH");
});

test("different recovery codes hash differently", async () => {
  const [first, second] = generateRecoveryCodes(2);
  assert.notEqual(await hashRecoveryCode(first), await hashRecoveryCode(second));
});

test("digest comparison is exact", async () => {
  const digest = await hashRecoveryCode("ABCD-EFGH-JKMN-PQRS");
  assert.equal(digestsMatch(digest, digest), true);
  assert.equal(digestsMatch(digest, `${digest}x`), false);
  assert.equal(digestsMatch(digest, await hashRecoveryCode("ABCD-EFGH-JKMN-PQRT")), false);
});
