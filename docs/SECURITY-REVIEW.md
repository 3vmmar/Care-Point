# Security review — Phase 2

Reviewed: every API route, the authentication model, the data layer, the edge
worker, and the client surface. Findings are ordered by severity. Anything
marked **Fixed** has a regression test.

---

## 🔴 CRITICAL — Fixed

### S1. Staff identity was taken from an unverified request header

**Impact:** Complete disclosure of every patient record — names, phone numbers,
email addresses, notes — to any anonymous caller on the internet. Also full
write access: cancel any appointment, erase any patient's data.

Staff authentication read `oai-authenticated-user-email` from the request. That
header is injected by the hosting platform's authenticating proxy, but the
Worker sits on the open internet, so anyone could set it themselves. No part of
the codebase verified where the request came from.

Demonstrated against the running app:

```
$ curl -H "oai-authenticated-user-email: attacker@evil.example" \
       -H "oai-authenticated-user-full-name: Mallory" \
       /api/bookings

identity the server accepted : {'name': 'Mallory', 'email': 'attacker@evil.example'}
patient records returned     : 1
sample PII                   : Cell Check / 01000000009
```

In production the attacker simply names someone on the staff allowlist:
`curl -H "oai-authenticated-user-email: dr.ashraf@clinic.eg" …`. The allowlist
added in Phase 1 does not help — it checks *which* identity, never *whether the
identity was proven*.

**Fix:** `lib/trusted-proxy.ts` establishes the trust boundary at the edge.
`worker/index.ts` strips every `oai-authenticated-user-*` header before a single
line of application code runs, unless the request presents a shared secret
(`AUTH_PROXY_SECRET`) that only the proxy knows, compared in constant time over
SHA-256 digests. Doing it at the entry point means no route can forget to check.

Failure modes are deliberate:

| Situation | Behaviour |
| :--- | :--- |
| Secret matches | Identity believed |
| Secret wrong or absent | Headers stripped, request is anonymous |
| **Production, no secret configured** | **Headers stripped — fails closed** |
| Development | Allowed, as before |

Failing closed locks staff out loudly rather than serving patient data to
strangers quietly. The worker logs a specific error naming the missing variable.

> ⚠️ **Deployment requirement.** `AUTH_PROXY_SECRET` must be set, *and* the
> platform proxy must be configured to send it as `x-carepoint-proxy-auth`. If
> the platform cannot inject a custom header, this model cannot be secured by
> the application alone — the origin must be made unreachable except through the
> proxy (Cloudflare Access, mTLS, or IP allowlisting). **Confirm which before
> launch.**

---

## 🟠 MEDIUM — Fixed

### S2. Health endpoint published which defences were switched off

`/api/health` returned the full configuration breakdown to anonymous callers —
`staffAllowlist: false`, `botProtection: false`, and so on. That is a
reconnaissance map telling an attacker exactly which protections to expect.

**Fix:** the verdict (`status`, `database`) stays public so uptime monitors work
without credentials; the per-control breakdown is now returned only to
authenticated staff.

### S3. Structured data could break out of its `<script>` block

The JSON-LD blocks embedded config via `JSON.stringify` into
`dangerouslySetInnerHTML`. `JSON.stringify` does not escape `<`, so a value
containing `</script>` would close the block early and turn the remainder into
markup. Content is developer-controlled today, but `lib/treatments.ts` is edited
by hand — this is the difference between safe and safe by accident.

**Fix:** `serialiseJsonLd()` escapes `<`, `>`, `&`, U+2028 and U+2029 by
character code. Applied to all three embed sites.

> **Worth recording:** the first version of this fix shipped a function that
> replaced every character *with itself* — a complete no-op — while its unit
> test passed green, because the test mirrored the implementation instead of
> importing it. The test now imports the real function. Any other mirrored test
> in `tests/` carries the same risk; see "Residual" below.

### S7. Cross-site request forgery on state-changing endpoints

Staff identity is injected by the proxy from a session, so a staff member
merely *visiting* a hostile page was enough for their browser to issue an
authenticated mutation — cancel an appointment, or fulfil an erasure. Nothing
in such a request looks unusual to the application.

**Fix:** `lib/csrf.ts`, applied centrally in `worker/index.ts` so a new endpoint
cannot forget to opt in. Two independent checks, both on values a page cannot
forge:

1. `Sec-Fetch-Site` must be `same-origin` when present. `same-site` is rejected
   too — it includes sibling subdomains, which is exactly where an attacker
   who has taken one would be standing.
2. `Content-Type` must be `application/json`. An HTML form can only send
   urlencoded, multipart or text/plain, so the one CSRF vector needing no
   attacker-side JavaScript cannot reach a handler at all.

Reads are never blocked, and non-browser clients (which carry no cookies, so
have no ambient authority to forge) still work. Verified against the running
app:

| Request | Result |
| :--- | :--- |
| Cross-site form POST, `text/plain` | 403 |
| Form POST, urlencoded, no origin headers | 403 |
| `PATCH` from a foreign origin | 403 |
| Sibling subdomain claiming `same-site` | 403 |
| Same-origin JSON POST | passes to handler |
| `GET` availability / health / dashboard | 200 |

Full patient journey re-verified end to end after the change: availability →
hold → confirm (201) → patient self-cancel (200), plus a staff write (200).

> **Caught in the process:** the patient cancellation call sent `DELETE` with no
> `Content-Type`, so the new rule would have 403'd every self-service
> cancellation. Fixed in `ManageBooking.tsx` before it shipped — a reminder
> that tightening a control needs the client audited alongside it.

---

## 🟡 LOW — Accepted or deferred

### S4. `sharp` transitive CVEs (high severity, build-time only)

`npm audit --omit=dev` reports 3 high-severity libvips CVEs in `sharp`, pulled in
by Next. `sharp` is a native module used during image optimisation at build
time; the deployed Worker runs neither it nor libvips, and `next.config.ts` sets
`images.unoptimized: true`. **Not exploitable in production**, but it runs in CI
against repository content. Fix available via `next@16.2.12`.
**Recommendation:** take the upgrade at the next dependency pass.

### S5. Dynamic SQL in schema bootstrap

Two statements interpolate into SQL: `ALTER TABLE … ADD COLUMN ${column}` and
`DROP INDEX IF EXISTS ${index}`. Both iterate hardcoded arrays in the source and
neither is reachable from user input. Every other statement uses bound
parameters, and `IN (…)` lists are built from `array.map(() => "?")`.
**No action.** Noted so a future edit does not make them dynamic.

### S6. Manage-token lookup is not constant time

`/api/appointments/[token]` compares tokens with a normal SQL equality. Tokens
are 122-bit random UUIDs, so a timing oracle is not a practical route to
guessing one. **No action.**

---

## ✅ Verified sound

- **SQL injection** — all runtime queries use bound parameters.
- **Authorisation coverage** — every route carrying patient data calls
  `getClinicStaff()`; public routes (`availability`, `data-requests`,
  `appointments/[token]`, `health`) are intentionally public and were each
  checked for what they return.
- **Enumeration** — the data-request endpoint returns an identical response
  whether or not records exist for the number supplied.
- **Erasure guard rails** — irreversible action requires explicit confirmation,
  refuses while an upcoming appointment exists, anonymises rather than deletes,
  and audits every affected row.
- **PII in error reports** — `lib/observability.ts` scrubs names, phones,
  emails and UUIDs before anything leaves the estate.
- **Cache headers** — every patient-data response sends `no-store, private`.
- **Security headers** — CSP, `X-Frame-Options: DENY`, nosniff, referrer
  policy, HSTS present on all responses.
- **Rate limiting** — holds, data requests and confirmations are limited per
  client fingerprint; Turnstile gates the hold and data-request endpoints.

---

## Residual risk — recommended next

1. ~~**CSRF on staff write endpoints.**~~ ✅ Fixed — see S7 above. Previously: Identity arrives as a proxy-injected
   header, so classic cookie-CSRF does not apply directly. But if the platform
   derives that header from a session cookie, a staff member visiting a hostile
   page could have `PATCH /api/bookings/:id` or `POST /api/clinic/data-requests`
   issued with their identity attached. **Recommended:** reject state-changing
   requests whose `Origin` is not the site's own, and require
   `Sec-Fetch-Site: same-origin`. Cheap, and closes the whole class.
2. **Audit the remaining mirrored tests.** `booking-rules`, `dsr` and
   `trusted-proxy` mirror logic that lives behind `cloudflare:workers` imports.
   S3 showed how a mirror can pass while the real code is broken. Where the
   module can be imported directly, import it.
3. **WAF rate limiting** at the Cloudflare edge (dashboard, not code).
4. **Session handling under real platform auth** — the dev bypass means that
   path has never been exercised. Must be tested on a deployed environment.
5. **Independent penetration test** before the clinic depends on this.
