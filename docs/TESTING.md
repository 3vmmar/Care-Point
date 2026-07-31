# Care Point verification

Phases 4–5 test the guarantees at database, browser, accessibility and
performance levels. A green pure-function test alone is not accepted as proof
that booking works.

## Gates

1. `npm run test:unit` covers deterministic scheduling, Cairo calendar logic,
   validation, security boundaries, notification policy and PII scrubbing.
2. `npm run test:integration` runs inside Cloudflare's Workers runtime against
   an isolated D1 database. It applies the committed Drizzle migrations, then
   proves confirmation idempotency, notification fan-out, cancellation cell
   release, rescheduling, and a twelve-request same-slot race.
3. `npm run test:e2e` boots the actual application and uses Chromium to cover
   every API route, the full patient booking flow, reschedule, cancellation,
   Clinic OS check-in/cancellation, English LTR and Arabic RTL.
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
