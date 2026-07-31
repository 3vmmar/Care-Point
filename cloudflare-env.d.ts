/// <reference types="@cloudflare/workers-types" />

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      APP_SURFACE?: "combined" | "patient" | "clinic";
      PUBLIC_SITE_URL?: string;
      CLINIC_DASHBOARD_URL?: string;
    }
  }
}

export {};
