import { defineConfig, devices } from "@playwright/test";

const port = 3117;
// The Cloudflare Vite preview binds localhost on IPv6 in Windows. Keeping the
// hostname (rather than forcing 127.0.0.1) makes the same config work in CI and
// on the demo machine.
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results/playwright",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      CAREPOINT_SURFACE: "combined",
      SEED_APPOINTMENT: "0",
    },
  },
});
