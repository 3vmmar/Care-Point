import { expect, test } from "@playwright/test";

const REQUESTS = Number(process.env.LOAD_BURST_REQUESTS ?? 80);
const P95_BUDGET_MS = Number(process.env.LOAD_P95_BUDGET_MS ?? 2_000);

test("an Instagram-style availability burst stays successful and bounded", async ({ request }) => {
  // Warm the route and schema once. The burst is intended to measure the
  // steady-state booking path, while cold-start behavior has its own health
  // probe and production monitoring.
  const warmup = await request.get("/api/availability");
  expect(warmup.status()).toBe(200);

  const started = performance.now();
  const samples = await Promise.all(
    Array.from({ length: REQUESTS }, async (_, index) => {
      const requestStarted = performance.now();
      const response = await request.get(`/api/availability?locale=${index % 2 ? "ar" : "en"}`);
      await response.body();
      return {
        status: response.status(),
        elapsedMs: performance.now() - requestStarted,
      };
    }),
  );
  const totalMs = performance.now() - started;
  const durations = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];

  expect(samples.filter((sample) => sample.status === 200)).toHaveLength(REQUESTS);
  expect(p95).toBeLessThan(P95_BUDGET_MS);
  expect(totalMs).toBeLessThan(P95_BUDGET_MS * 2);
});
