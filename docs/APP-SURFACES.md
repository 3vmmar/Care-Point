# Care Point application surfaces

Care Point is built once and deployed as two independent Workers against the
same production D1 database.

| Deployment | `APP_SURFACE` | Hostname | Responsibility |
| --- | --- | --- | --- |
| Patient | `patient` | `www.drashrafmetwally.com` | Marketing, availability, booking, patient-managed appointments and DSR intake |
| Clinic OS | `clinic` | `clinic.drashrafmetwally.com` | Staff dashboard and patient-data APIs |

Local development defaults to `combined` so both surfaces can be developed
without two processes. `npm run dev:patient` and `npm run dev:clinic` exercise
the production route boundaries.

## Boundary guarantees

- The patient Worker returns `404` for every staff API.
- `/command-center` on the patient Worker redirects to the configured private
  dashboard hostname, or returns `404` when that hostname is not configured.
- The Clinic OS Worker only serves dashboard, staff API, shared read-only
  availability, authentication, health and static-asset routes.
- Marketing and patient-management routes on Clinic OS redirect to the public
  hostname for safe GET requests and return `404` otherwise.
- Staff authentication and authorization are still enforced inside every
  private route. Deployment separation is an additional boundary, not a
  replacement for identity checks.

## Required runtime values

Both Workers:

- `DB`: the same production D1 database binding.
- `AUTH_PROXY_SECRET`: proxy-to-origin authentication secret.

Patient Worker:

- `APP_SURFACE=patient`
- `CLINIC_DASHBOARD_URL=https://clinic.drashrafmetwally.com`

Clinic OS Worker:

- `APP_SURFACE=clinic`
- `PUBLIC_SITE_URL=https://www.drashrafmetwally.com`
- `STAFF_EMAILS`: temporary allowlist until the staff directory and role model
  become the authorization source of truth.

The clinic origin must remain unreachable except through the authenticated
proxy. The proxy must inject `x-carepoint-proxy-auth`; clients must never be
able to set or preserve that header themselves.

## Database

Migration `0006` introduces the production catalogue and rota tables:

- departments, branches, practitioners and services;
- practitioner/branch and service/practitioner assignments;
- weekly sessions and dated schedule exceptions;
- staff users and staff roles.

The migration deliberately contains no clinic hours, practitioner names or
service assignments. Those values have not been approved by the clinic and
must not be invented in a production database.

