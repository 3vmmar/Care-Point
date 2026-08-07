/// <reference types="@cloudflare/workers-types" />

declare global {
  namespace Cloudflare {
    interface Env {
      /**
       * Neon Postgres connection string. Replaces the former `DB` D1 binding —
       * see `docs/ADR-001-postgres.md`.
       *
       * A secret, not a var: it carries credentials. Set it with
       * `wrangler secret put DATABASE_URL` per environment, never in
       * `vite.config.ts`.
       */
      DATABASE_URL: string;
      APP_SURFACE?: "combined" | "patient" | "clinic";
      PUBLIC_SITE_URL?: string;
      CLINIC_DASHBOARD_URL?: string;
    }
  }
}

export {};
