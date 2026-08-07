import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const { r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const appSurface =
  process.env.CAREPOINT_SURFACE ??
  (process.env.NODE_ENV === "production" ? "patient" : "combined");

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // The minute trigger drains the durable notification outbox and clears
  // expired holds. The 03:00 trigger additionally carries retention jobs.
  triggers: {
    crons: ["* * * * *", "0 3 * * *"],
  },
  vars: {
    APP_SURFACE: appSurface,
    PUBLIC_SITE_URL:
      process.env.PUBLIC_SITE_URL ?? "https://drashrafmetwally.com",
      CLINIC_DASHBOARD_URL:
        process.env.CLINIC_DASHBOARD_URL ??
        (appSurface === "combined" ? "http://localhost:3001/command-center" : ""),
  },
  /**
   * No `d1_databases` binding. The database is Neon Postgres, reached over HTTPS
   * with `DATABASE_URL` — a secret, so it is deliberately absent from `vars`
   * here. Set it with `wrangler secret put DATABASE_URL` per environment, and
   * put a local one in `.dev.vars` (git-ignored) for `npm run dev`.
   *
   * See docs/ADR-001-postgres.md.
   */
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
