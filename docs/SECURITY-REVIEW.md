# Security review

Reviewed: every API route, the authentication model, the data layer, the edge
worker, and the client surface. Findings are ordered by severity. Anything
marked **Fixed** has a regression test.

S1–S7 came from the Phase 2 review. **S8 — staff roles and a second factor** was
added with the production-foundation work and is the largest change to the
authentication model so far; read it alongside S1, since the two together are
what stands between the open internet and the patient register. **S9** covers the
clinic catalogue moving into the database, and the permission that now guards it.
**S10** closes the two holes S8 left open and names them as closed rather than
letting them sit in the residual list. **S11** records identity moving from the
hosting platform to a password the clinic issues, which changes how S1 should be
read and gives up the surface isolation deliberately.

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

> ⚠️ **Deployment requirement, now conditional.** This applies only to a
> deployment that puts the platform proxy in front of the app. `AUTH_PROXY_SECRET`
> must be set *and* the proxy configured to send it as `x-carepoint-proxy-auth`;
> if the platform cannot inject a custom header, that model cannot be secured by
> the application alone.
>
> **It is no longer the only way in.** See S11: staff sign in with a password the
> clinic issues, so the header path can simply be left unconfigured — in which case
> it is always stripped and cannot be spoofed into existence. This was the longest
> outstanding launch blocker and it is no longer one.

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

### S8. One credential, held by the platform, unlocked every patient record

Access was binary and single-factor. An address was on `STAFF_EMAILS` or it was
not, and everyone on it could read every patient's phone number, export the whole
register to a file, anonymise a patient's history, and read the audit log that
existed to hold them accountable. The only credential involved was a platform
password the practice did not issue and cannot rotate — so one phished
receptionist was one phished clinic.

**Fix:** three layers, deliberately separate.

**Roles** (`lib/roles.ts`). Owner / Doctor / Reception / Privacy admin /
Read-only auditor, resolved from the D1 staff directory. Every route declares the
permission it needs at the top of the handler, so authorisation is visible in a
diff rather than inferred from a path:

| Refused to | What, and why |
| :--- | :--- |
| Reception | `patient:export` — needs one number at a time, not the register. Bulk export is what turns a stolen session into a breach. |
| Reception | `dsr:fulfil` — anonymisation cannot be undone. |
| Doctor | `audit:read` — a log its subjects can read is a log they can watch for their own name. |
| Privacy admin | `patient:write` — must see a record to verify a requester, has no reason to alter one. |
| Auditor | all three patient permissions — exists to verify the controls, not to read the people. |
| Everyone but owner | `staff:write` — handing out roles is how every other permission is obtained. |

Two properties are asserted in `tests/roles.test.mts`: no permission is held by
*every* role, and none by *none*. Either would read as protection while providing
none — and both were caught that way. `schedule:read` and `clinical:write` were
drafted, found to separate nobody, and deleted.

**A second factor** (`lib/totp.ts`, `lib/staff-crypto.ts`). RFC 6238 TOTP over
WebCrypto, verified against the Appendix B vectors rather than against itself —
an external oracle, because a second factor that silently accepts the wrong code
is worse than none, since the clinic believes it has one. Secrets are AES-GCM
encrypted with a key held in the environment: a TOTP secret is a symmetric key,
so in clear text a leaked table is a permanent, silent second factor for every
account. Ten 78-bit recovery codes are stored as digests. Five wrong codes locks
the account for fifteen minutes — unthrottled, six digits is a space a script
clears in minutes — and a correct code is refused *during* the lockout, or the
limit only slows an attacker between guesses.

**Sessions** (`lib/staff-session.ts`). An HMAC-SHA256 token in an HttpOnly,
`SameSite=Strict` cookie, bound to three things so a stolen copy is useless: the
staff email, an epoch counter on the staff row, and an absolute expiry carried
*inside* the signature — a client controls its cookie jar and does not control an
HMAC. Bumping the epoch, which an MFA reset or a deactivation does, kills every
live session; a revocation that leaves sessions running is not a revocation.

Verified against the running app:

| Attempt | Result |
| :--- | :--- |
| Auditor → `GET /api/bookings`, `/api/clinic/export` | 403 `forbidden`, names the missing permission |
| Reception → `GET /api/clinic/export` | 403, `required: patient:export` |
| Reception granting itself `owner` | 403, `required: staff:write` |
| Authenticated stranger → `GET /api/bookings` | 403 `not_staff` |
| Deactivated colleague → `GET /api/bookings` | 403 `account_inactive`, immediately |
| Forged/expired/re-subjected/revoked session token | refused, each distinctly |
| Session cookie read from page script | not visible — HttpOnly confirmed in a real browser |
| Recovery code replayed | refused; single use enforced by the row, not a variable |
| Enrolment code replayed to sign in | refused (RFC 6238 §5.2) |

**Deliberately still open.** Reception can read the list, so the *screen* remains
copyable by anyone with `patient:read`; what `patient:export` buys is that the
server-side bulk export can be refused and, when it is not, is written to the
access log with who took it. And identity still ultimately rests on the platform
password — TOTP raises the cost of phishing it, and passkeys would remove it. That
is the right upgrade once the practice is on its own domain.

> **Caught in the process:** marking a deactivated colleague with `opacity: 0.55`
> dropped their name to 3.5:1 and their address to 2.3:1 — below WCAG AA, on
> exactly the row an owner reads to decide whether to restore access. State is
> now carried by a tint and a label. A control nobody can read is not a control.

---

### S9. The clinic could not change its own opening hours

Branches, services, the weekly rota and the closure calendar were constants in
`lib/clinic.ts`. Not a vulnerability on its own, but a security-relevant one: the
hours in that file were acknowledged placeholders, and a practice that needs a
developer to close for Eid will keep taking bookings for days it is shut. The
tables to hold all of it had existed since migration `0006` and were read by
nothing.

**Fix:** `db/catalogue.ts` plus a Clinic OS editor, with three properties that
matter here rather than merely functionally.

**A new permission, `catalogue:write`**, held by the owner and the doctor only.
Reception can read the timetable — everyone who works here needs to know when the
clinic is open — but removing a session silently withdraws every slot inside it
from the public booking page, and that is a different scale of action from
rebooking one patient.

**Validated before the write, against the resulting state.** The same
`validateSchedule` that guards the constants in CI runs on the rota *as it would
be after the save*, so a change putting a practitioner in two branches at once is
refused rather than discovered by two patients arriving for one slot. The editor
also runs it on load, which surfaces a row written straight into the database —
by a migration, a console, or an older version of this code — instead of waiting
for the collision.

**Audited.** A rota change alters what every patient is offered, so it is written
to `access_log` alongside changes to patient records.

**Fails safe in both directions.** An empty or unreadable catalogue degrades to
the constants rather than to a booking page that silently offers nothing; and the
seed only ever runs against a genuinely untouched table, so a rota the clinic
deliberately cleared is not quietly reinstated.

Verified against the running app:

| Attempt | Result |
| :--- | :--- |
| Owner moves a session 16:00 → 17:30 | Public API: 5 slots from 16:00 → 3 from 17:30, no deploy |
| Reception → `POST /api/clinic/catalogue` | 403, `required: catalogue:write` |
| Reception → `GET /api/clinic/catalogue` | 200, `canEdit: false` |
| Session that double-books a practitioner | 400, names **both** branches and the day |
| Time off the quarter hour / ending before it starts / no line of care | 400, each with its own reason |
| Closure added | Day removed from the calendar, reason shown in English and Arabic |
| Consultation lengthened to 90 minutes | Fewer slots offered, immediately |

> **Caught in the process:** adding one link to the dashboard sidebar pushed its
> footer past the fixed `100vh`, so the last link rendered *below* the dark panel
> and onto the light page background at 2.75:1. Content that overflows its own
> background takes its contrast guarantees with it — worth remembering, because no
> colour in the stylesheet was wrong.

---

### S10. Two holes left open by S8, now closed

Both were named in S8 rather than quietly skipped, which is the only reason they
were easy to come back to.

**Guessing could be spread across the directory.** The per-account lockout stops
five wrong codes against one colleague. It does nothing about one source working
through every address five guesses at a time — and staff addresses are not secret,
they are on the practice website. `auth_throttle` adds a ceiling per client across
all accounts: 20 failures in a 15-minute window, then blocked for 30 minutes.

Three decisions inside that are worth stating:

- **Only failures count.** Counting successes would throttle a shared reception
  desk where several people sign in across a shift.
- **It fails open with no fingerprint.** Refusing every request whose IP could not
  be hashed would lock the clinic out of its own dashboard, and the per-account
  lockout still applies. This is a ceiling, not the floor.
- **Cloudflare's WAF is still the right place for volumetric limits.** This exists
  because the account does not, and because an application-level limit is the one
  that survives a WAF misconfiguration.

Verified live against the running app: attempt 5 returns `429` with
`code: locked` for the account; attempt 20 returns `429` with `code: throttled`
and a `Retry-After` for the client.

**Sessions were invisible and could only be revoked all at once.** `staff_sessions`
now records each issued session with a coarse device label and — importantly — a
SHA-256 digest of the token rather than the token. This table is a list of who is
signed in where; had it held the tokens it would instead be a set of spare keys to
every live session, and reading it would be equivalent to holding them.

| Attempt | Result |
| :--- | :--- |
| List sessions | Device, signed-in and last-used times; no digest reaches the client |
| End one device | That session refused, others unaffected |
| End a session id belonging to another account | No match — the email is part of the predicate |
| End all devices | Epoch bumped, so every token fails its signature check |
| Present a session with no recorded row | Allowed — signature, epoch and expiry already checked |
| Present a revoked session | Refused on the next request |

The last row is the deliberate asymmetry: bulk revocation works through the epoch
and needs no lookup, while per-device revocation costs one indexed read on staff
requests. Staff traffic is a rounding error next to patient traffic, so that is the
right place to spend a query.

> **Still open after this:** no passkeys, and no QR code at enrolment. Both are
> recorded in §Residual risk rather than presented as done.

---

### S11. Identity moved from the platform to the clinic

Not a vulnerability found, but the largest change to the authentication model since
S8, and it changes how S1 should be read — so it belongs here.

Staff now sign in at `/login` with an email and a password the practice issues.
Identity no longer arrives as a proxy-injected header by default.

**Why this is a net improvement.** S1's fix depends on `AUTH_PROXY_SECRET` *and* on
the hosting platform being able to send a custom header — a question nobody had
answered, and one that would have decided whether the model was securable at all.
A credential the practice issues, stores and can rotate removes the dependency
entirely. The proxy path is unchanged, still fails closed with no secret, and is
now opt-in via `STAFF_SIGN_IN=platform`.

**Why it is also a regression, stated plainly.** The patient Worker used to be
incapable of serving a staff route. On one origin, a flaw in the marketing site is
adjacent to the appointment book. The isolation was not removed from the codebase —
`CAREPOINT_SURFACE=patient` restores it, and `tests/surface.test.mts` asserts that
`/login` and `/api/staff/*` are refused on that surface. But the deployment the
practice asked for does not use it, and that is a real reduction in blast-radius
control that they accepted knowingly.

**How the password itself is protected.**

| Concern | Decision |
| :--- | :--- |
| Algorithm | PBKDF2-SHA256, 210,000 iterations. Not bcrypt or Argon2 — Workers expose WebCrypto and nothing else, and shipping WASM into a cold-starting Worker is a worse trade than a high iteration count. |
| Cost below OWASP's 600,000 | Stated rather than hidden. It is defended in depth: per-account lockout, per-client throttle, and MFA on top. The cost lives inside each hash, and `needsRehash` upgrades it on sign-in as the budget allows. |
| Salt | 16 random bytes per user, so two staff choosing the same password are not visibly identical and no precomputed table helps. |
| Comparison | Constant-time over the derived digests. |
| Strength rules | Length and variety, not a character-class matrix. Forcing a symbol reliably produces `Password1!`; twelve characters plus rejecting the obvious is a better trade where the alternative is a sticky note. |

**What the front door discloses: nothing.**

| Attempt | Response |
| :--- | :--- |
| Wrong password | 401, one fixed message |
| Address that was never here | 401, byte-identical body |
| Deactivated colleague, correct password | 401, same |
| Account with no password set | 401, same |
| Any of the above | A real key derivation is performed, so timing does not separate them |
| Five wrong attempts | 429, account locked — the one thing worth saying, because it saves a receptionist retyping a password that has stopped working |
| Twenty failures from one client | 429, client throttled across all accounts |

Verified end to end in a browser, not only in tests: an owner issues a temporary
password, the holder is forced to replace it before anything else, and the dashboard
then identifies them by their own role rather than the developer's.

> **Caught in the process, and only by clicking through it.** Adding passwords left
> *two* implementations of "who is this?" — the gate read the session cookie while
> `requireStaffIdentity` still read only the proxy header. A doctor changing their
> password had it verified against whichever account the header named. The E2E suite
> passed throughout, because those tests send the header explicitly. There is now one
> `resolveIdentity()`, and the lesson is in `docs/HANDOFF.md` §7: a second answer to
> an authentication question is a vulnerability waiting for a caller who takes the
> other path.

**Still open.** No passkeys. No emailed password reset, because the practice cannot
send email — an owner reads out a temporary one instead, which is a deliberate
choice over a reset link that silently fails. No breached-password check against a
real corpus; the built-in list catches only the handful a rushed setup produces.

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
- **Authorisation coverage** — every route carrying patient data declares the
  permission it needs through `requireStaffPermission(...)`; public routes
  (`availability`, `data-requests`, `appointments/[token]`, `health`) are
  intentionally public and were each checked for what they return. See S8 below
  for what replaced the previous binary `getClinicStaff()` check.
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
   module can be imported directly, import it. The staff-authentication work
   followed this: `roles`, `totp`, `staff-crypto`, `staff-session` and
   `staff-gate` are all imported for real, and the gate decision was split out of
   `lib/auth.ts` specifically so it could be.
3. **WAF rate limiting** at the Cloudflare edge (dashboard, not code). Still worth
   configuring, but no longer the only defence: see S10 for the application-level
   per-client throttle that now exists whether or not the WAF is set up.
4. **Session handling under real platform auth** — the development bypass means
   that path has never been exercised against the real proxy. Must be tested on a
   deployed environment. Note that until `AUTH_PROXY_SECRET` is proven to work,
   the entire identity layer is unverified in production conditions.
5. ~~**Staff roles and a second factor.**~~ ✅ Fixed — see S8 above.
6. **Passkeys instead of TOTP.** TOTP was chosen because reception shares a
   desktop and staff use their own phones. It is still a shared secret, and a
   convincing phishing page can relay a code in real time. WebAuthn is
   origin-bound and cannot be relayed; revisit once the practice is on its own
   domain.
7. ~~**No per-account session cap.**~~ ✅ Partly addressed — see S10. Sessions are
   now listed and individually revocable, and "sign out of all devices" exists.
   There is still no hard *cap* on how many a person may hold at once, which is a
   deliberate omission: a doctor legitimately uses a phone, a desktop and a tablet,
   and a cap would silently sign one of them out.
8. **Independent penetration test** before the clinic depends on this.
