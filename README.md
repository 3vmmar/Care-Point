# 🏥 Care Point — Dr. Ashraf Metwally | Future Clinic

> A next-generation, bilingual (English & Arabic) aesthetic care platform and connected clinic operations system built for **Dr. Ashraf Metwally** (Consultant Plastic Surgeon, FRCS, EBOPRAS).

---

## 🌟 Overview

**Care Point** transforms the traditional surgical consultation into an intelligent, patient-centric digital experience. Built for edge-native deployment on Cloudflare Workers, Care Point combines a motion-driven patient web experience with an operational **Clinic OS Command Center** deployed on a separate private surface.

The platform is designed around the philosophy that aesthetic care starts with understanding patient feelings and goals rather than procedure names.

---

## ✨ Key Features

### 💎 Patient Experience (`/`)
* **Bilingual, on separate indexable URLs**: English at `/` and Arabic at `/ar`, each with its own root layout so `lang` and `dir` are correct in the *server-rendered* HTML — a crawler that never runs the script still receives Arabic markup declared as Arabic. Reciprocal `hreflang` alternates and a two-locale sitemap tell Google the pages are one document in two languages rather than duplicates. Every string lives in [`lib/i18n.ts`](lib/i18n.ts), typed so a missing translation is a compile error.
* **Motion-First Interface**: Native RTL layout, custom Google Fonts (*Manrope*, *Cormorant Garamond*, *IBM Plex Sans Arabic*), Lenis smooth scrolling driven from GSAP's ticker (one clock, no competing rAF loops), and ScrollTrigger reveals that respect `prefers-reduced-motion`.
* **Experience Intro**: Immersive video/motion intro modal welcoming patients into the clinic experience with instant replay capabilities.
* **CareLens 3D Treatment Universe**: Interactive Three.js / `@react-three/fiber` visual discovery system for exploring treatments by anatomical region. The readable interface and the WebGL engine are separate viewport-gated chunks, so the 3D download never competes with the hero.
* **NOOR Concierge**: A guided patient assistant that explains procedures, preparation guidelines, and recovery timelines in Arabic or English, with **Web Speech API** voice input and speech synthesis output. Responses are currently drawn from a fixed, clinician-reviewable answer set matched by keyword — there is no language model behind it yet.
* **Journey Designer**: Interactive step-by-step questionnaire guiding patients to personalized treatment starting points.
* **Real-Time Appointment Booking**: Real-time slot availability across 3 Cairo locations (Maadi, Mohandessin, Fifth Settlement) with a 5-minute atomic slot reservation hold pattern to prevent double booking.

### 🔎 Treatment pages (`/treatments/*`, `/ar/treatments/*`)
* **Indexable content, in both languages**: the CareLens material used to live only inside a WebGL canvas, invisible to search. Each area now has a server-rendered page per language with `MedicalProcedure`, `FAQPage` and `BreadcrumbList` structured data — the FAQ markup is what produces expandable answers directly in a search result.

### 📊 Clinic OS Command Center (`/command-center`)
Seven views, built for a screen someone reads all day rather than for a screenshot:

* **Today** — *In the room* and *Up next* at the top, today's list, and a **timeline of every published slot** so gaps are as visible as bookings. One tap to check a patient in, complete a visit, or record a no-show.
* **Week** — the next seven open days with **utilisation against real published capacity**, so a quiet day at one branch isn't mistaken for a quiet week.
* **Schedule** — filter by clinic and status, paginate, export to CSV (BOM-prefixed so Excel reads Arabic names correctly), print a day sheet.
* **Insights** — clinic load, demand by consultation, attendance and a measured no-show rate.
* **Requests** — verified data-subject requests with explicit fulfilment and erasure controls.
* **Notifications** — provider readiness, delivery queue, retries and dead-letter visibility.
* **Pilot** — one-branch parallel rollout, readiness sign-offs, emergency pause, weekly evidence, incidents and go/no-go.

Plus: **patient history** on any row (matched on phone across formats, so `01501606307` and `+20 150 160 6307` are one person), **desk and phone bookings** so the day view isn't just website traffic, **live alerts** when a booking arrives while the screen is open, clinic notes, Google Maps links, and keyboard shortcuts (`/`, `R`, `N`, `1`–`7`).

---

## 🛠 Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | [Next.js 16](https://nextjs.org/) (App Router) + [React 19](https://react.dev/) |
| **Edge Compiler & SSR** | [Vinext](https://github.com/vinext) + [@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/) |
| **Database & ORM** | Cloudflare D1 (SQLite) + [Drizzle ORM](https://orm.drizzle.team/) |
| **Interactive & 3D** | [Three.js](https://threejs.org/) + [@react-three/fiber](https://r3f.docs.pmnd.rs/) |
| **Animations & Motion** | [GSAP](https://gsap.com/) (ScrollTrigger) + [Lenis](https://lenis.darkroom.engineering/) Smooth Scroll |
| **Icons & Typography** | [Lucide React](https://lucide.dev/), Google Fonts (*Manrope*, *Cormorant Garamond*, *IBM Plex Sans Arabic*) |
| **Language & Styling** | TypeScript 5.9, Vanilla CSS (Design Tokens, Glassmorphism, Dual LTR/RTL) |
| **Testing & Linting** | Node test runner, Workers Vitest + D1, Playwright, ESLint 9 |

---

## 📁 Directory Structure

```text
Care-Point/
├── app/
│   ├── api/
│   │   ├── availability/          # Live slots, atomic hold, abandoned-hold release
│   │   ├── bookings/              # Staff list (GET) & patient confirm (POST)
│   │   │   └── [id]/              # Staff status changes & clinic notes (PATCH)
│   │   ├── appointments/[token]/  # Patient self-service: view, move, cancel
│   │   │   └── calendar/          # The .ics for a confirmed visit
│   │   └── clinic/appointments/   # Desk & phone bookings (staff only)
│   ├── (site)/                    # English root layout — lang="en" dir="ltr"
│   │   ├── page.tsx               # /        (canonical English experience)
│   │   ├── treatments/[slug]/     # Indexable treatment pages, EN
│   │   ├── appointment/[token]/   # Patient-facing manage-my-booking page
│   │   └── command-center/        # Clinic OS: dashboard, timeline, week view
│   ├── (arabic)/                  # Arabic root layout — lang="ar" dir="rtl"
│   │   ├── ar/page.tsx            # /ar      (canonical Arabic experience)
│   │   └── ar/treatments/[slug]/  # Indexable treatment pages, AR
│   ├── root-shell.tsx             # Shared document shell, fonts & metadata
│   ├── components/
│   │   ├── CarePointExperience.tsx  # Main interactive patient experience
│   │   ├── ExperienceIntro.tsx      # Intro animation modal
│   │   ├── JourneyDesigner.tsx      # Interactive care planning tool
│   │   ├── Modal.tsx                # Accessible dialog shell (focus trap, Esc)
│   │   ├── TreatmentUniverse.tsx    # Deferred CareLens controls and content
│   │   └── TreatmentCanvas.tsx      # Second-gate WebGL engine (lazy-loaded)
│   ├── robots.txt/, sitemap.xml/  # SEO route handlers (vinext emits no
│   │                              # metadata files, so these are explicit)
│   ├── chatgpt-auth.ts            # Platform identity headers
│   ├── error.tsx / not-found.tsx  # Route error boundary & 404
│   ├── globals.css                # Design system, CSS tokens & responsive rules
│   ├── layout.tsx                 # Root layout, metadata, fonts & JSON-LD
│   └── page.tsx                   # Main page entrypoint
├── lib/
│   ├── auth.ts              # Staff allowlist + access control for Clinic OS
│   ├── clinic.ts            # Branches, schedules, closures, services, contact
│   ├── dates.ts             # Africa/Cairo calendar, DST & lead-time rules
│   ├── i18n.ts              # Every patient-facing string, en + ar
│   ├── treatments.ts        # Bilingual treatment content behind the SEO pages
│   ├── ics.ts               # RFC 5545 calendar invites
│   ├── notify.ts            # Booking notifications (webhook + email adapters)
│   └── site.ts              # Canonical URL & schema.org structured data
├── build/
│   └── sites-vite-plugin.ts # Custom Vite build plugin for Cloudflare packaging
├── db/
│   ├── bookings.ts          # D1 operations, appointment lifecycle & seed
│   └── schema.ts            # Canonical schema (source for drizzle migrations)
├── drizzle/                 # Drizzle migration files & snapshots
├── public/                  # Brand assets, logos & OpenGraph images
├── tests/
│   ├── booking-rules.test.mts # API request validation & CSV escaping
│   ├── clinic.test.mts        # Clinic config & booking validation rules
│   ├── dates.test.mts         # Timezone, DST & lead-time logic
│   ├── i18n.test.mts          # en/ar dictionary parity
│   └── ics.test.mts           # Calendar invite correctness
├── worker/
│   └── index.ts             # Worker entry: security headers & cron maintenance
├── .github/workflows/ci.yml # Typecheck, lint, test, build, migration drift
├── drizzle.config.ts        # Drizzle kit configuration
├── next.config.ts           # Next.js configuration
├── package.json             # Project dependencies & scripts
├── tsconfig.json            # TypeScript configuration
└── vite.config.ts           # Vinext, Cloudflare bindings & cron triggers
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `^22.13.0`
- **npm**: `10.x` or higher

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/3vmmar/Care-Point.git
   cd Care-Point
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the local development server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser to view the patient experience, or visit `http://localhost:3000/command-center` for the Clinic Command Center.

---

## 🗄 Database Management

The application utilizes **Cloudflare D1** (SQLite) locally in development via Miniflare/Wrangler.

* **Generate Database Migrations**:
  ```bash
  npm run db:generate
  ```

---

## 🧪 Quality & Testing

* **Run Unit + Workers/D1 Tests**:
  ```bash
  npm run test
  ```

* **Run Browser Journeys + HTTP Contracts**:
  ```bash
  npx playwright install chromium
  npm run test:e2e
  ```

* **Run the Entire Phase 4 Gate**:
  ```bash
  npm run test:phase4
  ```

See [`docs/TESTING.md`](docs/TESTING.md) for isolation, concurrency and load-test details.

* **Typecheck**:
  ```bash
  npm run typecheck
  ```

* **Run Linter**:
  ```bash
  npm run lint
  ```

* **Build Production Bundle**:
  ```bash
  npm run build
  ```

---

## ⚙️ Configuration

Everything a non-developer needs to change lives in
[`lib/clinic.ts`](lib/clinic.ts): branches and their addresses, Google Maps
links, opening times, holiday closures, booking lead time, consultation types
and durations, contact numbers and the data-retention window.

### Before launch — required

| What | Where | Why |
| :--- | :--- | :--- |
| **Real phone / WhatsApp** | `CONTACT` in [`lib/clinic.ts`](lib/clinic.ts) | Still placeholders (`+20 100 000 0000`), and they render on the public site. |
| **Real Google Maps links** | `mapUrl` per branch in [`lib/clinic.ts`](lib/clinic.ts) | Currently neighbourhood searches, not the clinic's own map pins. |
| **`STAFF_EMAILS`** | environment | Comma-separated staff addresses. **Empty means nobody is authorised** — the dashboard fails closed and warns on screen. |
| **`SITE_URL`** | environment | Canonical, OpenGraph, sitemap and structured-data URLs. |

### Notifications — durable, but providers still need configuration

Every event is committed to D1 with the booking change. Configure one or more
providers; unconfigured channels remain visible and retryable in Clinic OS.

| Variable | Purpose |
| :--- | :--- |
| `NOTIFY_WEBHOOK_URL` | Sends the clinic-side event to Zapier, Make, n8n, or an internal endpoint. |
| `NOTIFY_WEBHOOK_TOKEN` | Optional bearer token for that webhook. |
| `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` | Transactional email to the patient. |
| `CLINIC_NOTIFY_EMAIL` | Clinic inbox that receives the staff copy. |
| `WHATSAPP_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_TOKEN` | Clinic-owned WhatsApp Business gateway. |
| `WHATSAPP_TEMPLATE_*` | Approved template names for confirmation, cancellation, rescheduling, and reminders. |
| `SEED_APPOINTMENT=0` | Skips the seeded demonstration appointment. |

### Access control

`/command-center`, `GET /api/bookings`, `PATCH /api/bookings/:id` and
`POST /api/clinic/appointments` expose patient contact details. All four require
an authenticated identity **that also appears in `STAFF_EMAILS`** — authentication
alone is not authorisation, since the hosting platform will authenticate any
account. Local development bypasses the check; production never does.

Patient-facing management links (`/appointment/:token`) are authorised by an
unguessable per-appointment token, are `noindex`, and are excluded from
`robots.txt`.

### Scheduled maintenance

Two cron triggers are declared in [`vite.config.ts`](vite.config.ts) and handled
in [`worker/index.ts`](worker/index.ts):

* `*/10 * * * *` — releases expired holds. This used to run as a `DELETE` on
  every availability read; reads already ignore expired holds, so it belongs here.
* `0 3 * * *` — clears patient contact details from visits older than
  `PII_RETENTION_DAYS`, keeping the anonymous row for reporting.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
