import { defineConfig, devices } from "@playwright/test";

const port = 3118;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/performance",
  timeout: 90_000,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/performance",
  use: {
    ...devices["Pixel 5"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx wrangler dev --config dist/server/wrangler.json --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      CAREPOINT_SURFACE: "patient",
      SEED_APPOINTMENT: "0",
    },
  },
});
