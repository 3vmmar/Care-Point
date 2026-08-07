# ADR-001 — Move from Cloudflare D1 to Neon Postgres

**Status:** accepted, partially implemented
**Date:** 2026-08-07
**Decided by:** the practice (architecture owner). Recorded by the engineer who proposed the options.
**Supersedes:** the implicit "D1 because the scaffold came with it" decision behind commits up to `0f19861`.

---

## Context

Care Point was built end to end on Cloudflare D1 (SQLite):

- 25 tables declared in `db/schema.ts`, 14 incremental migrations.
- ~240 `prepare()` sites, 174 `bind()` calls, 32 `batch()` calls of hand-written
  SQL across nine `db/*.ts` modules — roughly 7,500 lines.
- Drizzle declared the schema and generated migrations, but **its query builder
  was never used at runtime**, so there was no ORM seam to swap an engine behind.
- 119 integration tests bound to a real D1 via `@cloudflare/vitest-pool-workers`.
- The no-double-booking guarantee resting on `D1.batch()`'s implicit transaction
  plus a composite primary key on `appointment_cells`.

Nothing had ever been deployed. There was no production database, so there was
also no data to migrate — which is what made this decision cheap to take now and
expensive to take later.

Three structural weaknesses were found while auditing the model (see the ERD
review):

1. **Three sources of truth for DDL.** `db/schema.ts` → `drizzle/`, plus runtime
   `CREATE TABLE IF NOT EXISTS` in all seven data modules, plus hand-rolled
   `ALTER TABLE ADD COLUMN` loops. They disagreed: migration `0013` created the
   hold- and manage-token indexes as `UNIQUE`, the runtime path created them
   non-unique, and `IF NOT EXISTS` meant whichever ran first won.
2. **Two of twenty-four relations were enforced.** The rest lived in application
   code — including the rota's branch reference, whose absence let a deleted
   branch keep publishing bookable slots.
3. **Stringly-typed throughout.** Every timestamp `TEXT`, every boolean
   `INTEGER`, every enumeration a doc comment. Unavoidable in SQLite.

## Decision

Move to **Neon Postgres, staying on Cloudflare Workers**, via a
D1-shaped adapter, with a deliberate partial modernisation of the types.

Seven decisions were taken together:

| # | Decision | Chosen |
| :-- | :--- | :--- |
| 1 | Engine and runtime | **Postgres, remain on Cloudflare Workers** |
| 2 | Provider and driver | **Neon + `@neondatabase/serverless`** (HTTP), region nearest Cairo |
| 3 | Data-access strategy | **D1-compatible adapter shim** — `db/client.ts` |
| 4 | Type modernisation scope | **Instants vs wall-clock split** (below) |
| 5 | DDL sources | **Migrations only.** Runtime bootstraps deleted |
| 6 | Referential integrity | **Enforce every safe relation**, document each exemption |
| 7 | `patients` table | **Deferred** until after go-live |

### On the driver (2)

Neon's HTTP driver was chosen over Hyperdrive because `sql.transaction([...])` is
a non-interactive, all-or-nothing transaction over a single round trip — an
almost exact match for `D1.batch()`. The booking path never needed interactive
transactions, because D1 could not offer them, so nothing is given up. It also
avoids requiring a paid Workers plan to start.

### On the adapter (3)

`db/client.ts` presents `prepare().bind().run()/.all()/.first()` and `batch()`
over Neon, so the call sites and the tests holding them to account survive the
engine change. It is a **protocol shim, not a SQL translator** — SQLite dialect
is ported explicitly per query, because silently rewriting SQL would hide real
dialect bugs behind a layer nobody reads.

Three driver type parsers are load-bearing:

| Postgres type | Returned as | Why |
| :--- | :--- | :--- |
| `timestamptz` | ISO-8601 string | Call sites read every value as a string |
| `date` | `YYYY-MM-DD` string | The default parser yields UTC midnight, which turns a Cairo appointment into the previous evening |
| `time` | `HH:mm` | The codebase speaks `HH:mm`, not `17:30:00` |
| `bigint` / `numeric` | `number` | `COUNT(*)` is `bigint`, returned as a *string*; `"12" + 1` is `"121"` |

### On the type split (4)

Two kinds of time exist in this schema and they are now different:

- **Instants** — `created_at`, `confirmed_at`, `expires_at`, `next_attempt_at` —
  are `timestamptz`. The timezone question never arises again.
- **Clinic wall-clock** — `slot_date`, `slot_time`, session start and end — are
  `date` and `time`. A slot is "17:30 at Maadi", not an instant; forcing it into
  `timestamptz` would silently shift the clinic's day across a DST boundary.

Booleans became `boolean`. Enumerations became `text` with a `CHECK`, not a
native `pgEnum`, so adding a value is one migration rather than a type rewrite.
Only value sets with an explicit TypeScript union or `VALID_*` array as their
authority were constrained; `security_events.event` and
`notification_attempts.outcome` are deliberately open.

`lib/dates.ts` and the availability engine were **not** rewritten. That was the
point of the split.

### On integrity (6)

Twenty foreign keys, up from two. Enforced: the catalogue and rota, the staff
tables, the cancellation-reason lookup, and `appointments.practitioner`.

Four exemptions, each deliberate:

| Relation | Why it stays unenforced |
| :--- | :--- |
| `access_log.subject_id` → `appointments.id` | Must answer "was this record accessed?" *after* the retention purge. A cascade would delete the evidence along with the data it was evidence about. |
| `notification_jobs.subject_id` | Polymorphic on `subject_type`; a foreign key is impossible. The discriminator is constrained instead. |
| `access_log.actor`, `security_events.actor` | `"anonymous"` and `"patient"` are valid actors. The actor of a refused sign-in may not exist. |
| `appointments.branch`, `.service` | Booking snapshots: the record must keep saying what was booked even if the catalogue is reorganised. The forward risk — publishing slots at a closed address — is closed on `weekly_sessions`, where it actually lives. |

`appointment_cells.branch` and `.practitioner` are also unconstrained: they are a
projection of the already-constrained parent, and this is the hottest write path
in the system.

## Consequences

### Gained

- The uniqueness of the hold and manage tokens is now genuinely enforced, on
  every database, because there is no second DDL path left to weaken it.
- `batch()` runs at an explicit `Serializable` isolation level. This is the one
  place the migration *strengthens* a guarantee rather than preserving it.
- A deleted branch can no longer leave a rota publishing bookable slots.
- An invalid status is a write error rather than a value that reaches the
  dashboard.
- Regional control over where patient data physically sits, which matters under
  PDPL in a way D1's global replication did not address.

### Lost, or newly owed

- **Latency.** D1 sat next to the Worker. Postgres does not: every query is a
  round trip to one region, and Cairo has no nearby Postgres region on the major
  providers. The performance budget in CI is enforced (`NFR-P-1`), so the
  availability endpoint — which issues several queries per request — must be
  re-measured, and may need consolidating into fewer round trips.
- **The 14 D1 migrations are archived**, not ported, under
  `docs/archive/drizzle-d1-sqlite/`. With no production data anywhere, one
  squashed baseline was cleaner than translating an incremental history that had
  never been applied.
- **The integration suite's foundation changes.** `@cloudflare/vitest-pool-workers`
  supplied a real D1 and `applyD1Migrations`; neither has a Postgres equivalent.
  Those 119 tests need a real Postgres — a Neon branch per run, or a local
  instance — and this is the largest remaining risk in the migration, because
  they are what proves the booking race.
- **The deploy pipeline's database steps are now wrong.** `wrangler d1 migrations
  apply` and `wrangler d1 export` must become a Drizzle migrate step and
  `pg_dump`. The pre-deploy backup is a launch gate (`NFR-R-3`), so this is not
  optional.
- `DATABASE_URL` is a secret, not a var, and must be set per environment. The
  former `DB` binding is gone from `Cloudflare.Env`.

## Status of implementation

### Done, and verified without a database

- `db/schema.ts` rewritten to `drizzle-orm/pg-core` — 25 tables, **20 foreign
  keys** (from 2), **33 `CHECK` constraints**, the instants/wall-clock split.
- `drizzle.config.ts` → `postgresql`. D1 migrations archived; Postgres baseline
  generated as `drizzle/0000_public_grey_gargoyle.sql`.
- `db/client.ts` — the adapter: type parsers, `?` → `$n` rewriting that respects
  quoting and comments, and `batch()` as a serializable transaction.
- **All seven runtime DDL bootstraps deleted** along with 98 `ensure*Schema()`
  call sites and the helpers they orphaned (`backfillCells`, `seedAppointments`,
  `addMissingColumns`, `firstFreeSeedSlot`, `cellInserts`) — about 700 lines.
  `db/schema.ts` is now the only DDL in the repository.
- The nine module-local `database()` helpers replaced by the shared handle.
- SQLite dialect ported: 9 `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`,
  `strftime`/`julianday`/`substr` date arithmetic → `EXTRACT`/`to_char`/date
  subtraction, and every integer-as-boolean comparison and binding.
- `worker/index.ts`, `vite.config.ts`, `.openai/hosting.json`,
  `cloudflare-env.d.ts` — D1 binding removed, `DATABASE_URL` in its place.
- Integration suite repointed at a real Postgres; `vitest.config.ts` and
  `tests/integration/setup.ts` rewritten, with truncation derived from
  `information_schema` rather than a hand-kept table list.
- CI and deploy workflows: `drizzle-kit migrate` replaces
  `wrangler d1 migrations apply`; `pg_dump` replaces `wrangler d1 export`.
- README rewritten for Postgres.

Green: `typecheck`, `lint`, 311 unit tests, design tokens, and the
migration-drift gate (`db:generate` reports no changes).

### Three dialect traps worth recording

These did not error — they would have silently returned wrong answers, which is
why they are called out rather than buried in the diff.

1. **`substr(phone, -9)`.** SQLite reads a negative start as "the last N
   characters"; Postgres reads it as a position before the string and returns the
   whole thing. This is the patient-identity key. Left alone it would have
   quietly stopped joining `01501606307` to `+20 150 160 6307` — the one
   behaviour patient history depends on. Now `RIGHT(…, 9)`.
2. **183 `AS camelCase` aliases.** Postgres folds unquoted identifiers to
   lowercase, so every one would have come back as `slotdate` and read as
   `undefined` in TypeScript. All now quoted — and the CTE aliases that are
   referenced later were deliberately left *unquoted*, so definition and
   reference fold alike.
3. **`CASE WHEN ?` bound to `1`/`0`.** SQLite treats `1` as truthy; Postgres
   requires a boolean and raises a type error. Five sites in the
   appointment-status update, now bound as real booleans.

### Not done — needs a live database

1. **The 119 integration tests have not been run.** They are the only thing that
   proves the booking race, and they need a real Postgres. This is the largest
   remaining risk in the migration, and it is unresolved.
2. Latency has not been measured, so the CI performance budget (`NFR-P-1`)
   against a Frankfurt round trip is unverified.
3. No migration has been applied to any database; no restore has been proven.

Blocked on the practice, not on code: a Neon project, a Cloudflare account, and
`DATABASE_URL` for CI, staging and production. Until those exist there is still
no database, and `docs/SRS.md` §10 gate D-4 cannot be met.

## Alternatives rejected

| Option | Why not |
| :--- | :--- |
| **Stay on D1** | Recommended by the engineer: zero rewrite, and the real blocker to storing patient data was provisioning, not database code. The practice chose Postgres for the type system, enforceable integrity and regional control, and accepted the rewrite cost. Recorded because it remains the cheapest reversal if latency proves unacceptable. |
| **Postgres, move off Workers** | Would additionally require replacing the two cron triggers that drain the notification outbox and expire holds, rewriting `worker/index.ts`, and rebuilding the vinext/Cloudflare build pipeline. Larger change, no benefit the clinic needs. |
| **Rewrite onto Drizzle's query builder** | The best end state — type-safe, drift caught at compile time — but it rewrites the concurrency-critical booking path, so every safety guarantee would have to be re-proven as a side effect of an infrastructure change. Worth revisiting per-module once Postgres is live. |
| **Native `pgEnum` instead of `CHECK`** | Adding a value to a Postgres enum is fine; removing or reordering one is painful. `CHECK` keeps vocabulary changes to ordinary migrations. |
| **Full type modernisation now** | Would rewrite `lib/dates.ts` and the availability engine — the most intricate correctness logic in the system outside the booking race — as part of an infrastructure change. Deferred deliberately. |
