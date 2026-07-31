# Care Point verification

Phase 4 tests the guarantees at three different levels. A green pure-function
test alone is not accepted as proof that booking works.

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

`npm run test:phase4` runs the first three gates. CI installs Chromium and runs
the same sequence on every push and pull request. Browser traces, video, and
screenshots are retained for seven days only when CI fails.

## Isolation

- Workers integration tests use an in-memory D1 database isolated by the test
  runtime. They never read or write development, staging, or production data.
- Browser tests use Wrangler's ignored local state and unique patient names.
  Bookings are cancelled at the end of successful journeys so their occupancy
  cells are released.
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
