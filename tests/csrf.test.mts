import assert from "node:assert/strict";
import test from "node:test";
import { checkSameOrigin, isProtectedPath } from "../lib/csrf.ts";

/**
 * Cross-site request forgery on state-changing endpoints.
 *
 * Imported from lib/csrf.ts rather than mirrored — see docs/SECURITY-REVIEW.md
 * S3 for why mirroring a security control is how a no-op ships green.
 */

const SELF = "https://clinic.example/api/clinic/data-requests";

/** A well-formed request from the site's own booking or dashboard code. */
function legitimate(overrides: Partial<Parameters<typeof checkSameOrigin>[0]> = {}) {
  return checkSameOrigin({
    method: "POST",
    url: SELF,
    origin: "https://clinic.example",
    secFetchSite: "same-origin",
    contentType: "application/json",
    ...overrides,
  });
}

test("the site's own dashboard requests pass", () => {
  const decision = legitimate();
  assert.equal(decision.ok, true);
});

test("reads are never blocked", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
    const decision = checkSameOrigin({
      method,
      url: SELF,
      origin: "https://evil.example",
      secFetchSite: "cross-site",
      contentType: null,
    });
    assert.equal(decision.ok, true, method);
  }
});

/* -------------------------------------------------------------------------- */
/* The attack this exists to stop                                             */
/* -------------------------------------------------------------------------- */

test("a hostile page cannot erase a patient using a staff member's session", () => {
  // The classic vector: an auto-submitting form on a page the staff member
  // happens to visit. No JavaScript needed on our side of the wire.
  const decision = checkSameOrigin({
    method: "POST",
    url: SELF,
    origin: "https://evil.example",
    secFetchSite: "cross-site",
    contentType: "text/plain",
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "cross-site");
});

test("an HTML form is blocked even when the browser sends no origin", () => {
  // A form can only send urlencoded, multipart or text/plain. Requiring JSON
  // means it cannot reach the handler at all, whatever headers are missing.
  for (const contentType of [
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "text/plain",
    "text/plain;charset=UTF-8",
    null,
  ]) {
    const decision = checkSameOrigin({
      method: "POST",
      url: SELF,
      origin: null,
      secFetchSite: null,
      contentType,
    });
    assert.equal(decision.ok, false, String(contentType));
    assert.equal(decision.reason, "bad-content-type");
  }
});

test("a foreign origin is rejected even with a JSON content type", () => {
  const decision = legitimate({
    origin: "https://evil.example",
    secFetchSite: null,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "foreign-origin");
});

test("a lookalike origin does not slip through on a prefix match", () => {
  for (const origin of [
    "https://clinic.example.evil.com",
    "https://evil.com/clinic.example",
    "http://clinic.example",           // wrong scheme
    "https://clinic.example:8443",     // wrong port
    "https://sub.clinic.example",
  ]) {
    const decision = legitimate({ origin, secFetchSite: null });
    assert.equal(decision.ok, false, origin);
    assert.equal(decision.reason, "foreign-origin");
  }
});

test("a subdomain an attacker controls cannot claim same-site", () => {
  // `same-site` is not good enough: it includes sibling subdomains, which is
  // exactly where an attacker who has taken one would be standing.
  const decision = legitimate({ secFetchSite: "same-site", origin: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "cross-site");
});

test("a top-level navigation cannot mutate", () => {
  // `none` means the request did not come from a page — no legitimate
  // mutation in this app is triggered that way.
  const decision = legitimate({ secFetchSite: "none", origin: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "cross-site");
});

/* -------------------------------------------------------------------------- */
/* Legitimate clients that must keep working                                  */
/* -------------------------------------------------------------------------- */

test("a non-browser client with a JSON body is allowed", () => {
  // curl and server-to-server callers send no Origin and no Sec-Fetch-Site.
  // They also carry no cookies, so there is no ambient authority to forge.
  const decision = legitimate({ origin: null, secFetchSite: null });
  assert.equal(decision.ok, true);
  assert.equal(decision.reason, "no-browser-signals");
});

test("a charset parameter on the content type is tolerated", () => {
  for (const contentType of [
    "application/json",
    "application/json; charset=utf-8",
    "application/json;charset=UTF-8",
    "APPLICATION/JSON",
    "  application/json  ",
  ]) {
    assert.equal(legitimate({ contentType }).ok, true, contentType);
  }
});

test("a malformed request URL fails closed", () => {
  const decision = legitimate({ url: "not a url" });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "foreign-origin");
});

/* -------------------------------------------------------------------------- */

test("only the API surface is guarded", () => {
  assert.ok(isProtectedPath("/api/bookings"));
  assert.ok(isProtectedPath("/api/clinic/data-requests"));
  // Pages must stay reachable by ordinary navigation.
  assert.ok(!isProtectedPath("/"));
  assert.ok(!isProtectedPath("/ar/privacy"));
  assert.ok(!isProtectedPath("/command-center"));
  assert.ok(!isProtectedPath("/apix/spoof"));
});
