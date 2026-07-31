# Phase 5 content approval gate

The system may be demonstrated privately and deployed to staging while this gate
is open. It must not replace the public production site until every entry in
`content/launch-approvals.json` is approved with a named reviewer, review date,
and evidence/source reference. The production workflow enforces this rule before
it touches the database.

## What the clinic must provide

1. A weekly rota for each branch: practitioner, weekday, first appointment,
   last appointment, interval, turnaround, closed days, holidays and leave.
2. The exact bookable service list, who performs each service, and the real
   chair/consultation duration.
3. Verified address and Google place link for every branch, plus the preferred
   phone, WhatsApp number and email.
4. Evidence for credentials, title, professional memberships and the “25+ years”
   claim. If a claim is not evidenced, remove it rather than approve it.
5. Dr. Ashraf's line-by-line approval of English treatment, recovery, booking
   and NOOR guidance. Approval means clinically accurate, not merely polished.
6. A separate line-by-line Arabic review by an Arabic-speaking clinician.
7. Final licensed photography and written publication consent for every person
   shown. Record asset filenames in the evidence field.
8. Egyptian counsel's sign-off on patient-facing claims and imagery under the
   applicable medical-advertising rules.

## How approval works

For each item, change `status` from `pending` to `approved`, enter the reviewer's
real name, use an ISO date (`YYYY-MM-DD`), and cite the signed document, email,
shared-drive reference, or final asset list in `evidence`. Do not approve an item
on somebody else's behalf.

Run:

```powershell
npm run check:launch-content
```

The command is expected to fail today. That failure is intentional: the hours in
`lib/clinic.ts` are still placeholders, the existing photograph is not a final
clinic-supplied asset set, and neither language has clinician sign-off recorded.

## Real-device performance sign-off

The automated Phase 5 lab test uses a Pixel 5 profile, 4× CPU slowdown, 150 ms
round-trip latency, 1.6 Mbps down and 0.75 Mbps up. It is a repeatable regression
guard, not field evidence. Before public cutover, repeat the booking journey on a
real mid-range Android phone using Egyptian mobile data and record LCP, INP and
CLS at the 75th percentile once enough real traffic exists.
