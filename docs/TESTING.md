# Care Point verification

Phases 4–5 test the guarantees at database, browser, accessibility and
performance levels. A green pure-function test alone is not accepted as proof
that booking works.

## Gates

1. `npm run test:unit` covers deterministic scheduling, Cairo calendar logic,
   validation, security boundaries, notification policy and PII scrubbing, plus
   the staff permission matrix, TOTP, the MFA session token and the access gate.
2. `npm run test:integration` runs inside Cloudflare's Workers runtime against
   an isolated D1 database. It applies the committed Drizzle migrations, then
   proves confirmation idempotency, notification fan-out, cancellation cell
   release, rescheduling, a twelve-request same-slot race, the Phase 6
   readiness/restriction/pause/review lifecycle, the staff directory — enrolment,
   lockout, recovery-code redemption, revocation and role changes — and the clinic
   catalogue, including seeding, refusal of an invalid rota, and closures. It also
   covers the per-client authentication throttle, session listing and revocation,
   practitioner management, the cancellation-reason lists, and password hashing,
   lockout and temporary-password handling against real rows.
3. `npm run test:e2e` boots the actual application and uses Chromium to cover
   every API route, the full patient booking flow, reschedule, cancellation,
   Clinic OS check-in/cancellation, English LTR and Arabic RTL, the complete MFA
   enrolment round trip, what each role is refused, an opening-hours change
   travelling from the staff editor to the public booking calendar, and a
   cancellation reason travelling from a click into the Insights breakdown, and the
   whole staff sign-in journey: temporary password, forced change, sign-in, and the
   dashboard resolving the signed-in person's own role.
4. `npm run test:load` sends an 80-request bilingual availability burst after a
   warmup request. Every response must succeed, local p95 must remain under two
   seconds, and the whole burst must finish under four seconds.
5. `npm run test:performance` reads the production client manifest and enforces
   raw and gzip budgets. It also proves CareLens and the Three.js engine remain
   behind two separate dynamic-import boundaries.
6. `npm run test:performance:lab` runs the production Worker as an emulated
   Pixel 5 with 4× CPU slowdown and constrained 4G. It gates LCP, CLS and the
   longest observed interaction, and proves the 3D engine is absent before the
   visitor scrolls to CareLens.
7. `npm run check:launch-content` is a production-readiness gate, not a normal
   CI test. It remains red until named clinic, clinical and legal reviewers have
   completed `content/launch-approvals.json`.

`npm run test:phase4` runs the first three gates. CI installs Chromium and runs
the same sequence on every push and pull request. Browser traces, video, and
screenshots are retained for seven days only when CI fails.

## Isolation

- Workers integration tests use an in-memory D1 database isolated by the test
  runtime. They never read or write development, staging, or production data.
- Browser tests use Wrangler's ignored local state and unique patient names.
  Bookings are cancelled at the end of successful journeys so their occupancy
  cells are released. Abandoned detail forms call the hold-release endpoint and
  the suite verifies that response, so one accessibility test cannot starve a
  later booking journey.
- Browser tests run sequentially because they deliberately share one local
  appointment book. Parallel browser workers would test the harness racing
  itself rather than the product guarantee.
- Specs own the state they touch. The staff-authentication spec creates its own
  accounts, clears any second factor a previous run left behind, and deactivates
  them on the way out; the hours spec restores the session it changed. Both give
  the same result on their second run as their first, and a developer's own local
  enrolment is never disturbed. The staff spec was twice red on a second run
  before that was true, which is the only way to find out.

## Five rules learned the hard way

**Import the real module wherever the runtime allows it.** Several `tests/*.mts`
files mirror implementations they cannot import, because those modules pull in
`cloudflare:workers`. Twice a mirror stayed green while the shipped function was
broken. Where a module *can* be imported directly it must be — `lib/csrf.ts`,
`lib/site.ts`, `lib/roles.ts`, `lib/totp.ts`, `lib/staff-crypto.ts`,
`lib/staff-session.ts` and `lib/staff-gate.ts` all are. `lib/staff-gate.ts` exists
as a separate file from `lib/auth.ts` for exactly this reason, and any `lib/`
module a node test imports must use relative `./x.ts` imports: the node runner
does not resolve the `@/` alias.

**Prefer an external oracle to a self-consistent one.** `tests/totp.test.mts`
asserts against the vectors published in RFC 6238 Appendix B and RFC 4648 §10, so
a wrong implementation cannot agree with it by construction. Where a standard is
being implemented, find its vectors before writing the test.

**A green suite is not a walked-through flow.** Adding password sign-in left two
implementations of "who is this?", so a doctor's password change was verified
against the wrong account. Every E2E test passed, because they all send the identity
header explicitly and so never took the cookie path a real browser takes. Some
defects are only visible by using the thing. Budget time for that, not just for
tests.

**Let the budget find what review misses.** The performance gate failed by 69 bytes
and led to a real defect nobody had noticed: 47KB of Clinic OS stylesheet was being
downloaded by every patient on the marketing site, because it was imported at page
level rather than by the component that uses it. A numeric gate with a tight
threshold is worth more than a generous one, precisely because it fails on the
change that introduced the problem rather than years later.

**An audit that depends on timing is not an audit.** The booking-dialog
accessibility check failed about one run in four because it sometimes scanned a
CareLens panel mid-fade and measured the transitional opacity rather than the
authored colour. It now runs with `emulateMedia({ reducedMotion: "reduce" })`, which
the site's own global rule collapses. If an assertion can race an animation, it
will — and an intermittent red teaches people to re-run rather than to look.

## Tunable load gate

The local defaults are intentionally conservative and deterministic. A staging
burst can be adjusted without changing source:

```text
LOAD_BURST_REQUESTS=200
LOAD_P95_BUDGET_MS=3000
```

The local gate is not a substitute for the Phase 6 pilot. It proves graceful
behavior under a repeatable burst; production capacity must still be measured
against the provisioned Cloudflare and D1 account.
