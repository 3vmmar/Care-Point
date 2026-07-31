# Care Point — Operations Runbook

For whoever is on the end of the phone when something breaks. Written to be
followed by someone who did not build this.

**First principle: the clinic's day must never depend on this system being up.**
Every procedure below assumes reception can still run the day on paper.

---

## 0. Thirty-second triage

```bash
curl -s https://<site>/api/health
```

| Response | Meaning | Do |
| :--- | :--- | :--- |
| `"status":"ok"` | Everything configured and reachable | Look elsewhere — probably a client-side or content issue |
| `"status":"degraded"` | Serving patients, but something is misconfigured | §4 — not an emergency, fix today |
| `"status":"unhealthy"` (503) | Database unreachable — **bookings are failing** | §1 immediately |
| No response / timeout | Worker or DNS down | §2 |

`degraded` names the specific gap under `configuration`, e.g.
`"notifications": false` means bookings are being taken and **nobody is being
told about them**.

---

## 1. The database is unreachable

**Patient impact:** the booking form fails. The dashboard shows a connection
error. Existing appointments are not lost.

1. **Tell reception first.** They should take bookings by phone and write them
   down. Do this before debugging — it takes ten seconds and removes the time
   pressure.
2. Check the Cloudflare dashboard → D1 → is the database present and healthy?
3. Check recent deploys. If a migration ran in the last hour, suspect it: §5.
4. Check `wrangler tail` for the real error:
   ```bash
   npx wrangler tail --env production --format pretty
   ```
5. If the database is intact but the binding is wrong, the fix is a redeploy
   with correct config, not a restore.

**Do not restore from backup to fix a connectivity problem.** Restoring loses
every booking taken since the backup. Confirm data loss before touching §6.

---

## 2. The site is down entirely

1. Is it DNS or the Worker? `curl -sI https://<site>` vs the `workers.dev` URL.
2. Cloudflare status page — check for a platform incident before assuming it is us.
3. If the last deploy correlates, **roll back** (§5). Rolling back is cheap and
   reversible; diagnosing under pressure is not.
4. If it is a platform incident, there is nothing to fix. Tell reception the
   expected duration and let them work on paper.

---

## 3. Bookings are being taken but nobody is told

The most dangerous failure, because **everything looks fine**. Patients believe
they are booked; the clinic never finds out.

1. `curl -s https://<site>/api/health` → check `configuration.notifications`.
2. If `false`, no clinic alert path is configured. Set `CLINIC_NOTIFY_EMAIL`
   with `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL`, or set `NOTIFY_WEBHOOK_URL`,
   then redeploy.
3. Open **Clinic OS → Notifications**. `Setup required` means a provider or an
   approved WhatsApp template is absent; `Needs attention` means automatic
   retries were exhausted. Use **Retry** only after correcting the provider.
4. If `true` but nothing is arriving:
   - Check the error tracker for `notification delivery failed`.
   - Email: check the provider dashboard for bounces; verify SPF/DKIM/DMARC.
   - Webhook: check the receiving automation has not been paused.
5. **Recover the missed bookings.** They are all in the database — open
   `/command-center`, filter to the affected dates, and export CSV. Nothing is
   lost, it just was not announced.

---

## 4. Degraded configuration

| Flag `false` | Consequence | Fix |
| :--- | :--- | :--- |
| `staffAllowlist` | **Nobody can open the dashboard in production** (fails closed by design) | Set `STAFF_EMAILS` |
| `notifications` | Bookings announced to no one | §3 |
| `errorReporting` | Failures are invisible | Set `SENTRY_DSN` |

---

## 5. Rolling back a deploy

Fastest path, and almost always the right first move.

```bash
# List recent versions
npx wrangler deployments list --env production

# Roll the Worker back
npx wrangler rollback --env production
```

Then re-run triage (§0).

**About migrations.** Migrations here are *additive* — new tables and new
columns, never dropping or renaming. That is deliberate: it means the previous
Worker version still runs correctly against the newer schema, so a code rollback
is safe on its own and does not require a database rollback.

If you ever need a destructive migration, it must be split across two deploys
(write both shapes → migrate → stop writing the old shape), or this guarantee is
gone.

---

## 6. Backup and restore

### What exists

- **D1 Time Travel** — Cloudflare's own point-in-time restore, covering the
  retention window on the account's plan. This is the primary mechanism.
- **Pre-deploy export** — the production deploy workflow exports the database
  before every migration and keeps it as a build artifact for 30 days.

### Restore drill — do this before launch, and then twice a year

An untested backup is not a backup. Run this against **staging**:

```bash
# 1. Note the current state
npx wrangler d1 execute care-point --env staging --remote \
  --command "SELECT COUNT(*) FROM appointments"

# 2. Look up a restore point
npx wrangler d1 time-travel info care-point --env staging

# 3. Restore
npx wrangler d1 time-travel restore care-point --env staging --timestamp <ISO>

# 4. Verify the count matches the earlier point, and that /api/health is ok
```

Record the date of the last successful drill here:

| Date | Environment | By | Result |
| :--- | :--- | :--- | :--- |
| _not yet performed_ | — | — | — |

**This table being empty is itself a launch blocker.**

### Restoring production

1. Stop the bleeding — if a bad migration is still running, roll back first (§5).
2. Establish *when* the data was last good. The pre-deploy artifact timestamp
   and the error tracker will bracket it.
3. Restore via Time Travel to just before that point.
4. **Reconcile.** Any booking taken between the restore point and now is gone
   from the database. Recover them from the notification trail — the clinic
   inbox or webhook log has a copy of every confirmation — and re-enter them
   through the dashboard's *Add appointment*.

---

## 7. Routine checks

**Daily (reception):** open `/command-center`, confirm today's list matches
expectations. A mismatch is the earliest warning of an integration problem.

**Weekly:** check the error tracker for recurring errors; check the no-show rate
on the Insights tab for a sudden jump, which usually means reminders stopped.

**Monthly:** confirm the retention purge is running (`cron: retention purge` in
the logs); review the staff allowlist against who actually still works there.

**Twice yearly:** restore drill (§6).

---

## 8. Escalation

| Situation | Who |
| :--- | :--- |
| Booking flow down > 30 min in clinic hours | Developer on call, and tell the clinic manager |
| Suspected patient-data exposure | **Stop. Do not delete anything.** Preserve logs, notify the clinic and legal counsel — Egypt's PDPL has breach-notification duties |
| Cloudflare platform incident | Nothing to do; communicate expected duration |

> **Fill these in before launch.** A runbook with no names in it is a document,
> not a plan.
>
> - Developer on call: _____
> - Clinic manager: _____
> - Legal counsel: _____
