# 🏥 Care Point — Dr. Ashraf Metwally | Future Clinic

> A next-generation, bilingual (English & Arabic) aesthetic care platform and connected clinic operations system built for **Dr. Ashraf Metwally** (Consultant Plastic Surgeon, FRCS, EBOPRAS).

---

## 🌟 Overview

**Care Point** transforms the traditional surgical consultation into an intelligent, patient-centric digital experience. Built for edge-native deployment on Cloudflare Workers, Care Point combines a motion-driven patient web experience with an operational **Clinic OS Command Center**.

The platform is designed around the philosophy that aesthetic care starts with understanding patient feelings and goals rather than procedure names.

---

## ✨ Key Features

### 💎 Patient Experience (`/`)
* **Bilingual & Motion-First Interface**: Complete English and Arabic localization with native Right-to-Left (RTL) layout switching, custom Google Fonts (*Manrope*, *Cormorant Garamond*, *IBM Plex Sans Arabic*), Lenis smooth scrolling, and GSAP ScrollTrigger animations.
* **Experience Intro**: Immersive video/motion intro modal welcoming patients into the clinic experience with instant replay capabilities.
* **CareLens 3D Treatment Universe**: Interactive Three.js / `@react-three/fiber` visual discovery system for exploring treatments by anatomical region (Face, Rhinoplasty, Body, Breast, Skin) and aesthetic intent.
* **NOOR AI Concierge**: AI-powered patient assistant capable of explaining procedures, preparation guidelines, and recovery timelines in Arabic or English, featuring **Web Speech API** voice input and speech synthesis output.
* **Journey Designer**: Interactive step-by-step questionnaire guiding patients to personalized treatment starting points.
* **Real-Time Appointment Booking**: Real-time slot availability across 3 Cairo locations (Maadi, Mohandessin, Fifth Settlement) with a 5-minute atomic slot reservation hold pattern to prevent double booking.

### 📊 Clinic OS Command Center (`/command-center`)
* **Live Operations Dashboard**: High-level overview of incoming website reservations, appointment queue, confirmation rates, and clinic metrics.
* **Real-Time Polling & Sync**: Automatically fetches new patient bookings from Cloudflare D1 database.
* **NOOR Patient Insights**: Analytics card displaying trending patient inquiries (recovery timelines, expected results, cost factors) to empower clinic content strategy.

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
| **Testing & Linting** | Node Native Test Runner, ESLint 9 |

---

## 📁 Directory Structure

```text
Care-Point/
├── app/
│   ├── api/
│   │   ├── availability/    # Real-time slot fetching & hold reservation endpoint
│   │   └── bookings/        # Appointment confirmation & listing endpoint
│   ├── command-center/      # Clinic OS operational dashboard & CSS
│   ├── components/
│   │   ├── CarePointExperience.tsx  # Main interactive patient experience
│   │   ├── ExperienceIntro.tsx      # Intro animation modal
│   │   ├── JourneyDesigner.tsx      # Interactive care planning tool
│   │   └── TreatmentUniverse.tsx    # 3D CareLens canvas exploration
│   ├── globals.css          # Design system, CSS tokens & responsive rules
│   ├── layout.tsx           # Root layout, metadata & Google Fonts setup
│   └── page.tsx             # Main page entrypoint
├── build/
│   └── sites-vite-plugin.ts # Custom Vite build plugin for Cloudflare packaging
├── db/
│   ├── bookings.ts          # D1 database operations & slot reservation logic
│   ├── index.ts             # Drizzle ORM client initialization
│   └── schema.ts            # Database schema definitions
├── drizzle/                 # Drizzle migration files & snapshots
├── public/                  # Brand assets, logos & OpenGraph images
├── tests/
│   └── rendered-html.test.mjs # Integration & HTML rendering test suite
├── worker/
│   └── index.ts             # Cloudflare Worker entrypoint
├── drizzle.config.ts        # Drizzle kit configuration
├── next.config.ts           # Next.js configuration
├── package.json             # Project dependencies & scripts
├── tsconfig.json            # TypeScript configuration
└── vite.config.ts           # Vinext & Cloudflare Vite configuration
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

Verify application integrity, test assertions, and code style compliance:

* **Run Test Suite**:
  ```bash
  npm run test
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

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
