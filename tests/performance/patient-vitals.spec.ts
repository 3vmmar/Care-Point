import { expect, test } from "@playwright/test";

test("patient landing path stays within the mobile lab Core Web Vitals guardrail", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    // A documented repeatable lab proxy for a constrained Egyptian 4G visit.
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (0.75 * 1024 * 1024) / 8,
    connectionType: "cellular4g",
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.addInitScript(() => {
    window.localStorage.setItem("carepoint:intro-seen", "1");
    const vitals = { cls: 0, lcp: 0, lcpElement: "", longestInteraction: 0 };
    Object.defineProperty(window, "__carePointVitals", { value: vitals });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime <= vitals.lcp) continue;
        vitals.lcp = entry.startTime;
        // Name the element, or a failure reports a number with no suspect —
        // "LCP is 3088" cannot be acted on; "LCP is the hero <h1>" can.
        const el = (entry as PerformanceEntry & { element?: Element }).element;
        vitals.lcpElement = el
          ? `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").join(".") : ""}`
          : "(detached)";
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!shift.hadRecentInput) vitals.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        vitals.longestInteraction = Math.max(vitals.longestInteraction, entry.duration);
      }
    }).observe(
      { type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit,
    );
  });

  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator(".hero h1")).toBeVisible();
  await expect(page.locator('img[src="/doctor-hero.webp"]')).toBeVisible();
  await page.waitForTimeout(2_500);

  await page.locator(".hero-actions .button--burgundy").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const vitals = await page.evaluate(() => {
    const measured = (
      window as unknown as Window & {
        __carePointVitals: { cls: number; lcp: number; lcpElement: string; longestInteraction: number };
      }
    ).__carePointVitals;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return {
      ...measured,
      domContentLoaded: navigation.domContentLoadedEventEnd,
      load: navigation.loadEventEnd,
    };
  });

  test.info().annotations.push({
    type: "mobile-lab",
    description: JSON.stringify(vitals),
  });
  console.log(
    `  mobile lab: LCP ${Math.round(vitals.lcp)}ms on <${vitals.lcpElement || "?"}> · CLS ${vitals.cls.toFixed(3)} · longest interaction ${Math.round(vitals.longestInteraction)}ms`,
  );

  // Lab gates catch regressions. Production sign-off still uses p75 field data
  // from a real mid-range Android device and the clinic's Egyptian mobile users.
  expect(vitals.lcp).toBeGreaterThan(0);
  expect(vitals.lcp).toBeLessThanOrEqual(2_500);
  expect(vitals.cls).toBeLessThanOrEqual(0.1);
  expect(vitals.longestInteraction).toBeLessThanOrEqual(200);

  const canvasLoadedBeforeScroll = await page.evaluate(() =>
    performance.getEntriesByType("resource").some((entry) => entry.name.includes("TreatmentCanvas")),
  );
  expect(canvasLoadedBeforeScroll).toBe(false);

  await page.locator("#carelens").scrollIntoViewIfNeeded();
  await expect(page.locator(".universe-canvas canvas")).toBeVisible({ timeout: 30_000 });
  const canvasLoadedAfterScroll = await page.evaluate(() =>
    performance.getEntriesByType("resource").some((entry) => entry.name.includes("TreatmentCanvas")),
  );
  expect(canvasLoadedAfterScroll).toBe(true);
});
