import assert from "node:assert/strict";
import test from "node:test";
import { serialiseJsonLd } from "../lib/site.ts";

/**
 * The staff-identity trust boundary.
 *
 * Mirrors `lib/trusted-proxy.ts`, which cannot be imported here because the
 * worker entry pulls in `cloudflare:workers`. Keep the two in step.
 *
 * The rule under test is the one that stops this from working in production:
 *
 *   curl -H "oai-authenticated-user-email: dr.ashraf@clinic.eg" /api/bookings
 *
 * Before the fix that returned every patient's name, phone and email, because
 * identity was read straight from a header any caller can set.
 */

const PROXY_AUTH_HEADER = "x-carepoint-proxy-auth";
const IDENTITY_PREFIX = "oai-authenticated-user-";

type Decision = {
  trusted: boolean;
  reason: "verified" | "development" | "no-secret-configured" | "bad-secret" | "absent";
};

function decide(input: {
  secret?: string;
  presented?: string | null;
  production: boolean;
}): Decision {
  const { secret, presented, production } = input;
  if (secret) {
    if (!presented) return { trusted: false, reason: "absent" };
    return presented === secret
      ? { trusted: true, reason: "verified" }
      : { trusted: false, reason: "bad-secret" };
  }
  return production
    ? { trusted: false, reason: "no-secret-configured" }
    : { trusted: true, reason: "development" };
}

/** Mirrors `stripIdentityHeaders`. */
function sanitise(headers: Record<string, string>, trusted: boolean) {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === PROXY_AUTH_HEADER) continue; // never forwarded either way
    if (!trusted && lower.startsWith(IDENTITY_PREFIX)) continue;
    output[key] = value;
  }
  return output;
}

const SPOOFED = {
  "oai-authenticated-user-email": "dr.ashraf@clinic.eg",
  "oai-authenticated-user-full-name": "Dr%20Ashraf",
  "user-agent": "curl/8.0",
};

test("a forged identity header is stripped in production", () => {
  const decision = decide({ production: true, secret: "s3cret", presented: null });
  assert.equal(decision.trusted, false);
  assert.equal(decision.reason, "absent");

  const safe = sanitise(SPOOFED, decision.trusted);
  assert.equal(safe["oai-authenticated-user-email"], undefined);
  assert.equal(safe["oai-authenticated-user-full-name"], undefined);
  // Non-identity headers are untouched.
  assert.equal(safe["user-agent"], "curl/8.0");
});

test("a wrong secret is no better than no secret", () => {
  const decision = decide({ production: true, secret: "s3cret", presented: "guess" });
  assert.equal(decision.trusted, false);
  assert.equal(decision.reason, "bad-secret");
  assert.equal(sanitise(SPOOFED, decision.trusted)["oai-authenticated-user-email"], undefined);
});

test("the real proxy is believed", () => {
  const decision = decide({ production: true, secret: "s3cret", presented: "s3cret" });
  assert.equal(decision.trusted, true);
  assert.equal(decision.reason, "verified");
  assert.equal(
    sanitise({ ...SPOOFED, [PROXY_AUTH_HEADER]: "s3cret" }, decision.trusted)[
      "oai-authenticated-user-email"
    ],
    "dr.ashraf@clinic.eg",
  );
});

test("production with no secret configured fails closed", () => {
  // Locking staff out loudly is the correct outcome for a surface that renders
  // patient contact details. Failing open would mean anyone can read them.
  const decision = decide({ production: true, secret: undefined, presented: null });
  assert.equal(decision.trusted, false);
  assert.equal(decision.reason, "no-secret-configured");
  assert.equal(sanitise(SPOOFED, decision.trusted)["oai-authenticated-user-email"], undefined);
});

test("development still works without a secret", () => {
  const decision = decide({ production: false, secret: undefined, presented: null });
  assert.equal(decision.trusted, true);
  assert.equal(decision.reason, "development");
});

test("the shared secret is never forwarded to application code", () => {
  // It must not reach a log line, an error report, or an echoed header.
  for (const trusted of [true, false]) {
    const safe = sanitise({ ...SPOOFED, [PROXY_AUTH_HEADER]: "s3cret" }, trusted);
    assert.equal(safe[PROXY_AUTH_HEADER], undefined);
  }
});

test("identity headers are matched case-insensitively", () => {
  // HTTP header names are case-insensitive; a stripper that only matched
  // lowercase would be trivially bypassed with `OAI-Authenticated-User-Email`.
  const safe = sanitise({ "OAI-Authenticated-User-Email": "x@y.eg" }, false);
  assert.deepEqual(Object.keys(safe), []);
});

/* -------------------------------------------------------------------------- */

/**
 * Structured-data escaping.
 *
 * Imported from lib/site.ts rather than mirrored. An earlier version of this
 * file copied the implementation, and the copy was correct while the shipped
 * function was a no-op that replaced every character with itself -- the tests
 * passed green against code nobody was running. Import the real thing.
 */

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

test("structured data cannot break out of its script block", () => {
  const hostile = { name: "</script><script>alert(1)</script>" };
  const output = serialiseJsonLd(hostile);

  assert.ok(!output.includes("</script>"), output);
  assert.ok(!output.includes("<"), output);
  assert.ok(!output.includes(">"), output);
  // Still valid JSON, and still the same value once parsed.
  assert.equal(JSON.parse(output).name, hostile.name);
});

test("line separators that break JavaScript parsers are escaped", () => {
  // Legal inside JSON, but they terminate a line in JavaScript, so a parser
  // reading the script block would choke on them.
  const note = "a" + LINE_SEPARATOR + "b" + PARAGRAPH_SEPARATOR + "c";
  const output = serialiseJsonLd({ note });

  assert.ok(!output.includes(LINE_SEPARATOR), "raw U+2028 survived");
  assert.ok(!output.includes(PARAGRAPH_SEPARATOR), "raw U+2029 survived");
  assert.equal(JSON.parse(output).note, note);
});

test("ampersands are escaped so the payload cannot become an entity", () => {
  const output = serialiseJsonLd({ q: "a&amp;b" });
  assert.ok(!output.includes("&"), output);
  assert.equal(JSON.parse(output).q, "a&amp;b");
});

test("ordinary content is left readable", () => {
  const output = serialiseJsonLd({ name: "Dr. Ashraf Metwally" });
  assert.equal(output, '{"name":"Dr. Ashraf Metwally"}');
});
