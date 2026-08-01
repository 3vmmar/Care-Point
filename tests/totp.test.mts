import assert from "node:assert/strict";
import test from "node:test";
import {
  counterFor,
  decodeBase32,
  encodeBase32,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
  TOTP_PERIOD_SECONDS,
} from "../lib/totp.ts";

/**
 * The real module, checked against externally published vectors.
 *
 * This is deliberately not a mirror of the implementation. Twice in this project
 * a mirrored test stayed green while the shipped function was broken (see
 * docs/SECURITY-REVIEW.md), and a second factor that silently accepts the wrong
 * code is worse than no second factor at all — it makes the clinic believe it
 * has one. The vectors below come from RFC 4648 §10 and RFC 6238 Appendix B, so
 * a wrong implementation cannot agree with them by construction.
 */

/* -------------------------------------------------------------------------- */
/* Base32 — RFC 4648 §10                                                      */
/* -------------------------------------------------------------------------- */

const RFC4648_VECTORS: Array<[string, string]> = [
  ["", ""],
  ["f", "MY======"],
  ["fo", "MZXQ===="],
  ["foo", "MZXW6==="],
  ["foob", "MZXW6YQ="],
  ["fooba", "MZXW6YTB"],
  ["foobar", "MZXW6YTBOI======"],
];

test("base32 encoding matches the RFC 4648 test vectors", () => {
  for (const [plain, encoded] of RFC4648_VECTORS) {
    assert.equal(encodeBase32(new TextEncoder().encode(plain)), encoded, plain);
  }
});

test("base32 decoding matches the RFC 4648 test vectors", () => {
  for (const [plain, encoded] of RFC4648_VECTORS) {
    assert.equal(new TextDecoder().decode(decodeBase32(encoded)), plain, encoded);
  }
});

test("a hand-typed secret survives lowercase, spaces and missing padding", () => {
  const canonical = decodeBase32("MZXW6YTBOI======");
  assert.deepEqual(decodeBase32("mzxw6ytboi"), canonical);
  assert.deepEqual(decodeBase32("MZXW 6YTB OI"), canonical);
  assert.deepEqual(decodeBase32("MZXW-6YTB-OI"), canonical);
});

test("a secret containing characters outside the alphabet is rejected", () => {
  // 0, 1 and 8 are absent from base32 precisely because they misread as O, I, B.
  assert.throws(() => decodeBase32("MZXW6YT1"), /valid base32/);
});

/* -------------------------------------------------------------------------- */
/* TOTP — RFC 6238 Appendix B                                                 */
/* -------------------------------------------------------------------------- */

/** base32("12345678901234567890"), the seed used by every vector in the RFC. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("the RFC seed is the ASCII string the RFC specifies", () => {
  assert.equal(new TextDecoder().decode(decodeBase32(RFC_SECRET)), "12345678901234567890");
});

/** [unix seconds, 8-digit code]. SHA-1 rows of the Appendix B table. */
const RFC6238_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("eight-digit codes match RFC 6238 Appendix B", async () => {
  for (const [seconds, expected] of RFC6238_VECTORS) {
    assert.equal(await totp(RFC_SECRET, seconds * 1000, 8), expected, String(seconds));
  }
});

test("six-digit codes are the same truncation, one order of magnitude down", async () => {
  for (const [seconds, expected] of RFC6238_VECTORS) {
    assert.equal(await totp(RFC_SECRET, seconds * 1000), expected.slice(-6), String(seconds));
  }
});

test("the counter is the number of whole periods since the epoch", () => {
  assert.equal(counterFor(0), 0);
  assert.equal(counterFor(59_000), 1);
  assert.equal(counterFor(1111111109_000), 0x23523ec);
  assert.equal(counterFor(20000000000_000), 0x27bc86aa);
});

test("the counter above 2^32 steps is not truncated by bitwise arithmetic", async () => {
  // 20000000000s is counter 0x27BC86AA, which overflows a 32-bit shift. The RFC
  // vector for it therefore only passes if the 64-bit counter is built by
  // division rather than with `<<`.
  assert.equal(await hotp(RFC_SECRET, 0x27bc86aa, 8), "65353130");
});

/* -------------------------------------------------------------------------- */
/* Verification, drift and replay                                             */
/* -------------------------------------------------------------------------- */

const NOW = 1234567890_000;

test("the code an authenticator is currently showing is accepted", async () => {
  const code = await totp(RFC_SECRET, NOW);
  const result = await verifyTotp(RFC_SECRET, code, { atMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.counter, counterFor(NOW));
});

test("a code one step either side is accepted, two steps is not", async () => {
  const period = TOTP_PERIOD_SECONDS * 1000;
  for (const offset of [-period, 0, period]) {
    const code = await totp(RFC_SECRET, NOW + offset);
    const result = await verifyTotp(RFC_SECRET, code, { atMs: NOW });
    assert.equal(result.ok, true, `offset ${offset}`);
  }
  for (const offset of [-2 * period, 2 * period]) {
    const code = await totp(RFC_SECRET, NOW + offset);
    const result = await verifyTotp(RFC_SECRET, code, { atMs: NOW });
    assert.equal(result.ok, false, `offset ${offset}`);
  }
});

test("a code already used is refused even while its window is open", async () => {
  const code = await totp(RFC_SECRET, NOW);
  const first = await verifyTotp(RFC_SECRET, code, { atMs: NOW });
  assert.equal(first.ok, true);

  // RFC 6238 §5.2: one code, one login. Replaying it inside the same window is
  // the shoulder-surfing case, so it has to fail distinguishably.
  const replay = await verifyTotp(RFC_SECRET, code, {
    atMs: NOW,
    minCounter: first.ok ? first.counter : 0,
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.ok === false && replay.reason, "reused");
});

test("a code from before the last accepted one cannot be walked backwards", async () => {
  const period = TOTP_PERIOD_SECONDS * 1000;
  const previous = await totp(RFC_SECRET, NOW - period);
  const result = await verifyTotp(RFC_SECRET, previous, {
    atMs: NOW,
    minCounter: counterFor(NOW),
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "reused");
});

test("the wrong code and a malformed one are told apart", async () => {
  const wrong = await verifyTotp(RFC_SECRET, "000000", { atMs: NOW });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.ok === false && wrong.reason, "mismatch");

  for (const input of ["", "12345", "1234567", "abcdef", "12 34 5"]) {
    const result = await verifyTotp(RFC_SECRET, input, { atMs: NOW });
    assert.equal(result.ok, false, input);
    assert.equal(result.ok === false && result.reason, "malformed", input);
  }
});

test("a code typed with the spacing an app displays is accepted", async () => {
  const code = await totp(RFC_SECRET, NOW);
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const result = await verifyTotp(RFC_SECRET, spaced, { atMs: NOW });
  assert.equal(result.ok, true);
});

test("another account's secret does not open this one", async () => {
  const mine = generateTotpSecret();
  const theirs = generateTotpSecret();
  const code = await totp(theirs, NOW);
  const result = await verifyTotp(mine, code, { atMs: NOW });
  assert.equal(result.ok, false);
});

/* -------------------------------------------------------------------------- */
/* Enrolment                                                                  */
/* -------------------------------------------------------------------------- */

test("a generated secret is 160 bits of base32 and never repeats", () => {
  const secrets = new Set<string>();
  for (let index = 0; index < 50; index += 1) {
    const secret = generateTotpSecret();
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.equal(decodeBase32(secret).length, 20);
    secrets.add(secret);
  }
  assert.equal(secrets.size, 50);
});

test("the otpauth URI carries what an authenticator needs", () => {
  const uri = otpauthUri({
    secret: "MZXW6YTBOI======",
    account: "reception@drashrafmetwally.com",
    issuer: "Care Point",
  });
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "otpauth:");
  assert.equal(parsed.host, "totp");
  assert.equal(
    decodeURIComponent(parsed.pathname.slice(1)),
    "Care Point:reception@drashrafmetwally.com",
  );
  // Padding confuses several apps, and a literal `+` reads as part of the name.
  assert.equal(parsed.searchParams.get("secret"), "MZXW6YTBOI");
  assert.equal(parsed.searchParams.get("issuer"), "Care Point");
  assert.equal(parsed.searchParams.get("digits"), "6");
  assert.equal(parsed.searchParams.get("period"), "30");
  assert.ok(!uri.includes("+"), uri);
});

test("the enrolment URI round-trips through a real verification", async () => {
  const secret = generateTotpSecret();
  const uri = otpauthUri({ secret, account: "dr@clinic.eg", issuer: "Care Point" });
  // What the app stores is the unpadded secret from the URI, so a code generated
  // from that must satisfy the verifier holding the padded original.
  const fromUri = new URL(uri).searchParams.get("secret") ?? "";
  const code = await totp(fromUri, NOW);
  const result = await verifyTotp(secret, code, { atMs: NOW });
  assert.equal(result.ok, true);
});
