import { defineConfig, devices } from "@playwright/test";

/**
 * Separate config for the computed-style snapshot harness.
 *
 * It is not part of `tests/e2e` on purpose: this runs on demand around a
 * refactor, twice, and must not add several minutes to every CI run. It also
 * needs a far longer timeout than the journey specs, because one test walks
 * eighteen route/viewport pairs.
 */
const port = 3117;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/tokens",
  timeout: 900_000,
  fullyParallel: false,
  // One worker deliberately. This machine has ~3 GB free of 16 GB and a
  // Playwright worker that cannot allocate exits 0xC0000142 — a Windows memory
  // failure that reads exactly like a test failure and has already cost this
  // project a wrongly reverted feature.
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/tokens-run",
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `${baseURL}/api/health`,
    // A killed run leaves the previous server holding 3117; reusing it turns a
    // 120s wait for a port that will never bind into an immediate start.
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      CAREPOINT_SURFACE: "combined",
      SEED_APPOINTMENT: "0",
    },
  },
});
