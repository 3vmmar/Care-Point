# Care Point — Software Requirements Specification

**System:** Care Point — patient experience and Clinic OS for Dr. Ashraf Metwally, Consultant Plastic Surgeon (FRCS, EBOPRAS), Cairo
**Version:** 1.0 (first formal SRS)
**Baseline:** commit `0f19861`, verification state as recorded in `docs/HANDOFF.md` (2026-08-01)
**Status:** draft for review — §11 lists what needs the practice's decision

---

## 1. Purpose and how to read this document

This is the first SRS the project has had. Everything before it was a plan
(`docs/PRODUCTION-PLAN.md`) or a state report (`docs/HANDOFF.md`); neither states
*what the system is required to do* in a form you can check an implementation
against. That gap is what this document fills.

It is written **backwards from a working system**. Roughly 80% of what follows is
already built and tested, so most requirements are a specification of behaviour
that exists, recorded so it can be verified, regression-tested, and handed to
someone else. The remainder is genuinely open, and is marked as such.

Because the doctor has few specific requests, the requirements here are derived
from three sources, in this order of authority:

1. **Regulatory and clinical safety obligations** — Egypt's PDPL 151/2018, medical
   advertising rules, and the plain requirement that a booking is never lost.
2. **The built system** — the observable behaviour of the code at the baseline commit.
3. **Reasonable inference** for a single-practice aesthetic clinic, flagged `⬜` wherever
   the inference is load-bearing and should be confirmed rather than assumed.

### Status legend

| Mark | Meaning |
| :--- | :--- |
| ✅ | Implemented and covered by automated tests |
| 🟨 | Implemented, but never exercised against production infrastructure or a real provider |
| 🟥 | Not implemented |
| ⬜ | **Requires a decision from the practice** — I should not choose this |

### Scope of this document

In scope: the patient web experience, the Clinic OS command centre, the booking
engine, staff identity, notifications, and the privacy obligations attached to all
of them.

Out of scope: clinical records, diagnosis, treatment planning, prescribing, billing,
insurance, and payments. Care Point books consultations and runs the front desk. It
is **not** an EMR and must not be described as one — see NFR-REG-3.

---

## 2. Definitions

| Term | Meaning |
| :--- | :--- |
| **Surface** | An independently deployable front end. Two exist: `patient` (public) and `clinic` (private Clinic OS). |
| **Hold** | A short-lived exclusive reservation of a slot, created before the patient submits their details. |
| **Cell** | A fifteen-minute unit of a practitioner's day. The unit of occupancy, not the unit of booking. |
| **Turnaround** | Padding after a consultation, part of the service definition, occupied but not bookable. |
| **Session (rota)** | A recurring weekly sitting: one practitioner, one branch, one weekday, a time range. |
| **Session (auth)** | An issued staff login. Disambiguated as *staff session* throughout. |
| **Manage token** | An unguessable token that authorises a patient to act on their own booking without an account. |
| **Outbox** | The durable notification queue. A job is recorded before any send is attempted. |
| **DSR** | Data-subject request — PDPL access, correction, or erasure. |
| **PDPL** | Egypt's Personal Data Protection Law 151/2018. |
| **Clinic time** | Africa/Cairo. The only timezone in which clinic-facing dates are ever correct. |

---

## 3. Actors

| Actor | Authenticated | Reaches |
| :--- | :--- | :--- |
| **Patient** | No — holds a manage token for their own booking only | Public site, booking, own appointment, DSR form |
| **Receptionist** | Yes, password + TOTP | Today, week, schedule, desk/phone bookings, patient history, notes |
| **Doctor** | Yes, password + TOTP | All of the above, plus insights |
| **Owner** | Yes, password + TOTP | All of the above, plus staff administration, rota editing, pilot control |
| **Privacy admin** | Yes, password + TOTP | DSR queue, fulfilment and erasure, access log |
| **Auditor** | Yes, password + TOTP | Read-only: access log, security events. No patient write access |
| **Scheduler** | n/a — Cloudflare cron | Outbox drain, hold expiry (minutely); retention purge (03:00 clinic time) |

Roles are held in `staff_user_roles` and are additive; a person may hold several.
Every role above `patient` requires MFA — this is enforced, not advisory (FR-A-4).

⬜ **Confirm the role list matches the practice.** Five staff roles is a lot of
structure for a single-practice clinic. If reception is one or two people and the
doctor is the owner, `privacy_admin` and `auditor` may be roles nobody ever holds —
which is fine if deliberate, and misleading if not.

---

## 4. Functional requirements — patient booking

The core of the product. A lost or double-booked appointment is the worst failure
available to this system, so this section carries the strictest requirements.

| ID | Requirement | Status |
| :--- | :--- | :--- |
| FR-B-1 | Publish genuinely available slots for a branch and service, derived from the live rota, exceptions, existing bookings, and lead time. Never a fixed list. | ✅ |
| FR-B-2 | Compute availability in Africa/Cairo, correct across DST boundaries. | ✅ |
| FR-B-3 | Enforce a minimum booking lead time; refuse slots inside it. | ✅ |
| FR-B-4 | Take an exclusive hold on a slot **before** collecting patient details, expiring after 5 minutes. | ✅ |
| FR-B-5 | **Make double-booking impossible at the database.** Two concurrent requests for overlapping time on one practitioner: exactly one succeeds. | ✅ |
| FR-B-6 | Occupy every cell a consultation covers, turnaround included, so unequal durations cannot overlap. | ✅ |
| FR-B-7 | Treat one practitioner as one room; two practitioners at one branch may hold the same time. | ✅ |
| FR-B-8 | Write appointment and cells in a single transaction — a losing racer leaves nothing behind. | ✅ |
| FR-B-9 | Make confirm idempotent on the hold token; a double submit must not create two appointments. | ✅ |
| FR-B-10 | Release cells on cancellation or hold expiry, returning the slot to the calendar. | ✅ |
| FR-B-11 | Record consent with a version stamp at booking time. | ✅ |
| FR-B-12 | Issue a manage token letting the patient view, reschedule, or cancel without an account. | ✅ |
| FR-B-13 | Offer an RFC 5545 calendar invite for a confirmed visit. | ✅ |
| FR-B-14 | Accept desk and phone bookings from Clinic OS, so the day view is not just website traffic. | ✅ |
| FR-B-15 | Record a structured cancellation reason from a lookup table, not free text. | ✅ |
| FR-B-16 | Rate-limit holds per client to stop one source reserving the calendar. | 🟨 floor only — edge protection is FR-SEC-6 |
| FR-B-17 | Bot protection (Turnstile) on hold and confirm. | 🟨 code wired, **no key configured** |
| FR-B-18 | Waitlist: offer a cancelled slot to a waiting patient. | 🟥 blocked on FR-N-1 — a queue that cannot notify is not a waitlist |

**FR-B-5 is the requirement this system lives or dies on.** It is satisfied
structurally — by the composite primary key on `appointment_cells` — rather than by
application logic, and covered by integration tests against a real database. Any
change to the data layer must re-prove it. See §9.

---

## 5. Functional requirements — Clinic OS

The screen reception has open all day. Requirements here are about *operability*,
not features.

| ID | Requirement | Status |
| :--- | :--- | :--- |
| FR-C-1 | **Today**: who is in the room, who is next, the full list, and a timeline of every published slot so gaps read as clearly as bookings. | ✅ |
| FR-C-2 | One action to check in, complete, or record a no-show. | ✅ |
| FR-C-3 | **Week**: next seven open days with utilisation against real published capacity. | ✅ |
| FR-C-4 | **Schedule**: filter by branch and status, paginate, print a day sheet. | ✅ |
| FR-C-5 | Export CSV, BOM-prefixed so Excel reads Arabic names correctly. | ✅ |
| FR-C-6 | **Insights**: load, demand by consultation, attendance, measured no-show rate. | ✅ |
| FR-C-7 | Patient history on any row, matched on phone across formats. | ✅ |
| FR-C-8 | Clinic-only notes on an appointment, never visible to the patient. | ✅ |
| FR-C-9 | Live alert when a booking arrives while the screen is open. | ✅ |
| FR-C-10 | Keyboard operation for the frequent paths. | ✅ |
| FR-C-11 | Edit the rota — sessions, durations, closures — without a deploy. | ✅ |
| FR-C-12 | Manage practitioners, services and departments from the dashboard. | ✅ |
| FR-C-13 | **Pilot**: single-branch rollout, readiness sign-offs, emergency pause, weekly evidence, incidents, go/no-go. | ✅ |
| FR-C-14 | **A documented degraded-mode fallback**: what reception does when the system is down. | 🟨 written in `docs/RUNBOOK.md`, never drilled |
| FR-C-15 | Today's list must be obtainable when the system is degraded. | ⬜ see below |

⬜ **FR-C-15 needs a decision.** A cloud booking system that reception cannot read
during an outage is a clinic that cannot run its morning. The options are a printed
day sheet by a set time each evening (procedural, free, needs a habit), or an
offline-readable cached copy (engineering work). This is a practice-operations
choice, not a technical one.

---

## 6. Functional requirements — staff identity and access

| ID | Requirement | Status |
| :--- | :--- | :--- |
| FR-A-1 | Email and password sign-in, credentials issued by the clinic. PBKDF2 with per-user salt. | ✅ |
| FR-A-2 | Temporary passwords: the holder can sign in and do exactly one thing — choose a real one. | ✅ |
| FR-A-3 | TOTP second factor (RFC 6238); secret stored as AES-GCM ciphertext, never in the clear. | ✅ |
| FR-A-4 | Refuse to serve Clinic OS at all unless MFA is genuinely enforced and its secrets exist. | ✅ |
| FR-A-5 | Accept a TOTP code once — reject replay inside the same time step. | ✅ |
| FR-A-6 | Ten single-use recovery codes, stored as digests, redemption recorded not deleted. | ✅ |
| FR-A-7 | Per-account lockout after consecutive failures. | ✅ |
| FR-A-8 | Per-client throttle, so one source cannot spread guesses across the staff directory. | ✅ |
| FR-A-9 | List active staff sessions with device and last-seen; end one, or end all. | ✅ |
| FR-A-10 | Deactivation or MFA reset invalidates every session already issued. | ✅ |
| FR-A-11 | Session cookie unreadable by page script. | ✅ |
| FR-A-12 | CSRF protection on every state-changing request. | ✅ |
| FR-A-13 | Role-based authorisation; the staff gate fails closed. | ✅ |
| FR-A-14 | Log every authentication and authorisation event, including refusals. | ✅ |
| FR-A-15 | Passkeys, and a QR code at TOTP enrolment. | 🟥 a TOTP code can still be relayed by a convincing phishing page |

---

## 7. Functional requirements — notifications

| ID | Requirement | Status |
| :--- | :--- | :--- |
| FR-N-1 | **At least one working delivery channel.** | 🟥 **no provider configured; zero messages ever sent** |
| FR-N-2 | Record a durable outbox job before attempting any send. | ✅ |
| FR-N-3 | Send once — a unique dedupe key per event and channel. | ✅ |
| FR-N-4 | Retry with backoff to a bounded attempt count, then dead-letter. | ✅ |
| FR-N-5 | Keep per-attempt history: outcome, provider, status code, error. Never message bodies. | ✅ |
| FR-N-6 | Hold no recipient data in the queue; load it from the authoritative row at send time. | ✅ |
| FR-N-7 | Surface queue depth, retries and dead letters in Clinic OS, with manual resend. | ✅ |
| FR-N-8 | Send an appointment reminder once, ahead of the visit. | 🟨 queued by cron, never delivered |
| FR-N-9 | Confirmation to the patient on booking. | 🟨 same |
| FR-N-10 | Alert the clinic when delivery fails, rather than failing silently. | 🟨 visible in dashboard; no push alert |
| FR-N-11 | SPF, DKIM and DMARC on the sending domain. | 🟥 DNS work, blocked on domain |

⬜ **FR-N-1 is the single largest functional gap in the product, and it is
client-blocked.** WhatsApp Business has the longest lead time of anything in the
plan. The choice — WhatsApp, SMS, email, or a combination — determines cost per
booking, patient experience, and how much DNS work is needed. It should be started
before anything else in this document, because approval time dominates build time.

---

## 8. Functional requirements — privacy, and the bilingual public site

### 8.1 Privacy and PDPL

| ID | Requirement | Status |
| :--- | :--- | :--- |
| FR-P-1 | Accept access, correction and erasure requests from the public site. | ✅ |
| FR-P-2 | Treat a request as a **queue item, never a self-executing action** — identity must be established out of band before fulfilment. | ✅ |
| FR-P-3 | Staff fulfil or reject a request explicitly, with an audit record of who and what. | ✅ |
| FR-P-4 | Log every staff access to patient data: who, what action, which record, when. | ✅ |
| FR-P-5 | Keep the access log free of patient data, so it survives the retention purge. | ✅ |
| FR-P-6 | Purge patient contact details on a retention schedule, retaining the non-identifying appointment record. | ✅ |
| FR-P-7 | Collect the minimum needed to run a consultation, and no more. | ✅ |
| FR-P-8 | Version consent, so what a patient agreed to is recoverable. | ✅ |
| FR-P-9 | Bilingual privacy policy and terms, reviewed by Egyptian counsel. | 🟥 text exists, **unreviewed** |
| FR-P-10 | Named data controller and a working rights contact. | ⬜ |
| FR-P-11 | Retention periods stated in the policy and matching the code. | ⬜ |

⬜ **FR-P-10 and FR-P-11 need the practice.** A retention period is a business
decision with a legal floor; the code currently implements a number I did not choose
and cannot ratify. The policy and the cron must state the same number, and the
practice must be able to defend it.

### 8.2 Bilingual, SEO, accessibility

| ID | Requirement | Status |
| :--- | :--- | :--- |
| FR-I-1 | English at `/` and Arabic at `/ar`, separately indexable, with `lang` and `dir` correct in server-rendered HTML. | ✅ |
| FR-I-2 | Native RTL layout, not a mirrored LTR one. | ✅ |
| FR-I-3 | Every patient-facing string typed, so a missing translation fails the build. | ✅ |
| FR-I-4 | Reciprocal `hreflang` and a two-locale sitemap. | ✅ |
| FR-I-5 | Indexable treatment pages per language with `MedicalProcedure`, `FAQPage`, `BreadcrumbList` structured data. | ✅ |
| FR-I-6 | Arabic clinical copy reviewed by a clinician, not machine-translated. | 🟥 **pending, no reviewer assigned** |
| FR-I-7 | Respect `prefers-reduced-motion` throughout. | ✅ |
| FR-I-8 | WCAG 2.2 Level AA. | 🟨 axe in CI; never audited by a human |

### 8.3 Guided patient answers ("NOOR")

| ID | Requirement | Status |
| :--- | :--- | :--- |
| FR-NOOR-1 | Answer common patient questions from a fixed, clinician-reviewable answer set. | ✅ ~7 keyword rules |
| FR-NOOR-2 | Never present machine-generated clinical guidance as the doctor's advice. | ✅ labelled "Guided answers" |
| FR-NOOR-3 | Language-model concierge. | ⬜ **do not build without a decision** |

⬜ **FR-NOOR-3.** An LLM answering questions about surgical procedures on a
surgeon's own website carries clinical and regulatory liability that keyword
matching does not. If the practice wants it, the requirement is not "add an LLM" —
it is a reviewed answer corpus, refusal boundaries, and a logged record of what
patients were told. Do not treat this as a feature request.

---

## 9. Non-functional requirements

### Reliability and data safety

| ID | Requirement | Status |
| :--- | :--- | :--- |
| NFR-R-1 | A submitted booking is never lost; if delivery fails, someone finds out. | 🟨 durable; FR-N-1 open |
| NFR-R-2 | Any release rolls back in minutes. | 🟨 pipeline written, never executed |
| NFR-R-3 | Back up before every production migration, retained. | 🟨 in pipeline, never run |
| NFR-R-4 | **A restore drill has actually been performed.** An untested backup is not a backup. | 🟥 |
| NFR-R-5 | Migrations additive, so rolling back code does not strand the database. | ✅ by convention |
| NFR-R-6 | Failure pages a human before a patient discovers it. | 🟥 no uptime alerting, no error tracking |
| NFR-R-7 | Health endpoint distinguishing unhealthy from degraded, exposing no configuration detail publicly. | ✅ |

### Correctness and verification

| ID | Requirement | Status |
| :--- | :--- | :--- |
| NFR-V-1 | The booking race is covered by an automated test against a real database. | ✅ |
| NFR-V-2 | Every gate — typecheck, lint, unit, integration, browser, build, performance — runs in CI on every change. | ✅ |
| NFR-V-3 | The schema has **one** source of truth, and drift fails the build. | 🟨 drift check exists; **three DDL paths — see §10 D-3** |
| NFR-V-4 | Tests import the real module rather than mirroring it. | 🟨 documented hazard; some mirrors remain |

Verified at baseline: 241 unit tests, 119 integration tests against a real
database, 84 browser tests, three builds.

### Performance, security, regulatory

| ID | Requirement | Status |
| :--- | :--- | :--- |
| NFR-P-1 | Enforced performance budget for the patient surface, failing CI on regression. | ✅ |
| NFR-P-2 | Core Web Vitals measured, including on constrained mobile. | ✅ |
| NFR-P-3 | Clinic dashboard CSS and JS must never ship to patients. | ✅ enforced by budget |
| NFR-P-4 | 3D content behind a viewport gate, never competing with the hero. | ✅ |
| NFR-P-5 | Survive a realistic burst — an Instagram post driving concurrent traffic. | 🟨 load test written, not run at scale |
| NFR-SEC-1 | Security headers, including a CSP, on every response. | ✅ |
| NFR-SEC-2 | Secrets in platform secret storage, never in the repo. | ✅ |
| NFR-SEC-3 | Never log patient data; scrub before it reaches a log. | ✅ tested |
| NFR-SEC-4 | Tokens and secrets stored as digests or ciphertext, never plaintext. | ✅ |
| NFR-SEC-5 | Trusted-proxy verification for client IP attribution. | 🟨 code ready, **no secret set** |
| NFR-SEC-6 | Edge WAF and volumetric rate limiting. | 🟥 |
| NFR-REG-1 | Comply with PDPL 151/2018 as a data controller. | 🟨 mechanisms built, §8.1 gaps open |
| NFR-REG-2 | Comply with Egyptian medical advertising rules. | 🟥 **unreviewed** |
| NFR-REG-3 | Never present the system as a medical record, and carry no diagnostic content. | ✅ |
| NFR-REG-4 | Before/after imagery only after legal review and explicit patient consent. | ⬜ **do not ship without both** |

### Operability

| ID | Requirement | Status |
| :--- | :--- | :--- |
| NFR-O-1 | Someone other than the original developer can operate, deploy and restore it. | 🟨 documented, never rehearsed by another person |
| NFR-O-2 | Staging environment separate from production. | 🟨 in pipeline, does not exist |
| NFR-O-3 | Production deploys are a deliberate act by a named person. | ✅ gated environment |
| NFR-O-4 | The clinic can change its own hours, services and practitioners without engineering. | ✅ |
| NFR-O-5 | Real hours, addresses, services and content in place before patients arrive. | 🟥 **placeholders** |

---

## 10. What must be true before real patient data is stored

This is the acceptance gate. Ordered by dependency, not by effort.

| # | Gate | Blocked on |
| :-- | :--- | :--- |
| D-1 | **Architecture decided** — database engine, hosting, and whether the data layer is rewritten. | ⬜ the practice. §11 |
| D-2 | Production and staging databases provisioned, with real credentials. | D-1, Cloudflare/provider account |
| D-3 | **One source of truth for schema.** Delete runtime `CREATE TABLE`; migrations only. | D-1 |
| D-4 | Migrations applied to a real database, and a **restore proven from a backup**. | D-2 |
| D-5 | Domain, DNS, TLS. | practice |
| D-6 | Real rota, addresses and services entered. | practice |
| D-7 | One notification channel actually delivering. | provider approval |
| D-8 | Error tracking and uptime alerting live. | D-2 |
| D-9 | Turnstile key, proxy secret, staff allowlist, MFA secrets set. | D-2 |
| D-10 | Legal pages reviewed by Egyptian counsel; controller and retention named. | practice |
| D-11 | Edge WAF and rate limiting configured. | D-5 |
| D-12 | Degraded-mode fallback agreed and drilled with reception. | practice |
| D-13 | Accessibility audit by a human. | — |
| D-14 | Restore and rollback rehearsed by someone who did not build it. | D-4 |

**D-1 blocks D-2, D-3 and D-4, and D-4 is what "user data can be stored" actually
requires.** No production database exists today; the system has never been deployed.
Every "works" in this repository means "works on localhost".

---

## 11. Open architecture decisions

Recorded here rather than decided. Each changes the shape of the work that follows,
and the practice has asked to rule on architecture before anything is built.

| # | Decision | Why it cannot be defaulted |
| :-- | :--- | :--- |
| A-1 | **Database engine: stay on Cloudflare D1, or move to Postgres.** | The system is SQLite end to end: 545 raw `prepare().bind()` call sites, ~7,500 lines of data access, 119 integration tests bound to a real D1, and the no-double-booking guarantee resting on `D1.batch()` transactional semantics. Drizzle declares the schema but its query builder is never used at runtime, so there is no ORM seam to swap underneath. |
| A-2 | **Hosting.** | Postgres from Cloudflare Workers needs Hyperdrive or an HTTP-driver provider. Leaving Workers means replacing the two cron triggers that drain the outbox and expire holds, and rewriting the backup step. |
| A-3 | **Schema DDL consolidation.** | Three paths exist and they disagree; one produces weaker constraints than the schema promises. Recommended regardless of A-1. |
| A-4 | **Introduce a `patients` table.** | Patient identity is denormalised per booking and history is matched on a normalised phone string. Cheapest to fix during a migration that is already rewriting the data layer; a product decision as much as a technical one. |
| A-5 | **How much referential integrity to declare.** | Two of twenty-four relations are enforced. Adding constraints is straightforward on a database with no production rows and awkward afterwards. |
| A-6 | **Data residency.** | Relevant to PDPL. D1 replicates globally; a managed Postgres can be pinned to a region. |

See the ERD review for the evidence behind A-3 to A-5.

---

## 12. Traceability

| Requirement group | Verified by |
| :--- | :--- |
| FR-B (booking, races, holds) | `tests/integration/booking-d1.test.ts`, `tests/booking-rules.test.mts`, `tests/e2e/` |
| FR-B-2, clinic time | `tests/dates.test.mts`, `tests/schedule.test.mts` |
| FR-C (Clinic OS) | `tests/clinic.test.mts`, `tests/e2e/`, `tests/integration/analytics-d1.test.ts` |
| FR-A (identity) | `tests/totp.test.mts`, `tests/staff-session.test.mts`, `tests/staff-gate.test.mts`, `tests/password.test.mts`, `tests/roles.test.mts`, `tests/csrf.test.mts`, `tests/integration/auth-hardening-d1.test.ts` |
| FR-N (notifications) | `tests/notifications.test.mts` |
| FR-P (privacy) | `tests/dsr.test.mts`, `tests/observability.test.mts` |
| FR-I (bilingual, SEO) | `tests/i18n.test.mts`, `tests/ics.test.mts` |
| FR-C-13 (pilot) | `tests/pilot.test.mts` |
| NFR-P (performance) | `scripts/check-performance-budget.mjs`, `playwright.performance.config.ts` |
| NFR-V-3 (schema drift) | migration-drift step in `.github/workflows/ci.yml` |

Requirements with no row above are unverified by construction — every 🟥 and most
🟨 marks in this document.

---

## 13. Related documents

| Document | Role |
| :--- | :--- |
| `docs/PRODUCTION-PLAN.md` | Sequenced delivery plan and phase estimates |
| `docs/HANDOFF.md` | State report, verified gates, and hard-won implementation lessons |
| `docs/SECURITY-REVIEW.md` | Threat model and control-by-control review |
| `docs/RUNBOOK.md` | Operations, rollback, and degraded mode |
| `docs/PILOT-RUNBOOK.md` | Single-branch parallel run |
| `docs/TESTING.md` | Test strategy and how to run each gate |
| `docs/APP-SURFACES.md` | Patient and clinic surface split |
| `docs/CONTENT-APPROVAL.md` | Doctor-controlled content sign-off |
| ERD review | As-built data model and referential-integrity audit |

---

*This SRS specifies a system that is largely built and not at all deployed. Its most
important content is §10 and §11 — the gate, and the decisions the gate waits on.*
