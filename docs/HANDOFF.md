# Care Point — Session Handoff

**Written:** 2026-07-31 · **Updated:** 2026-08-01 (staff authentication; clinic
hours in D1; auth hardening; **password sign-in on the main site**).
**For:** starting a fresh session with no prior context.
**Read this first, then `docs/PRODUCTION-PLAN.md` and `docs/SECURITY-REVIEW.md`.**

> **Two corrections to the 2026-07-31 version of this file**, found by checking
> rather than trusting it:
>
> - §5 claimed `staff_users`, `staff_roles`, `departments`, `practitioners`,
>   `weekly_sessions` and friends were **missing as tables**. They were not —
>   migration `0006_busy_maddog.sql` created them. What was true is that no code
>   read or wrote a single one of them; they were empty shells. "The table does
>   not exist" and "nothing uses the table" need different fixes, and only the
>   second was needed.
> - §3 recorded `check:launch-content` as *advisory, exits 0*. It exits **1**, and
>   always has — the script has one `process.exit(1)` and no advisory mode. CI
>   stays green because nothing calls it: it is absent from `test`, `test:phase4`
>   and every other composite script. That is a different fact with a different
>   remedy.

---

## 1. What this is

A booking and clinic-operations system built for **Dr. Ashraf Metwally**, a
consultant plastic surgeon with three Cairo clinics (Maadi, Mohandessin, Fifth
Settlement). It is intended to replace/augment the practice's existing WordPress
site at `drashrafmetwally.com`.

**Two surfaces, one codebase, two Workers:**

```
Patient site  (www.drashrafmetwally.com)   →  public booking API  ┐
                                                                  ├→  D1
Doctor dashboard (clinic.drashrafmetwally.com) → private staff API ┘
```

**Stack:** Next 16 (App Router) via **vinext** on Cloudflare Workers · D1 +
Drizzle · GSAP/Lenis/Three.js on the patient side · Node test runner (unit),
vitest-pool-workers (integration), Playwright (E2E).

**Real practice data already in `lib/clinic.ts`:** phone `0100 220 2453`,
`info@drashrafmetwally.com`, and the three branch addresses, all taken from the
public website. **Google Maps links are address searches, not verified place
pins** — confirm with the clinic.

---

## 2. The current master plan (user's, supersedes my earlier one)

| Stage | Purpose |
| :--- | :--- |
| **Production foundation** | Production DB + real separation of patient and staff systems |
| **Phase 3** | Notifications |
| **Phase 4** | Automated integration, security, concurrency, browser proof |
| **Phase 5** | Quality, approved content, dentistry, dermatology, CareLens 2.0 |
| **Phase 6** | Four-week clinic pilot |
| **Phase 7** | Patient Companion, production NOOR, intelligent scheduling, clinic intelligence, check-in, secure follow-up |

Recommended order the user set:
1. Confirm production domain + Cloudflare ownership
2. Confirm the proxy trust mechanism
3. Convert schema into staging and production D1
4. Split public site and clinic dashboard into separate applications
5. **Add real staff authentication and MFA**
6. Continue Phase 3 → 7. Prove in Phase 4 → 8. Build Phase 5 → 9. Pilot → 10. Phase 7

---

## 3. Verified state — every gate run 2026-08-01

| Gate | Result |
| :--- | :--- |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run test:unit` | **PASS** — 258 tests (was 153) |
| `npm run test:integration` | **PASS** — 119 tests, real D1 (was 8) |
| `npm test` (unit + integration) | **PASS** |
| `npm run build` · `build:patient` · `build:clinic` | **PASS** |
| `npx playwright test` | **PASS** — 84/84 (was 25) |
| `npm run test:performance` | **PASS** |
| `npm run check:launch-content` | **FAILS, exits 1** — 4 approvals outstanding. Not wired into any composite script, which is the only reason CI is green. |

> **`tests/password.test.mts` was never in the runner.** Seventeen tests covering
> the password hashing, the strength rules and the temporary-password generator
> were written and committed, and `npm run test:unit` did not name the file — so
> they had never run in a gate. Adding it took the unit count from 241 to 258.
> Worth a habit: after adding a test file, check the count moved.

**Do not trust "it's done" without re-running these.** Twice in this project a
suite was green while the thing it tested was broken (see §7).

**The known CareLens flake is fixed.** `.universe-signal` failed the contrast
check about one run in four: the authored colour is 7.95:1, but a scan landing
mid-fade measured the transitional opacity at 2.58:1. The audit now runs with
motion reduced, so it measures the design rather than a frame of it — and the
label's 7px font, a real readability defect no automated check flags, is now 11px.
Verified over three consecutive runs.

---

## 4. What genuinely works

### Booking correctness — the strongest part
- **Two-phase booking**: 5-minute hold → confirm. Hold expiry releases the slot.
- **`appointment_cells`**: one row per 15-minute cell a booking covers, keyed
  `(branch, practitioner, slot_date, cell_time)` as a PRIMARY KEY, written in the
  **same D1 `batch()`** as the appointment. This is what makes overlapping
  bookings of *different lengths* impossible — exact-start uniqueness was not
  enough once durations varied.
- **Proven**: E2E fires ten parallel HTTP holds → exactly one 201, nine 409.
- Cancellation deletes cells, returning the time to the calendar.
- Idempotency on confirm.

### Scheduling
`lib/schedule.ts` — per-branch, per-weekday **sessions**, practitioners as
first-class, service-driven durations, turnaround buffers, `validateSchedule()`
that fails CI on a bad rota edit. Slot step is rounded up to clear duration +
turnaround so every offered time is independently bookable. The rules live here;
**the hours themselves come from D1** — see the catalogue section below.

### Surface separation — real, enforced in the worker
`lib/surface.ts` + `enforceSurfaceBoundary()` in `worker/index.ts`. Verified:

```
patient deployment:  /command-center 404 · /api/bookings 404 · /api/clinic/* 404
clinic deployment:   /ar 404 · / → 307 /command-center
unknown APP_SURFACE  → fails closed to patient
```

Build with `npm run build:patient` / `build:clinic` (`CAREPOINT_SURFACE`).

### Staff authentication — roles and a second factor (new, 2026-08-01)

Step 5 of the agreed order. Full reasoning in **S8** of `docs/SECURITY-REVIEW.md`;
what a new session needs to know:

- **Three layers, separately testable.** `lib/roles.ts` (who may do what, pure),
  `lib/staff-gate.ts` (the decision, pure), `lib/auth.ts` (the adapter that
  gathers headers, the D1 row and the cookie). The gate was split out of
  `lib/auth.ts` *specifically* so it could be imported by the node runner instead
  of mirrored — `lib/auth.ts` reaches `next/headers` and cannot be.
- **Five roles**: owner, doctor, receptionist, privacy_admin, auditor. Stored in
  `staff_users` / `staff_user_roles`, edited at `/command-center/security`.
  Every API declares its permission: `requireStaffPermission("patient:read")`.
- **TOTP** (`lib/totp.ts`), verified against the RFC 6238 Appendix B vectors —
  an external oracle, not a mirror. Secrets AES-GCM encrypted
  (`lib/staff-crypto.ts`); ten 78-bit recovery codes stored as digests; 5-attempt,
  15-minute lockout; codes single-use per RFC 6238 §5.2.
- **Sessions** (`lib/staff-session.ts`): HMAC-SHA256, HttpOnly, `SameSite=Strict`,
  bound to email + a `session_epoch` on the staff row + an expiry inside the
  signature. Bumping the epoch (MFA reset, deactivation) kills live sessions.
- **`STAFF_EMAILS` changed meaning.** It is now a *break-glass owner list*, not
  the allowlist. Membership grants owner with no directory row — the way back in
  when an owner is locked out of the database that is locking them out. It does
  **not** exempt anyone from MFA; the first thing such an account does is enrol,
  which creates its real, revocable row.
- **Bulk export moved to the server** (`/api/clinic/export`) so `patient:export`
  can be refused and every copy taken is written to the access log. Reception
  does not have it.
- **`security_events`** is a second audit trail: sign-ins, refusals, role changes
  — what still has answers when an attacker never reached a patient record.

Two things that will bite if you do not know them:

1. **Development bypasses all of it.** No identity headers exist locally, so the
   gate returns a synthetic owner and MFA is not enforced. `STAFF_DEV_ROLES` (e.g.
   `receptionist`) narrows it to see what a role really sees. To exercise the
   *production* path locally, send `oai-authenticated-user-email: someone@x` —
   the Worker then resolves the real directory row. That is how
   `tests/e2e/staff-auth.spec.ts` proves enforcement.
2. **Adding somebody does not reactivate them.** `invite` only updates the name
   and roles; reactivation is a separate explicit action, so an owner correcting a
   spelling cannot silently restore a former colleague's access.

**Not built:** no QR code at enrolment (the secret is typed, or handed to the app
by an `otpauth://` link — a real friction point and a deliberate deferral rather
than an oversight, because an unverifiable QR encoder that renders but does not
scan is worse than none); no passkeys; no per-IP throttle on the MFA endpoint; no
list of active sessions or "sign out everywhere".

### Staff sign in with an email and password (new, 2026-08-01)

**The dashboard is on the main website now.** `/login` is a page on the patient site;
signing in lands the doctor on `/command-center`. A discreet "Staff sign-in" link
sits last in the footer.

This reverses two earlier decisions deliberately, and both reversals are worth
understanding before changing anything here.

**Identity is no longer the platform's.** It used to arrive as an
`oai-authenticated-user-email` header, believed only because
`lib/trusted-proxy.ts` strips it unless the proxy proves itself. That made the
practice dependent on a credential it neither issued nor could rotate — and on the
platform being able to send a custom header, which was **item #1 on the
client-blocked list for weeks**. It is now moot. `AUTH_PROXY_SECRET` became
optional; the proxy path still works, still fails closed, and is selected with
`STAFF_SIGN_IN=platform`.

**The two surfaces are no longer disjoint.** The patient Worker used to 404 every
staff route. On one origin, a flaw in the marketing site sits next to the
appointment book. The split was *not deleted* — build with
`CAREPOINT_SURFACE=patient` and `/login`, `/api/staff/*`, `/command-center` and
`/api/clinic/*` all 404 again, which `tests/surface.test.mts` asserts. If the
practice ever wants the isolation back it is a deploy flag, not a rewrite.

How it works:

- **`lib/password.ts`** — PBKDF2-SHA256, 210,000 iterations, per-user salt, cost
  stored inside the hash so it can be raised later and old hashes upgrade on next
  sign-in. Not bcrypt or Argon2 because Workers expose WebCrypto and nothing else;
  shipping WASM into a Worker that must cold-start fast is a worse trade. ~110ms
  per derivation, which the test asserts a window on.
- **Sessions now record *which factors* were proved** (`password`, `totp`,
  `proxy`), inside the signature. A password alone is enough only when MFA is off
  or the account has none enrolled — otherwise the gate returns `mfa-required` and
  the existing code challenge upgrades the session.
- **One resolver for identity.** `resolveIdentity()` in `lib/auth.ts` is shared by
  every entry point. See §7 for why that matters.
- **No emailed reset**, because the practice cannot send email yet. An owner issues
  a temporary password from Security → it is shown once → the holder must replace
  it on first sign-in, and every session they held ends the moment it is issued.
- **First-run claim.** `STAFF_SETUP_TOKEN` lets an address in `STAFF_EMAILS` set
  its own password once, and only while that account has no password. Set it, use
  it, remove it.
- **The front door gives nothing away.** A wrong password, an unknown address, a
  deactivated colleague and an account with no password all return one identical
  401 — and all pay for a real key derivation, so the difference is not measurable
  with a stopwatch either. Staff addresses are on the practice website; the only
  thing left to discover is which of them are real.

**Local login for trying it out:** `dr.ashraf@drashrafmetwally.com` exists in the
dev database with role `doctor` and a password set during this work. Change it, or
issue yourself a temporary one from Security. Nothing in that database is real.

### The clinic's own timetable, in D1 (new, 2026-08-01)

The practice can now change its opening hours without a developer. `db/catalogue.ts`
holds the rota, service durations and closures; **Clinic OS → Hours** edits them.

- **What moved:** the weekly rota (`weekly_sessions`), consultation durations
  (`clinic_services`), practitioners, and closures (`schedule_exceptions`).
- **What did not:** branch names, addresses and map links. They change roughly
  never, they are already correct, and they render into statically generated
  marketing pages where a database read buys nothing.
- **The constants are still the seed and the fallback.** A never-used
  `weekly_sessions` table is populated from `lib/clinic.ts` on first read, so a
  fresh database serves a working booking page. A D1 failure degrades to the same
  constants rather than to an empty calendar.
- **`lib/schedule.ts` stays pure.** Every function takes an optional
  `ScheduleContext` and defaults to the constants, which is why all the existing
  call sites and tests kept working unchanged.
- **Every save is validated against the resulting rota** by the same
  `validateSchedule` that guards the constants in CI. A change that would put the
  surgeon in two branches at once is refused with the reason.
- **`catalogue:write`** is a new permission, held by owner and doctor. Reception
  can read the timetable — everyone needs to know when the clinic is open — but
  removing a session silently withdraws every slot inside it from the public
  booking page, which is not the busiest desk's call.

Proven end to end in the browser and in `tests/e2e/clinic-hours.spec.ts`: moving
the Maadi Sunday session from 16:00 to 17:30 took the public booking API from five
slots starting at 16:00 to three starting at 17:30, in the same process, with no
deploy.

Two things to know before touching it:

1. **The availability endpoint memoises generated days.** `Catalogue.revision`
   changes whenever the timetable does and is part of that cache key. Anything
   else that caches slot generation must include it, or an edited rota keeps
   serving the old hours until the isolate is recycled.
2. **Removing a session deactivates the row.** That is what stops the seed from
   reinstalling the defaults over a rota the clinic deliberately cleared, and it
   keeps existing bookings explicable. Appointments already in a removed session
   are untouched — the clinic honours what it promised; the slot just stops being
   offered. Check the day view and move them by hand.

### Closed since the last handoff (2026-08-01, second pass)

Everything below was listed as still-open in this file and is now built and tested.

- **Per-client MFA throttle.** The account lockout stopped five wrong codes against
  one colleague; it did nothing about one source working through the directory five
  guesses at a time, and staff addresses are not secret. `auth_throttle` adds a
  ceiling per client across all accounts: 20 failures in 15 minutes, then blocked
  for 30. Only failures count, so a busy shared reception desk is unaffected, and
  it fails *open* with no fingerprint — refusing every un-hashable request would
  lock the clinic out of its own dashboard. Verified live: attempt 5 returns
  `429 locked` for the account, attempt 20 returns `429 throttled` for the client.
- **Active sessions and sign out everywhere.** `staff_sessions` records each issued
  session with a coarse device label ("Chrome on Windows" — no version strings) and
  a digest of the token, never the token. The Security page lists them; one can be
  ended, or all of them. "All" bumps the epoch, which sits inside every signature,
  so it does not depend on any row being present. A session with no row is treated
  as live: signature, epoch and expiry were already checked, and refusing it would
  lock people out over a missing audit row.
- **More than one practitioner.** The rota always treated practitioners as
  first-class but only the two seeded people existed, so a new dentist or associate
  could not be rostered at all — the plan listed this as a serious gap. They can now
  be added, renamed and removed from Clinic OS → Hours. Removal is refused while
  they still hold sessions rather than cascading, because withdrawing every slot in
  a sitting should be a deliberate act. Renaming leaves existing bookings protected
  under the name they were taken against; only new bookings use the new one.
- **Cancellation reasons.** `cancellation_reasons` was in the plan's schema and
  absent from the database, so the clinic recorded *that* a cancellation happened
  and never why. Now asked of both sides — optionally, because a cancellation must
  never be blocked by a question — with separate lists per audience, and surfaced as
  an Attrition panel in Insights. Patients are offered "no longer going ahead";
  reception is offered "could not reach the patient". Neither can submit the other's.

### Security (see `docs/SECURITY-REVIEW.md`)
- **`lib/trusted-proxy.ts`** — the critical fix. Staff identity arrives as
  `oai-authenticated-user-email`, which **any caller can set**. Before this,
  `curl -H "oai-authenticated-user-email: dr.ashraf@clinic.eg" /api/bookings`
  returned every patient's name and phone. Identity headers are now stripped at
  the edge unless the request presents `x-carepoint-proxy-auth` matching
  `AUTH_PROXY_SECRET` (constant-time). **Fails closed in production when unset.**
- **`lib/csrf.ts`** — Origin/Sec-Fetch-Site + `application/json` required on all
  `/api/*` mutations, enforced centrally in the worker.
- Staff allowlist (`STAFF_EMAILS`), audit log of every patient-data read,
  security headers, Turnstile, PII-scrubbing error reporter.

### Bilingual
English at `/`, Arabic at `/ar`, **two root layouts** so `lang`/`dir` are correct
in server-rendered HTML. Reciprocal hreflang, two-locale sitemap, JSON-LD
(Physician + 3 MedicalClinic). All copy in `lib/i18n.ts`, `ar` typed against
`en` so a missing translation is a compile error.

### Clinic OS dashboard
Today/Week/Schedule/Insights/Requests/Notifications/Pilot. Day timeline, week
view, capacity, patient history, check-in/complete/no-show/cancel, desk bookings,
CSV export (UTF-8 BOM for Arabic), print day sheet, keyboard shortcuts.

### DSR + legal
A data request is a **queue item, never an action** — acting on a submitted phone
number would let anyone holding a patient's number pull or destroy their records.
Erasure needs explicit confirmation (428 without), refuses while an upcoming
appointment exists (409), anonymises rather than deletes, audits every row.
Bilingual privacy/terms pages, prominently marked unreviewed.

### Pilot gate (`db/pilot.ts`)
Seven gates with **three states**. `unknown` exists because the earlier
pass/fail version reported `continue` for a pilot that had taken zero bookings —
a 0% no-show rate computed from nothing. Thresholds: 10 attended, 20
notifications, 5 bookings. `stop` outranks everything.

---


### Production audit findings, 2026-08-01

A twelve-dimension audit with adversarial verification. Of ~44 claims filed at
critical or high, 11 were refuted outright and 19 were downgraded — so a quarter
of what the auditors reported did not survive contact with the files. The ones
that did:

**Fixed this pass**

- **Every font 404ed in production.** The build emitted
  `url(C:/Care Point/.vinext/fonts/…)` — absolute Windows paths — into the shipped
  CSS, 37 of them, while 553 KB of correctly-copied woff2 sat unreferenced at
  `/assets/_vinext_fonts/`. The site would have rendered entirely in fallback
  system fonts, and the failure is invisible on the machine that produced the
  build because the path resolves there. `scripts/normalise-font-urls.mjs` now
  rewrites them after every build and exits non-zero on anything it cannot map.
- **A real name and Egyptian mobile were seeded into every fresh database**,
  opt-out, from inside the schema bootstrap every request awaits. Now opt-in and
  synthetic. See `db/bookings.ts`.
- **Rescheduling was broken for every dental patient.** `ManageBooking` requested
  availability without the booked service, so the calendar was generated for the
  default 45-minute surgical consultation — dental patients were offered the
  surgeon's sessions and the server rejected every one. The same bug had already
  been fixed in the staff `AddAppointment` form and missed here.
- **The JSON-LD advertised the plastic surgeon as personally performing dental
  implants and veneers.** Wrong as data, and in a market where the Medical
  Syndicate regulates advertising, worse than wrong. Dentistry is now a separate
  `Dentist` node.
- **CSV formula injection in the data-subject export.** The server export guarded
  against a leading `=`; the client-side PDPL pack did not, so a patient-supplied
  name could execute in Excel on a clinic machine. Both now share `lib/csv.ts`.

**Confirmed and NOT fixed** — these need a decision or more time than one pass:

- **Dentistry is bookable but invisible.** Three dental services, a practitioner
  and rota sessions are live in the public booking form, and the word "dental"
  appears nowhere in patient-facing copy — no page, no nav, no Arabic prose.
  Either build the surface or gate the category out of the public form. Shipping
  a bookable line of care the site never mentions is the worst of both.
- **Dermatology does not exist.** One mention in this file, describing it as
  future work. It is not started.
- **Two colour token sets, and no tokens at all for spacing, radius, type or
  elevation** — 295 colour literals, 27 button implementations at 11 heights.
  This is the single largest source of the "doesn't feel like one product"
  impression.
- **Focus ring is 1.79:1 on the dark sidebar**, below the 3:1 non-text minimum.
- **GSAP, ScrollTrigger and Lenis are static imports** in the patient entry chunk
  — ~150 KB raw / 54 KB gzip that only runs when motion is *not* reduced.
- **Client components parse the response body before checking `response.ok`**, so
  a non-JSON edge error surfaces as a raw parse error.

---

## 5. NOT done — be precise about these

| Gap | Detail |
| :--- | :--- |
| ~~**Staff roles + MFA**~~ | ✅ **Done 2026-08-01** — see §4, including the per-client throttle and the active-session list. Remaining within it: **no passkeys** (a TOTP code can be relayed by a convincing phishing page) and **no QR at enrolment**. |
| **Schema breadth** | 24 tables exist, and all but two are now genuinely used: the staff and security tables, and the whole clinic catalogue. Still declared-but-unread shells: `practitioner_branches` and `service_practitioners` — the rota carries its bookable lines of care on the session itself, so neither join table has a consumer. Genuinely absent: `patients`, `consents`, `legal_document_versions`, `idempotency_keys`, `cancellation_reasons`, `notification_templates`, `patient_communication_preferences`. |
| ~~**Clinic config is still code**~~ | ✅ **Done 2026-08-01** — the rota, durations and closures are in D1 and editable at Clinic OS → Hours. See §4. Branch names and addresses remain constants on purpose. |
| **Notifications never sent** | Code complete (jobs, attempts, retry, manual resend, cron reminders). **No provider configured; zero real messages ever sent.** SPF/DKIM/DMARC is DNS work. |
| **Nothing deployed** | No production/staging D1, no domain, no secrets, no backup or restoration drill. Every "works" in this project means "works on localhost". |
| **Content approval** | `check:launch-content` lists `arabic-clinical-copy`, `photography`, `medical-advertising` as **pending, no reviewer**; `english-clinical-copy` missing evidence. It **exits 1**; CI is green only because no composite script runs it. Wiring it into `test:phase4` would turn CI red today, which is arguably where it belongs. |
| **NOOR** | Still ~7 regexes in `CarePointExperience.tsx`, labelled "Guided answers" in the UI. Phase 7B replaces it. |
| **Clinic hours** | The engine and the editor are real; the hours **currently in them are still invented placeholders**, seeded from `lib/clinic.ts`. They can now be replaced from the dashboard in minutes, with no deploy — which is the whole reason this was built. Getting the real timetable from the clinic is now purely a client task. |
| **Legal text** | Unreviewed by counsel (PDPL 151/2018, medical advertising rules). |

---

## 6. Blocked on the client, not on code

1. ~~**Can the platform proxy send a custom header?**~~ ✅ **No longer blocking.**
   Staff sign in with a password the clinic issues, so production auth does not
   depend on the answer. Worth knowing eventually if you want the proxy path live
   (`STAFF_SIGN_IN=platform`), but nothing waits on it.
2. Real clinic hours per branch per weekday.
3. Cloudflare account, domain, D1 provisioning.
4. WhatsApp Business account — **longest lead time in the plan**, start now.
5. Egyptian legal counsel.
6. Doctor-approved content, photography, Arabic clinical review.

---

## 7. Hard-won lessons — do not repeat these

**Mirrored tests hide no-ops.** `tests/*.test.mts` cannot import modules that
pull `cloudflare:workers`, so several mirror the implementation. Twice a mirror
was correct while the shipped function was broken — once `serialiseJsonLd`
shipped as a no-op replacing every character with itself, tests green.
**Import the real module wherever possible** (`lib/csrf.ts` and `lib/site.ts` now
are). If you must mirror, say so in the file header.

**A db module must not import `lib/auth`.** It reaches `next/headers`, which
cannot resolve in vitest-pool-workers — the integration suite silently ran
**zero tests**. Configuration is passed *into* `getPilotDashboard()` from the
route. Keep that direction.

**Verify in the browser, not just in code.** The DSR fulfil flow looked correct
and was broken: refetching the "pending" filter dropped the row and the records
with it, so staff could never download the CSV.

**Check your own regressions.** Both reds found in the 2026-07-31 audit were mine
from the preceding turn (a11y contrast at 3.99:1, and the integration break
above). The 2026-08-01 pass produced three more, all mine, all caught by gates
rather than by reading the code:

- A stylesheet imported at page level was folded into the **shared** bundle, so
  every patient visitor downloaded staff-only CSS and the performance budget went
  1KB over. Import a staff stylesheet from the client component that uses it, the
  way `PilotControl` does, and it gets its own chunk.
- Marking a deactivated colleague with `opacity: 0.55` dropped their name to
  3.5:1 and their address to 2.3:1. Never carry state with opacity on text.
- `lib/staff-gate.ts` originally imported `@/lib/roles`. The node runner does not
  resolve the `@/` alias, so the file the whole split existed to make testable
  could not be loaded. **Any `lib/` module a node test imports must use relative
  `./x.ts` imports.**
- Adding one sidebar link pushed the bottom of the dashboard's fixed-height
  sidebar past `100vh`, so a footer link rendered *below* the dark panel and onto
  the light page background at 2.75:1. **Content that overflows its own background
  takes its contrast guarantees with it** — the sidebar now scrolls, and it fits at
  720px again.
- The rota validator identified the row being edited by a key derived from its
  *shape*, then compared it to a UUID. It therefore never matched, so every edit
  collided with itself and shortening a session was impossible. Excluding a row
  needs its id, which means building the proposed state from database rows, not
  from a domain model that deliberately has none.

**A stylesheet imported at page level ships to everyone.** This caught me twice.
`security.css` first, then — found by the performance budget failing by 69 bytes —
`command-center.css`, which meant every patient visiting the marketing site
downloaded 47KB of Clinic OS styling for markup they will never see. Moving it into
the client component took the shared stylesheet from 22.1KB to **16.7KB gzip**.
Import a staff stylesheet from the component that uses it, never from the page.

**Window a metric on the event, not on the record.** The cancellation breakdown
counted appointments whose *slot date* fell in the last 30 days, which silently
excluded the cancellations that matter most: a future slot just handed back, still
worth refilling. `cancelledLast30Days` had the same flaw and was corrected with it.
No-shows and completions genuinely do belong on the appointment date — whether a
visit happened is a fact about the day it was booked for.

**One question, one answer.** Adding password sign-in left two independent
implementations of "who is this?": the gate read the session cookie, while
`requireStaffIdentity` still read only the proxy header. A doctor who had signed in
with a password then had their password change checked against whichever account
the *header* named — in development, the synthetic developer. Both now go through
one `resolveIdentity()`. Worth noting how it was found: the E2E suite passed,
because those tests sent the identity header explicitly. Only clicking through the
real flow in a browser exposed it.

**Error messages are part of the feature.** Three separate fixes this pass were
messages rather than logic: a guard that claimed to check a 15-minute boundary
while only checking `HH:mm`; a double-booking refusal that named one branch when
the clinic needs both; and the same refusal naming them in whichever order the
rows happened to arrive, so one fault read as two. If a validation message is the
only thing a receptionist has to act on, it has to be true and stable.

**A permission that separates nobody is worse than none.** Two capabilities were
drafted, found to be held by every role or by none, and deleted. `tests/roles.test.mts`
now asserts both properties, so the next one cannot ship — a control that reads as
protection while providing none is how a review reaches the wrong conclusion.

**Assert against an external oracle where one exists.** `lib/totp.ts` is checked
against RFC 6238 Appendix B and RFC 4648 §10. That is why it can be trusted in a
way the mirrored tests cannot be, and it is worth the search for published
vectors whenever a standard is being implemented.

**Make a test own its state, or it passes only once.** The staff E2E spec failed
on its second run twice, for two different reasons: it had borrowed the shared
development account, and then it had left its own accounts deactivated. It now
creates, resets and tears down everything it touches, and is verified by running
it twice in a row.

### Environment gotchas
- **vinext ignores the assigned port** — it prints its own (`3001`, `3002`…).
  Read `preview_logs` for the real one; the harness's number may be wrong.
- **Windows encoding**: run the pptx validator and some scripts with
  `PYTHONUTF8=1`. Bash heredocs with apostrophes/curly quotes fail — write files
  with the Write tool or a Python script instead.
- No LibreOffice/`pdftoppm` on this machine — pptx visual QA must be geometric
  (`python-pptx`), not a pixel render.
- `npm audit` reports 3 high CVEs in `sharp` (libvips, build-time only — the
  Worker uses the Cloudflare Images binding and `images.unoptimized: true`).

---

## 8. Key files

```
lib/clinic.ts        Branches, services, sessions, contact, retention  ← edit hours here
lib/schedule.ts      Sessions → slots → cells; validateSchedule()
lib/dates.ts         Africa/Cairo, DST-safe, lead time
lib/surface.ts       Patient/clinic deployment boundary
lib/trusted-proxy.ts Identity trust boundary  ← the critical security control
lib/csrf.ts          Cross-site request forgery guard
lib/auth.ts          The staff gate: cookie or header + D1 row → decision
                     `resolveIdentity()` is the single source of "who is this?"
lib/password.ts      PBKDF2 hashing, strength rules, temporary passwords
lib/staff-gate.ts    The decision itself, pure  ← node-testable, do not add I/O
lib/roles.ts         Roles and the permission matrix, pure
lib/totp.ts          RFC 6238 TOTP, pure  ← verified against the RFC's vectors
lib/staff-crypto.ts  AES-GCM for enrolment secrets; recovery-code digests
lib/staff-session.ts Signed MFA session cookie, pure
db/staff.ts          Staff directory, enrolment, lockout, security events
db/catalogue.ts      The clinic's rota, durations, closures, practitioners,
                     cancellation reasons  ← seed and fallback for all of them
lib/i18n.ts          Every patient-facing string, en + ar
lib/notify.ts        Notification transports (unconfigured)
lib/observability.ts Error reporting with PII scrubbing
db/bookings.ts       Appointments, cells, holds, lifecycle
db/pilot.ts          Pilot settings, metrics, go/no-go gates
db/dsr.ts            Data-subject requests; phoneKey() normalisation
db/audit.ts          Staff access log
worker/index.ts      Edge: surface boundary → identity strip → CSRF → app; cron
app/(site)/          English + staff (command-center, appointment, legal)
app/(arabic)/        Arabic
docs/                PRODUCTION-PLAN · SECURITY-REVIEW · RUNBOOK · PILOT-RUNBOOK
                     APP-SURFACES · CONTENT-APPROVAL · TESTING
```

**Env vars:** every one the code reads is documented in `.env.example`.
Required in production: `STAFF_SESSION_SECRET`, `STAFF_MFA_KEY`, `STAFF_EMAILS`,
`SITE_URL`. Needed once, then deleted: `STAFF_SETUP_TOKEN`. Optional:
`AUTH_PROXY_SECRET` (only for a proxy deployment — no longer load-bearing),
`STAFF_SIGN_IN`, `STAFF_MFA_REQUIRED` (the documented way back in if every phone
and recovery code is lost), `STAFF_DEV_ROLES` (development only).

**Tuning constants:** window 14 days · lead 4h · hold 5min · turnaround 10min ·
grid 15min · PII retention 540d · audit retention 1095d · closed Fridays ·
`Africa/Cairo`.

---

## 9. Where we stopped

Four pieces of work landed on 2026-08-01, all code-complete and verified:

1. **Staff authentication with roles and MFA** — step 5 of the agreed order. See
   §4 and S8 in `docs/SECURITY-REVIEW.md`.
2. **The clinic's timetable moved into D1**, with an editor in the dashboard, so
   the practice can change its own opening hours. See §4 and S9.
3. **A hardening pass over the gaps this file listed as open** — the per-client MFA
   throttle, active sessions and sign-out-everywhere, multi-practitioner support,
   and cancellation reasons. See §4.
4. **Email-and-password sign-in on the main website**, at the practice's request.
   This is the change with the widest consequences: it removed the longest-standing
   client blocker and gave up the surface isolation. See §4.

Every gate in §3 was re-run afterwards and is green: three builds, 241 unit tests,
119 integration tests against real D1, and 84 Playwright tests. Nine regressions of
my own were found and fixed along the way; all are recorded in §7 because the
lessons generalise. Three of those were found by tooling rather than by reading: the
performance budget caught 47KB of dashboard CSS shipping to patients, an E2E test
caught that cancellation became a two-step action, and a browser walkthrough caught
two implementations of "who is this?" that the E2E suite could not see.

Both were also walked in a real browser rather than only in tests. Enrolment:
issue secret → type the real code → receive ten recovery codes → sign in with a
recovery code → confirm the session cookie is invisible to page script. Hours:
move the Maadi Sunday session from 16:00 to 17:30 and watch the public booking API
go from five slots to three, in the same process, with no deploy.

**Pilot gate now reports:**
```
[FAIL] All readiness sign-offs        Some sign-offs are still outstanding.
[FAIL] Production configuration       Missing: no notification provider, no proxy
                                      verification secret, no staff allowlist,
                                      staff MFA not enforced.
[PASS] No unprotected appointments    Every live appointment holds its cells.
[PASS] Delivery failures ≤ 5%         1% of ~1300 attempts failed.
[  ?] No-show rate ≤ 15%              Only 0 attended; 10 needed.
[PASS] Enough bookings to judge       150+ booking(s) this week.
[PASS] No open critical incidents
recommendation: investigate           readyToStart: false
```

The infrastructure gate now also checks that staff MFA is genuinely enforced —
deliberately, so a pilot cannot take real patients while the dashboard is guarded
by an email address in a header. That is a *new* reason for the same red, not a
regression.

**Still not ready for Phase 6.** Ticking the six checklist boxes will not turn it
green: the gate holds until notifications, the proxy secret, the staff allowlist
and the MFA secrets genuinely exist. All four are deployment work, not code.

### Recommended next task

Everything left on the critical path is **blocked on the client, not on code** —
see §6, which is now one item shorter. The reds in the pilot gate are deployment
work: a notification provider, the Cloudflare account and domain, and the staff
secrets. Nothing in this repository stands between the practice and a pilot except
those, the real opening hours, and the content approvals.

**The pilot gate's `staffAllowlist` and `proxyVerification` checks are now partly
misnamed** — they predate password sign-in. Worth revisiting so the gate measures
"staff can sign in securely" rather than the specific mechanism it was written
against. Small, and honest to do before the pilot rather than after.

So the honest recommendation is to chase §6 rather than write more code. If there
is engineering time to spend while that happens, in order of value:

1. **Wire `check:launch-content` into CI.** It exits 1 today and nothing runs it,
   so the approval gate is real in name only. Adding it to `test:phase4` turns CI
   red until the four sign-offs land — which is arguably where it belongs, and is
   a one-line change plus a conversation about whether the team wants it. This is
   a decision about process, not code, which is why it has been left to you twice.
2. **A QR code at enrolment.** The one real friction point left in staff
   onboarding: the secret is currently typed, or handed to the app by an
   `otpauth://` link. Deferred deliberately rather than overlooked — an
   unverifiable QR encoder that renders but does not scan is worse than none — so
   whoever picks this up should find published test vectors before writing it.
3. **A waitlist for cancelled slots.** Now genuinely worth building, because
   cancellations finally carry a reason and a released slot is visible. Held back
   for one reason: without a notification provider it would be a queue that never
   fires, which is the same trap Phase 3 is already in. Build it *after* the
   provider exists, not before.
4. **Passkeys instead of TOTP.** Origin-bound, so it cannot be relayed by a
   phishing page. Wait until the practice is on its own domain.
5. **The NOOR decision (§7 of the plan).** Still open and still not mine to make:
   rename it, make it real, or remove it for launch. The patient copy still says
   "NOOR" in three places, so option 1 is not yet done either.

Suggested opening prompt for the new session:

> Read `docs/HANDOFF.md`. Everything on the critical path is client-blocked, so
> confirm what has come back from the clinic first, then pick from the
> recommended list in §9.

### Local dev note
The dev database contains synthetic test data from load and concurrency runs
(~128 bookings this week, several DSR records, one seeded appointment for
**Ammar Ahmed, 01501606307, 15:00 Maadi**). No real patient data. Set
`SEED_APPOINTMENT=1` to enable the seed — it is opt-**in** now. It used to be
opt-out and carried a real name and Egyptian mobile number, so any production
database with the variable unset had a phantom confirmed appointment written
into the clinic's real book. The fixture is synthetic and inert by default.

It also now holds staff rows the test suites create: `dev@localhost` plus
`e2e-mfa@`, `e2e-auditor@` and `e2e-reception@drashrafmetwally.com`, the last
three left deactivated by their own teardown. They are harmless — locally the gate
uses the synthetic development owner and never consults them — and the specs reset
whatever they need on the next run.
