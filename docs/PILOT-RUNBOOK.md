# Care Point pilot runbook

The Pilot Control screen prepares and measures Phase 6. Its presence does not
mean a real pilot has started. The clinic remains on the existing WordPress and
telephone workflow until the practice owner explicitly starts the parallel run.


## Go/no-go gates

Seven gates are evaluated continuously. Each returns one of three states, and
the third is the important one.

| Gate | Fails when | Unknown when |
| :--- | :--- | :--- |
| All readiness sign-offs | any sign-off outstanding | — |
| Production configuration in place | notifications, proxy secret or staff allowlist unconfigured | — |
| No unprotected appointments | a live appointment holds no occupancy cells | — |
| Delivery failures at or below 5% | rate above 5% | fewer than 20 messages attempted |
| No-show rate at or below 15% | rate above 15% | fewer than 10 appointments attended |
| Enough bookings to judge | — | fewer than 5 bookings in the week |
| No open critical incidents | any critical incident open | — |

### Why `unknown` exists

An earlier version of this gate only returned pass or fail. A pilot that had
taken **no bookings at all** therefore computed a 0% no-show rate and a 0%
delivery-failure rate, passed both gates, and recommended `continue`. An empty
pilot looked exactly like a successful one — the most dangerous output the
system could produce, because it would have been used to justify going live.

A rate computed from nothing is not evidence of safety. Gates below their
evidence threshold now report `unknown`, and the overall recommendation becomes
`insufficient-data` rather than `continue`.

Note the asymmetry: **integrity is never `unknown`**. Zero live appointments
genuinely means zero unprotected ones — that is measured, not merely absent.

### Recommendations

| Recommendation | Meaning |
| :--- | :--- |
| `stop` | A critical incident is open, or the appointment book has lost integrity. Halt the pilot. |
| `investigate` | A gate failed on real evidence. Resolve before continuing. |
| `insufficient-data` | Nothing has failed, but the week does not yet carry enough signal to judge. Keep running. |
| `continue` | Every gate passed on sufficient evidence. |

`stop` outranks everything: an empty pilot that has also broken integrity is
still a stop, never softened into "not enough data yet".

## Before selecting Running

1. Choose exactly one branch and a start and review date.
2. Complete each readiness sign-off only when evidence exists. A sign-off is an
   operational attestation, not a reminder checkbox.
3. Make a real end-to-end test booking and prove that the patient and reception
   received notifications through two independent paths.
4. Put the fallback day sheet and `docs/RUNBOOK.md` at reception.
5. Confirm that the existing website and telephone booking process stay live.

The API refuses to enter `running` while any readiness sign-off is incomplete.
While running, public availability and new holds are restricted to the selected
branch. Existing appointments at every branch remain visible and manageable.

## Status meanings

| Status | Public booking behaviour | Use |
| :--- | :--- | :--- |
| Setup | Normal demo behaviour | Configure dates and collect evidence. |
| Running in parallel | New online bookings restricted to one pilot branch | The four-week bounded pilot. |
| Emergency pause | New public holds blocked; existing bookings preserved | Delivery, schedule or operational incident. |
| Complete | Pilot restriction removed | Only after recording the final decision. |

## Daily operation

- Reception compares Clinic OS with the existing appointment book at opening
  and before closing.
- Delivery failures are retried from Notifications, then logged as a pilot
  incident if the patient or clinic did not receive the expected message.
- Incidents must not contain names, phone numbers, appointment references or
  clinical details. Put patient-specific notes on the appointment itself.
- A critical incident means pause first, investigate second.

The pause blocks new holds immediately. It does not cancel, move or hide any
appointment already in the database.

## Weekly review

Save one snapshot after the clinic reviews:

- bookings taken, including website bookings;
- completed visits and no-shows;
- notification jobs and failed deliveries;
- open and critical incidents; and
- staff feedback recorded in the review note.

Snapshots are immutable evidence. Correct a mistaken review with a new review;
do not edit history. The built-in recommendation uses guardrails of no open
critical incidents, no-show rate at or below 15%, and notification failures at
or below 5%. The practice owner still owns the final `go`, `extend` or `stop`
decision and must record the evidence behind it.

## End of pilot

Do not select Complete merely because four weeks elapsed. Record the final
decision, owner, evidence and any conditions first. A `go` decision authorises
planning the cutover; it does not bypass the production content gate, legal
approval, infrastructure readiness or the deployment approval workflow.
