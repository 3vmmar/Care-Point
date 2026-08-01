# Care Point — Path to Production

**Status:** working prototype, never run against real users, real traffic, or a
production database.
**Target:** a system a clinic depends on for its appointment book.

This document is deliberately blunt about what is missing. A booking system that
fails quietly is worse for a clinic than no booking system at all, because the
practice stops answering the phone for it.

---

## 1. Where we actually are

### Genuinely solid

- Two-phase booking with an atomic hold. The partial unique index enforces
  no-double-booking at the database, not in application code. Verified.
- Appointment lifecycle: held → confirmed → checked in → completed / no-show /
  cancelled, with cancelled slots returning to the calendar.
- Clinic OS dashboard with real write actions, timeline, week view, capacity,
  patient history, CSV/print.
- Bilingual routing with server-rendered `lang`/`dir`, hreflang, structured data.
- Treatment pages with `MedicalProcedure` + `FAQPage` schema.
- Staff allowlist that fails closed, security headers, consent versioning,
  PII retention job.
- Typecheck, lint, 59 unit tests, CI, migration-drift check.

### Honest weaknesses

| Area | Reality |
| :--- | :--- |
| **Test coverage** | 59 tests, all over **pure functions**. The D1 layer, every API route, and the booking race itself have **zero automated coverage**. The concurrency guarantee is verified by hand, once. |
| **Notifications** | The adapter is written and wired. **No provider is configured, so nothing has ever been sent.** |
| **Scheduling model** | Demo-grade. One fixed slot list per branch, identical every day. Real clinics do not work this way. |
| **Deployment** | Has never been deployed. No production D1, no domain, no secrets, no backups. |
| **Observability** | `console.error` into worker logs. No error tracking, no uptime alerting. |
| **Bot protection** | None. Automated holds can lock every slot for five minutes at a time, indefinitely. |
| **Accessibility** | Never audited. |
| **Performance** | Never measured. The CareLens chunk is ~890KB. |
| **NOOR** | Six regexes presented in the UI as an AI concierge. |
| **Content** | Slot times, opening hours and map pins are **invented placeholders**. |

---

## 2. Definition of done

"Production ready" for a medical practice means all of the following are true.
Anything less and the clinic is carrying risk it hasn't agreed to.

1. A patient booking is **never lost** — and if delivery fails, someone finds out.
2. The clinic **can always see today's list**, including when the system is
   degraded. There is a documented fallback.
3. Patient data is **lawfully collected, minimally retained, and erasable on
   request**, with an audit trail of staff access.
4. A failure **pages a human** rather than being discovered by a patient.
5. Any change can be **rolled back in minutes**.
6. The booking flow is covered by **automated tests against a real database**,
   including the concurrency case.
7. The practice's **real** hours, locations, services and content are in place.
8. Someone other than the original developer can **operate and restore it**.

---

## 3. Gaps by severity

### 🔴 Blocking — cannot launch without

| # | Gap | Why it blocks |
| :-- | :--- | :--- |
| B1 | **Real clinic schedule** | Slot times are invented. Booking patients into hours the clinic doesn't run is the single worst failure available. |
| B2 | **Working notifications** | A booking nobody is told about is a missed appointment and an angry patient. |
| B3 | **Production infrastructure** | Real D1, domain, secrets, backups, tested restore. |
| B4 | **Bot protection + edge rate limiting** | Without it, one script empties the calendar. |
| B5 | **Integration + E2E tests** | The concurrency guarantee is currently a manual observation. |
| B6 | **Error tracking + uptime alerting** | Otherwise the clinic is the monitoring system. |
| B7 | **Legal pages + lawful basis** | Privacy policy, terms, data-subject rights, bilingual. |
| B8 | **Staff access audit log** | Who opened which patient record, and when. |
| B9 | **Backup + restore, tested** | An untested backup is not a backup. |
| B10 | **Runbook + fallback** | What reception does when it's down on a Saturday. |

### 🟠 Serious — launch is materially worse without

- Accessibility audit (WCAG 2.1 AA) and fixes.
- Performance budget and Core Web Vitals measurement.
- Load test at realistic burst (an Instagram post driving concurrent traffic).
- Staging environment separate from production.
- Idempotency keys on confirm, so a double-tap on flaky mobile data can't
  double-charge the flow.
- Real content: photography, doctor-reviewed copy, clinician-reviewed Arabic.
- ~~Multi-practitioner support, if anyone other than Dr. Ashraf consults.~~
  ✅ **Done** — practitioners are managed from Clinic OS and each gets their own
  room in the occupancy grid, so two clinicians at one address never collide.

### 🟡 Should follow soon after

- NOOR decision (see §7).
- Analytics and booking-funnel instrumentation.
- Waitlist for cancelled slots. **Held until a notification provider exists** —
  otherwise it is a queue that never fires. Cancellations now carry a reason, which
  is the input a waitlist wants.
- Patient-facing appointment history.
- Before/after gallery — **subject to legal review**, see §6.

---

## 4. The plan

Phases are ordered by dependency, not by importance. Estimates are working days
of engineering and assume one developer. Elapsed time is longer because several
items wait on third parties.

### Phase 0 — Decisions and accounts (client-blocked, ~1 week elapsed, ~1 day eng)

Nothing else can start cleanly until these exist.

- Real consultation hours **per branch, per weekday**, from the clinic.
- Confirmed Google Maps pins.
- Cloudflare account, domain, DNS control.
- Email provider account and a sending domain.
- WhatsApp Business decision (see Phase 3).
- Staff email list for the allowlist.
- Legal counsel engaged for §6.
- Decision on NOOR (§7).

### Phase 1 — Foundations (~8–10 days)

- ~~Rebuild the **scheduling model**~~ ✅ **Done.** Sessions per branch per
  weekday, practitioners as a first-class concept, service-driven durations,
  turnaround buffers, and a `validateSchedule` guard that fails CI on a bad
  edit. 26 new tests. Hours themselves are still placeholders pending Phase 0.
- ~~**Remaining race**~~ ✅ **Closed.** `appointment_cells` gives each booking
  one row per fifteen-minute cell it covers, keyed by branch + practitioner +
  day + cell and written in the same D1 `batch()` as the appointment. Two
  simultaneous overlapping bookings of *different lengths* now resolve to one
  201 and one 409, verified live. Cancellation deletes the cells, returning the
  time to the calendar.
- ~~**Error tracking**~~ ✅ **Done.** `lib/observability.ts` reports to any
  Sentry-compatible DSN or an in-house webhook, and **scrubs patient names,
  phone numbers, emails and booking tokens before anything leaves the estate** —
  10 tests guard that boundary. Wired into every API route and every cron job.
  Inert and harmless until a DSN is set.
- ~~**Health endpoint**~~ ✅ **Done.** `/api/health` returns `ok` /
  `degraded` / `unhealthy` (503) for an external uptime monitor, and names which
  of the three critical config groups is missing. Catches the silent killer:
  bookings succeeding while notifications are unconfigured.
- ~~**Deploy pipeline**~~ ✅ **Written, not yet run.** `deploy.yml` gates on CI,
  auto-deploys staging, and requires a named approval for production. Production
  exports the database before every migration and keeps it 30 days. Both
  environments smoke-test `/api/health` and fail the run if it does not recover.
- ~~**Runbook**~~ ✅ **Done.** `docs/RUNBOOK.md` — triage by health status,
  rollback, restore drill, and the escalation path. Migrations are additive by
  policy so a Worker rollback is safe without a database rollback.
- ~~🔒 **Confirm the proxy trust mechanism**~~ ✅ **No longer required.** Staff sign
  in with a password the clinic issues; see the Phase 2 increment below.
- 🔒 **Provision production + staging on Cloudflare** — needs the account.
- 🔒 **Restore drill** — needs a real D1. The runbook has the procedure and a
  sign-off table; **that table being empty is a launch blocker.**
- 🔒 **Uptime alerting to a real phone** — needs a monitor pointed at
  `/api/health` and a number to ring.

**Exit:** the app is live on the real domain, with the clinic's real hours, and a
restore has actually been practised.


> **Staff sign-in increment (2026-08-01, at the practice's request):** the dashboard
> is served from the main website and staff sign in at `/login` with an email and a
> password the clinic issues.
>
> - **The longest-standing launch blocker is gone.** Phase 1 listed "confirm the
>   proxy trust mechanism" and §6 listed "can the platform proxy send a custom
>   header?" as the first thing to chase. Neither gates production any more:
>   `AUTH_PROXY_SECRET` is optional, the proxy path is opt-in via
>   `STAFF_SIGN_IN=platform`, and it still fails closed when unconfigured.
> - **PBKDF2-SHA256 at 210,000 iterations**, salted per user, cost stored inside
>   each hash so it upgrades on sign-in. See S11 in `docs/SECURITY-REVIEW.md` for
>   why not bcrypt or Argon2, and for the honest note about the cost being below
>   OWASP's current figure.
> - **MFA sits on top rather than beside.** A session records which factors it
>   proved, inside its signature, so a password alone is enough only where the
>   clinic is not requiring a second factor.
> - **No emailed reset.** An owner issues a temporary password, shown once, which
>   the holder must replace on first sign-in — a deliberate choice over a reset link
>   that would silently fail while the practice has no mail provider.
>
> **The cost, stated plainly:** the patient and clinic surfaces are no longer
> disjoint on the deployment the practice wants. A flaw in the marketing site now
> sits next to the appointment book. The isolation is not deleted —
> `CAREPOINT_SURFACE=patient` restores it and the unit suite asserts it — but it is
> not what will be running.

### Phase 2 — Trust and safety (~8–10 days)

- ~~**Turnstile on the hold endpoint**~~ ✅ **Done.** Verified against
  Cloudflare's real siteverify with their test keys: unconfigured skips,
  half-configured (site key, no secret) refuses to pretend it is enforcing, and
  a bad or missing token **fails closed**. Widget appears only once a time is
  chosen, and only when a key is configured. CSP updated for the challenge frame.
- ~~**Staff access audit log**~~ ✅ **Done.** `access_log` records actor,
  action, subject, count and a truncated client hash for every list, view,
  update, create and export. Readable by staff at `GET /api/clinic/audit` —
  and reading it is itself audited, so the trail has no blind spot. Holds no
  patient data, so it survives the PII purge without becoming a second copy.
  Own retention (3 years) on the daily cron.
- ~~**Idempotency on confirm**~~ ✅ **Done.** Fixed a real bug: a double-tap on
  a slow connection returned *"your held time expired"* moments after the
  booking had in fact succeeded, pushing patients into booking twice. The hold
  token is the idempotency key; a repeat now returns the same booking.
- 🔒 **Cloudflare WAF rate limiting by IP** — dashboard configuration, needs the
  account.
- ⏳ Session handling review under real platform auth — needs a deployed
  environment to exercise.
- ⏳ Security review of the whole surface; fix findings.
- ~~**Data-subject-request mechanism**~~ ✅ **Done.** A request is a *queue
  item, never an action*: the public endpoint records it and stops. Acting on a
  submitted phone number alone would let anyone holding a patient's number pull
  their history or destroy it — turning the privacy feature into the best
  exfiltration route in the system. Staff verify identity out of band, then
  fulfil from the dashboard. Erasure requires explicit confirmation (428),
  refuses while an upcoming appointment exists (409), anonymises rather than
  deletes, and audits every affected row. **Dashboard UI shipped**: a Requests
  view with a pending-count badge in the nav, a 30-day deadline countdown per
  request, a mandatory "how was identity verified?" note, a confirmation gate
  that keeps the erase button disabled until ticked, and the produced records
  rendered inline with CSV download.
- ~~**Privacy policy and terms**~~ ⚠️ **Scaffolded, bilingual, and explicitly
  marked as unreviewed.** The factual sections are accurate — written against
  the code, so what they claim the system collects, keeps and deletes is what it
  actually does. The *legal* framing is not, and the page says so prominently to
  the reader rather than burying it. **Still requires Egyptian counsel** on
  lawful basis, registration duty, medical-record retention and liability.
- Cookie/analytics consent if analytics is added.

**Exit:** an authorised penetration attempt finds nothing critical; legal pages live.

### Phase 3 — Notifications for real (~8–12 days eng, elapsed depends on Meta)

> **Implementation increment (2026-07-31):** notification events now enter a
> D1 transactional outbox from the same batch as each booking lifecycle change.
> Email, WhatsApp, clinic-email and webhook channels are independent jobs with
> deduplication, locks, bounded backoff, attempt history and a dead-letter state.
> Clinic OS exposes provider readiness and manual retry without storing message
> bodies or duplicate patient contact data in the outbox. Real credentials, DNS
> authentication and approved WhatsApp templates remain launch dependencies.

> **Production-foundation increment:** the database now has normalized clinic
> catalogue, rota, schedule-exception and staff-role tables, and the application
> has separate `patient` and `clinic` deployment profiles. The public Worker
> cannot serve Clinic OS pages or patient-data APIs. Provisioning both Workers
> against the same real D1 and proving the proxy header remain account-blocked.

> **Staff authentication increment (step 5 of the agreed order):** access is no
> longer a single binary check against an email allowlist.
>
> - **Roles are real and enforced per route.** Owner / Doctor / Reception /
>   Privacy admin / Read-only auditor, resolved from `staff_users` and
>   `staff_user_roles` in D1 and editable from Clinic OS under Security. Each API
>   declares the permission it needs. Reception can no longer export the register
>   or anonymise a patient; an auditor sees the controls but no patient details.
> - **Two-step sign-in.** RFC 6238 TOTP with encrypted secrets, ten recovery
>   codes, a five-attempt lockout, single-use codes, and an HttpOnly signed
>   session bound to the staff email and a revocation epoch. Enforced in
>   production by default; `STAFF_MFA_REQUIRED` overrides either way and is the
>   documented way back in if the practice loses every phone.
> - **Bulk export became a server endpoint** so `patient:export` can actually be
>   refused, and so every copy of the register taken is written to the access log.
> - **A second audit trail**, `security_events`, records sign-ins, refusals and
>   role changes — the questions that still have answers when an attacker never
>   reached a patient record.
>
> New required production secrets: `STAFF_MFA_KEY` and `STAFF_SESSION_SECRET`,
> both documented in `.env.example` alongside `AUTH_PROXY_SECRET`, which had been
> load-bearing but undocumented. The pilot readiness gate now fails while staff
> MFA is not genuinely enforced, so a pilot cannot start on header-only auth.
>
> **Still open:** no passkeys (TOTP codes can be relayed by a convincing phishing
> page), no per-IP throttle on the MFA endpoint, no list of active sessions or
> "sign out everywhere", and no QR code at enrolment — the secret is typed or
> handed straight to the app via an `otpauth://` link. See S8 in
> `docs/SECURITY-REVIEW.md`.

> **Clinic catalogue increment:** the practice can now change its own opening
> hours. The weekly rota, consultation durations and closures moved from constants
> in `lib/clinic.ts` into the D1 tables that had been created for them and never
> read, and **Clinic OS → Hours** edits all three behind a new `catalogue:write`
> permission held by the owner and the doctor.
>
> - `lib/schedule.ts` stays pure: every function takes an optional catalogue and
>   falls back to the constants, so all existing call sites and tests are unchanged.
> - The constants are now the **seed** — a never-used table is populated from them
>   on first read, so a fresh database serves a working booking page — and the
>   **fallback**, so a D1 failure degrades to the last known good timetable rather
>   than an empty calendar.
> - Every save is validated against the *resulting* rota by the same
>   `validateSchedule` that guards the constants in CI, so a change that would put
>   a practitioner in two branches at once is refused with the reason.
> - Proven end to end: moving a session from 16:00 to 17:30 in the dashboard took
>   the public booking API from five slots to three, in the same process, with no
>   deploy.
>
> **This closes the last engineering item on the critical path.** Entering the real
> hours is now a data-entry task for the clinic rather than a code change, which
> means Phase 0's oldest outstanding item no longer blocks anything in this
> repository. Branch names, addresses and map links remain constants deliberately:
> they change roughly never and are rendered into statically generated pages.

- Email: provider live, **SPF/DKIM/DMARC** configured, deliverability tested to
  Gmail/Outlook/Egyptian ISPs. Bilingual templates.
- **WhatsApp Business API** — in Egypt this is the channel patients actually use.
  Requires a Meta Business account, phone number, and **template approval**,
  which is the longest and least predictable lead time in this plan. Start it in
  Phase 0.
- SMS fallback via an Egyptian provider for patients without email.
- Delivery logging and a retry/dead-letter path, so a failed send is visible in
  the dashboard rather than silent.
- Reminder timing tuned with the clinic (24h is a default, not a decision).

**Exit:** a booking reliably reaches the patient and the clinic on two channels,
and failures surface.


> **Hardening increment (2026-08-01):** four items this plan and the handoff listed
> as outstanding are now built and tested.
>
> - **Multi-practitioner support** (§3, 🟠). The rota always treated practitioners as
>   first-class, but only two seeded people existed and nothing could create a third,
>   so an associate or a second dentist could not be rostered at all. They can now be
>   added, renamed and removed from Clinic OS → Hours. Removal is refused while they
>   hold sessions rather than cascading; renaming leaves existing bookings protected
>   under the name they were taken against.
> - **`cancellation_reasons`** (§3 schema). The clinic recorded *that* an appointment
>   was cancelled and never why. Now asked of both patient and staff — optionally, so
>   a cancellation is never blocked by a question — with a separate list per audience,
>   and shown as an Attrition panel in Insights. This is the first metric in the
>   dashboard a practice can act on directly.
> - **Per-client MFA throttle**, closing the gap S8 named: an attacker with the staff
>   list still had five guesses per colleague. See S10 in `docs/SECURITY-REVIEW.md`.
> - **Active sessions and sign out everywhere**, also from S8.
>
> Found while doing it, and fixed: 47KB of Clinic OS stylesheet was being downloaded
> by every patient on the marketing site. Moving it behind the dashboard component
> took the shared stylesheet from 22.1KB to **16.7KB gzip**. Separately, the
> cancellation metrics were windowed on the appointment date rather than the
> cancellation date, which excluded precisely the cancellations worth acting on — a
> future slot just released.
>
> **Deliberately not built:** a waitlist for cancelled slots. It is now genuinely
> worth having, but without a notification provider it would be a queue that never
> fires — the same trap Phase 3 is already in. It belongs after the provider, not
> before it.

### Phase 4 — Proving it works (~6–8 days)

> **Implementation increment (2026-07-31):** CI now applies all committed
> migrations to an isolated Workers-native D1 database, proves the booking
> lifecycle and a twelve-request database race, then boots the actual
> application for HTTP and Chromium journeys. The suite covers every API route,
> a second ten-way race, booking, reschedule, cancel, Clinic OS status actions,
> LTR/RTL, a full Cairo calendar year and an 80-request bilingual availability
> burst. A larger staging load run still depends on the real Cloudflare account.

- Integration tests against real D1 via `@cloudflare/vitest-pool-workers`,
  covering every route.
- **Concurrency test**: N parallel holds on one slot, exactly one wins.
- E2E (Playwright) for booking, reschedule, cancel, and the staff actions — in
  both languages, LTR and RTL.
- Load test at realistic burst; establish where it breaks and what it does when
  it does.
- Timezone suite across a full year including both DST transitions.

**Exit:** CI proves the guarantees rather than asserting them.

### Phase 5 — Quality and content (~8–10 days eng + client time)

> **Engineering increment (2026-07-31):** automated WCAG 2.1 AA scans now cover
> both languages, the intro, booking slots/details, appointment self-service and
> Clinic OS, with keyboard focus and reduced-motion checks. CareLens is split
> into an 8.7 KB interface and a separately viewport-gated 3D engine; CI enforces
> compressed/raw asset budgets and a constrained-mobile Core Web Vitals lab
> guardrail. Production now fails closed on the doctor-controlled approval
> manifest in `content/launch-approvals.json`. Real photography, clinic facts,
> clinical/Arabic review and real-device field data remain external inputs.

- Accessibility audit and remediation to WCAG 2.1 AA; keyboard and screen-reader
  passes on booking and dashboard.
- Performance: budget, code-split CareLens further, measure CWV on a real
  mid-range Android over Egyptian mobile data.
- Real photography and doctor-approved copy.
- Arabic reviewed by a clinician, not only by a translator.
- Verified credentials, services and hours.

### Phase 6 — Pilot (~4 weeks elapsed, low eng)

> **Engineering increment (2026-08-01):** Clinic OS now includes a durable
> Pilot Control room. It refuses to start before six operational sign-offs,
> restricts public booking to one selected branch while running, and provides
> an emergency pause that blocks new holds without touching existing
> appointments. Weekly booking, attendance and delivery metrics, a PII-free
> incident log, immutable review snapshots and an explicit go/extend/stop
> decision are stored in D1. This makes the pilot operable; it does **not**
> replace the four-week parallel run or activate one automatically.

- Run **in parallel** with the existing WordPress site. Nothing switched off.
- Start with one branch, or online-only bookings, to bound the blast radius.
- Staff training; the runbook in reception's hands.
- Weekly review of: bookings taken, no-show rate, failed deliveries, errors.
- Go/no-go on cutover against agreed numbers.

---

## 5. Two launch options

**Option A — Minimum safe launch (~Phases 0–4, ≈6–8 weeks eng, ~10 weeks elapsed)**
Online booking live alongside the current site, one branch or online-only.
Everything in 🔴 done. Accessibility, performance and content follow.
Lower cost, real feedback sooner, bounded risk.

**Option B — Full replacement (~Phases 0–6, ≈12–16 weeks eng, ~4 months elapsed)**
Care Point becomes the practice's website and appointment book.
Requires all of the above plus content, migration of existing appointments, and
an agreed support arrangement.

**Recommendation: Option A**, then decide on B with real numbers in hand. It also
matches what the pitch deck promises — run it in parallel and judge it on data.

---

## 6. What I cannot decide for you

These need someone qualified, and they are not optional.

- **Egypt's PDPL (Law 151/2018).** The code implements retention and consent
  versioning, but lawful basis, any registration obligation, breach-notification
  duties and data-subject-request handling need a local lawyer. I am not one.
- **Medical advertising rules.** The Egyptian Medical Syndicate regulates how
  medical services may be advertised. Before/after imagery, testimonials and
  outcome claims are the sensitive areas — and a plastic surgery site is exactly
  the case they exist for. Current copy avoids outcome promises deliberately, but
  it has not been reviewed by anyone qualified.
- **Clinical accuracy.** Every treatment page and every NOOR answer should be
  signed off by Dr. Ashraf. They are written to be conservative; that is not the
  same as being approved.
- **Professional indemnity / liability** for guidance given through the site.

---

## 7. The NOOR decision

Presenting a keyword matcher as an "AI concierge" is fine in a prototype and not
fine in production. Three honest options:

1. **Rename it.** Call it guided answers. Zero engineering, zero risk, loses the
   headline feature.
2. **Make it real** — Claude behind a strict, clinician-approved system prompt,
   with refusal rules for diagnosis, dosage, pricing and urgency, full
   conversation logging, and a human handoff. ~5–8 days, plus clinical review and
   ongoing per-conversation cost. This is the version worth having, and it is
   also what makes the Insights panel real.
3. **Remove it** for launch and add later.

**Recommendation: 1 now, 2 as a fast follow.** Do not launch option 2 without
clinical sign-off on the guardrails.

---

## 8. Running costs (order of magnitude — verify before quoting)

| Item | Rough monthly |
| :--- | :--- |
| Cloudflare Workers paid plan | ~$5 |
| D1 | low, usage-based at this volume |
| Domain | ~$1–2 amortised |
| Transactional email | ~$0–20 at this volume |
| WhatsApp Business API | per-conversation; depends on volume and template type |
| Error tracking | free tier likely sufficient initially |
| Uptime monitoring | free–$10 |
| Claude API (only if NOOR option 2) | usage-based |

Infrastructure is genuinely cheap at clinic scale. **The real cost is
engineering time and ongoing support**, not hosting.

---

## 9. Risks

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| WhatsApp template approval drags | Delays Phase 3 | Start in Phase 0; email-first launch |
| Clinic's real hours are complex | Phase 1 grows | Get them in Phase 0, before estimating |
| Legal review forces copy changes | Rework late | Engage counsel in Phase 0 |
| **Single-developer bus factor** | Severe | Documentation, runbook, handover; agree support terms before launch |
| No one owns it operationally | Silent decay | Name an owner at the clinic and on your side |
| Existing appointments need migrating | Cutover risk | Parallel run; never migrate and switch on the same day |

---

## 10. Immediate next actions

1. Get the clinic's **real hours per branch per weekday** — this blocks Phase 1
   and changes estimates.
2. Open the **Cloudflare and WhatsApp Business** accounts; WhatsApp is the long pole.
3. Engage **legal counsel** on PDPL and medical advertising.
4. Decide **Option A or B**, and decide **NOOR**.
5. Agree what **support** looks like after launch — hours, response time, who to call.

Only after 1–4 are answered are the estimates above worth quoting to anyone.
