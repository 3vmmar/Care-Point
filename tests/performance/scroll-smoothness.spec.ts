import { expect, test } from "@playwright/test";

/**
 * Measures how smoothly the patient landing page scrolls, on a throttled phone.
 *
 * The practice reported "some scrolling lags" on laptops and mobiles. That is a
 * frame-timing problem, and frame timing cannot be measured by reading CSS or
 * by watching a page in a pane that is not compositing — `requestAnimationFrame`
 * simply does not fire there. So it is measured here, in the same constrained
 * lab the Core Web Vitals guardrail already uses: a Pixel 5 over 4G with the
 * CPU throttled 4×.
 *
 * What it records is the interval between animation frames while the page is
 * scrolled from top to bottom. A 60Hz budget is 16.7ms; anything past ~33ms is
 * a frame a person sees as a stutter rather than as motion.
 *
 * The numbers are printed on every run so a change can be compared honestly
 * before and after, rather than described.
 */

type FrameReport = {
  documentHeight: number;
  frames: number;
  median: number;
  p75: number;
  p95: number;
  p99: number;
  worst: number;
  over16: number;
  over33: number;
  over50: number;
  stalls: Array<{ ms: number; scrollY: number; depth: string }>;
  sectionsAt: Array<{ depth: string; ms: number; section: string }>;
};

test("the landing page scrolls without dropping frames on a throttled phone", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (0.75 * 1024 * 1024) / 8,
    connectionType: "cellular4g",
  });
  // The same 4× throttle the vitals lab uses, so the two numbers describe the
  // same imagined device rather than two different ones.
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // Skip the intro overlay: it is a one-time modal and not what scrolls.
  await page.addInitScript(() => {
    window.localStorage.setItem("carepoint:intro-seen", "1");
  });

  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator(".hero h1")).toBeVisible();
  // Let fonts, the hero image and any deferred mount settle, so the measurement
  // is of scrolling rather than of the page still assembling itself.
  await page.waitForTimeout(3_000);

  // Warm-up pass: one silent trip to the bottom and back before measuring.
  // The first scroll after a cold server start pays one-off costs — module
  // evaluation, image decode, the deferred CareLens mount, shader compiles —
  // that belong to loading, not to scrolling. Unwarmed, the first measured
  // run of a session reported frames of 1.8–4.4 SECONDS while the next run
  // reported 0.1% dropped: same page, same code. A guardrail that noisy blocks
  // nothing and teaches people to ignore it.
  //
  // Known trade: the warm-up also fires every `once: true` entrance, so the
  // measured pass sees scrub-driven motion only. That is the deliberate
  // contract — this lab guards steady-state scrolling; entrance cost is a
  // loading concern and is bounded by the tweens' own sub-second durations.
  await page.evaluate(async () => {
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, distance);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  });

  const report = await page.evaluate<FrameReport>(async () => {
    const intervals: number[] = [];
    // Where each stall happened, not just that it happened. A sustained cost
    // shows up everywhere; a mount or a decode shows up at one scroll depth,
    // and only the second kind is fixed by deferring something.
    const stalls: Array<{ ms: number; scrollY: number; depth: string }> = [];
    let last = performance.now();
    let running = true;

    const tick = (now: number) => {
      const delta = now - last;
      intervals.push(delta);
      if (delta > 33) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        stalls.push({
          ms: Number(delta.toFixed(1)),
          scrollY: Math.round(window.scrollY),
          depth: `${Math.round((window.scrollY / Math.max(1, max)) * 100)}%`,
        });
      }
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Wheel events, not scrollTo.
    //
    // This site runs Lenis, which intercepts wheel input and animates the
    // scroll position itself on a lerp. `window.scrollTo` goes straight to the
    // native scroller and never engages that loop — measuring it would report
    // the smoothness of a code path no visitor uses. Dispatching wheel is what
    // a person with a trackpad or a phone actually produces.
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    const start = performance.now();
    while (window.scrollY < distance - 8 && performance.now() - start < 20_000) {
      window.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 120,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 32));
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    running = false;

    // Drop the first few frames: they cover the scroll starting up, not steady
    // state, and would otherwise flatter or punish the result arbitrarily.
    const sorted = intervals.slice(4).sort((a, b) => a - b);
    const at = (p: number) => Number((sorted[Math.floor(sorted.length * p)] ?? 0).toFixed(1));
    const count = (ms: number) => sorted.filter((value) => value > ms).length;

    return {
      documentHeight: document.documentElement.scrollHeight,
      frames: sorted.length,
      median: at(0.5),
      p75: at(0.75),
      p95: at(0.95),
      p99: at(0.99),
      worst: Number((sorted[sorted.length - 1] ?? 0).toFixed(1)),
      over16: count(16.7),
      over33: count(33),
      over50: count(50),
      stalls: stalls.sort((a, b) => b.ms - a.ms).slice(0, 8),
      // What was on screen at the deepest stall, so the cause has a name.
      sectionsAt: stalls.slice(0, 8).map((stall) => {
        const mid = stall.scrollY + window.innerHeight / 2;
        let found = "";
        for (const node of Array.from(document.querySelectorAll<HTMLElement>("section, [class*='section'], .carelens, .treatment-universe"))) {
          const top = node.offsetTop;
          if (top <= mid && top + node.offsetHeight >= mid) {
            found = (node.className || node.tagName).toString().slice(0, 48);
          }
        }
        return { depth: stall.depth, ms: stall.ms, section: found };
      }),
    };
  });

  const share = (n: number) => `${((n / report.frames) * 100).toFixed(1)}%`;
  console.log(
    [
      "",
      "  Scroll smoothness — Pixel 5, 4G, CPU ×4",
      `  document height   ${report.documentHeight}px over ${report.frames} frames`,
      `  median frame      ${report.median}ms`,
      `  p75 / p95 / p99   ${report.p75}ms / ${report.p95}ms / ${report.p99}ms`,
      `  worst frame       ${report.worst}ms`,
      `  over 16.7ms       ${report.over16} (${share(report.over16)})`,
      `  over 33ms         ${report.over33} (${share(report.over33)})`,
      `  over 50ms         ${report.over50} (${share(report.over50)})`,
      "",
      "  where the stalls happened:",
      ...report.sectionsAt.map((s2) => `    ${String(s2.ms).padStart(6)}ms at ${s2.depth.padStart(4)} depth  ${s2.section || "(no section matched)"}`),
      "",
    ].join("\n"),
  );

  // A capture that collected nothing would pass every threshold below, which is
  // the one result that must never read as success.
  expect(report.frames, "no frames were captured — the measurement is void").toBeGreaterThan(40);

  // Guardrail rather than a target. Tightened once the performance pass lands;
  // its job today is to stop a regression going unnoticed, and to make the
  // before/after difference a number instead of an impression.
  expect(
    report.over50 / report.frames,
    `more than 10% of frames took over 50ms — that is visible stutter, not motion`,
  ).toBeLessThan(0.1);
});
