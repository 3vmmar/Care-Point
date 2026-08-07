import { expect, test, type Page } from "@playwright/test";

/**
 * Proves that every section of the landing page has scroll-linked motion.
 *
 * This exists because the previous attempt at the brief failed in exactly the
 * way this test would have caught: the practice scrolled the whole site and
 * found "literally nothing". An audit later showed why — two reveal verbs
 * covered seven of the ten sections, three sections froze after a single
 * fade, and the footer had no scroll motion of any kind.
 *
 * So the assertions here are deliberately about *observable change under
 * scroll*, not about the presence of a class or an attribute. A hover effect
 * passes neither. Each check reads a computed value before the section is
 * reached and again after, and requires them to differ.
 */

/** Drive the page the way a person does. Lenis intercepts wheel input and
 *  animates the scroll itself, so `scrollTo` would bypass the whole system. */
async function wheelTo(page: Page, fraction: number) {
  await page.evaluate(async (target: number) => {
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    const goal = distance * target;
    for (let i = 0; i < 600 && window.scrollY < goal - 12; i += 1) {
      window.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    // Let the reveal that the arrival triggered actually play out.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }, fraction);
}

const styleOf = (page: Page, selector: string, property: string) =>
  page.evaluate(
    ([sel, prop]) => {
      const element = document.querySelector(sel);
      if (!element) return "MISSING";
      return window.getComputedStyle(element).getPropertyValue(prop).trim();
    },
    [selector, property] as const,
  );

test.describe("every section answers the scroll", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("carepoint:intro-seen", "1");
    });
    await page.goto("/");
    await expect(page.locator(".hero h1")).toBeVisible();
    await page.waitForTimeout(1_500);
  });

  test("the footer arrives instead of being already there", async ({ page }) => {
    // The footer used to have no scroll motion whatsoever — no batch selector
    // reached it, no attribute, no trigger. It is also the last thing anyone
    // sees, so arriving dead was the worst possible place to do it.
    const before = await styleOf(page, ".footer-rule", "transform");
    expect(before, "the footer rule should start undrawn").toContain("matrix(0");

    await wheelTo(page, 1);

    const after = await styleOf(page, ".footer-rule", "transform");
    expect(after, "the footer rule should have drawn across").not.toBe(before);
    expect(await styleOf(page, ".footer-brand", "opacity")).toBe("1");
    expect(await styleOf(page, ".footer-links", "opacity")).toBe("1");
  });

  test("the journey steps assemble in sequence rather than together", async ({ page }) => {
    const cards = page.locator(".journey-grid article");
    await expect(cards.first()).toHaveCount(1);
    expect(await styleOf(page, ".journey-grid article", "opacity")).toBe("0");

    await wheelTo(page, 0.8);
    expect(
      await styleOf(page, ".journey-grid article", "opacity"),
      "the first journey card should have arrived",
    ).toBe("1");
  });

  test("the branch cards arrive laterally, from outside the measure", async ({ page }) => {
    // Geography deserves a lateral arrival rather than the same rise as
    // everything else. The from-state is function-based (per-index), which
    // GSAP resolves differently to a plain object — worth asserting rather
    // than assuming it renders immediately.
    const restingOpacity = await styleOf(page, ".location-card", "opacity");
    const restingTransform = await styleOf(page, ".location-card", "transform");
    expect(restingOpacity, "branch cards should start hidden").toBe("0");
    expect(restingTransform, "the first card should start offset to the side").not.toBe("none");

    await wheelTo(page, 0.95);

    expect(await styleOf(page, ".location-card", "opacity")).toBe("1");
    const settled = await styleOf(page, ".location-card", "transform");
    expect(settled, "the card should have travelled to rest").not.toBe(restingTransform);
  });

  test("the closing statement resolves and its rings converge on scroll", async ({ page }) => {
    expect(await styleOf(page, ".final-cta > div", "opacity")).toBe("0");
    const ringsBefore = await styleOf(page, ".final-cta", "--final-ring-shift");

    await wheelTo(page, 1);

    expect(await styleOf(page, ".final-cta > div", "opacity")).toBe("1");
    const ringsAfter = await styleOf(page, ".final-cta", "--final-ring-shift");
    expect(
      Number(ringsAfter),
      `the decorative rings should travel on scrub (${ringsBefore} -> ${ringsAfter})`,
    ).toBeGreaterThan(Number(ringsBefore || 0));
  });

  test("the hero headline rises line by line out of its masks", async ({ page }) => {
    // Pure CSS with `both` fill, so it must resolve to visible on its own —
    // no GSAP involved. If the keyframe breaks, the biggest type in the
    // product is invisible, which is the one failure that must never ship.
    await page.waitForTimeout(1_800);
    for (const selector of [".hero h1 > span", ".hero h1 em"]) {
      expect(await styleOf(page, selector, "opacity"), `${selector} must land visible`).toBe("1");
      expect(
        await styleOf(page, selector, "transform"),
        `${selector} must settle at rest`,
      ).toMatch(/none|matrix\(1, 0, 0, 1, 0, 0\)/);
    }
  });

  test("the portal scenes travel laterally, not vertically", async ({ page }) => {
    // Scene 2 starts parked off to the side; by mid-portal it has travelled
    // horizontally into place. A vertical fade would leave translateX at 0
    // throughout, which is exactly what this catches.
    const before = await page.evaluate(() => {
      const scene = document.querySelectorAll<HTMLElement>(".portal-scene")[1];
      return scene ? new DOMMatrix(getComputedStyle(scene).transform).m41 : NaN;
    });
    expect(Math.abs(before), "scene 2 should start offset to the side").toBeGreaterThan(40);

    await wheelTo(page, 0.28);

    const after = await page.evaluate(() => {
      const scene = document.querySelectorAll<HTMLElement>(".portal-scene")[1];
      return scene ? new DOMMatrix(getComputedStyle(scene).transform).m41 : NaN;
    });
    expect(after, "scene 2 should have travelled horizontally").not.toBe(before);
  });

  test("the proof-strip rules draw before the counters land", async ({ page }) => {
    expect(await styleOf(page, ".stat-rule", "transform")).toContain("matrix(1, 0, 0, 0");

    await wheelTo(page, 0.45);

    const drawn = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".stat-rule")).map(
        (rule) => new DOMMatrix(getComputedStyle(rule).transform).d,
      ),
    );
    expect(drawn.length).toBe(3);
    for (const scaleY of drawn) expect(scaleY, "every divider should be drawn").toBe(1);
  });

  test("the NOOR orbits counter-rotate on scrub", async ({ page }) => {
    const angles = () =>
      page.evaluate(() =>
        [".orbit-one", ".orbit-two"].map((sel) => {
          const el = document.querySelector<HTMLElement>(sel);
          if (!el) return NaN;
          const m = new DOMMatrix(getComputedStyle(el).transform);
          return Math.round(Math.atan2(m.b, m.a) * (180 / Math.PI));
        }),
      );

    // Park at two exact positions inside the section's scrub window and
    // sample. Wheel-driven scrolling cannot do this: every wheel event adds to
    // Lenis's easing target, and the target runs far ahead of scrollY, so the
    // glide overshoots the section after the loop stops — both samples then
    // read the scrub's end angle and "no rotation" is really "rotation
    // finished before we looked". ScrollTrigger reads the window's scroll
    // position however it moves, so a direct park exercises the same scrub.
    const park = async (fraction: number) => {
      await page.evaluate((f: number) => {
        const section = document.querySelector<HTMLElement>(".noor-feature")!;
        const top = section.getBoundingClientRect().top + window.scrollY;
        const windowSpan = section.offsetHeight + window.innerHeight;
        // Scrub progress f through "top bottom -> bottom top".
        window.scrollTo(0, top - window.innerHeight + windowSpan * f);
      }, fraction);
      await page.waitForTimeout(700);
    };

    await park(0.3);
    const mid = await angles();
    await park(0.7);
    const late = await angles();

    expect(late[0], "orbit-one should keep rotating").not.toBe(mid[0]);
    expect(late[1], "orbit-two should keep rotating").not.toBe(mid[1]);
    // Counter-rotation: the two deltas move in opposite directions.
    const deltaOne = late[0] - mid[0];
    const deltaTwo = late[1] - mid[1];
    expect(
      Math.sign(deltaOne) * Math.sign(deltaTwo),
      `the rings must turn against each other (Δ ${deltaOne} vs ${deltaTwo})`,
    ).toBe(-1);
  });

  test("the watermark words all parallax, not just the first one", async ({ page }) => {
    // BEYOND, CARELENS and CAIRO are the same device used three times. Only
    // BEYOND was ever given parallax, which is how one deliberate decision came
    // to read as three unrelated accidents.
    const before = {
      carelens: await styleOf(page, ".carelens-word", "transform"),
      cairo: await styleOf(page, ".locations-word", "transform"),
    };

    await wheelTo(page, 0.6);
    const midCarelens = await styleOf(page, ".carelens-word", "transform");
    await wheelTo(page, 0.95);
    const lateCairo = await styleOf(page, ".locations-word", "transform");

    expect(midCarelens, "CARELENS should drift with scroll").not.toBe(before.carelens);
    expect(lateCairo, "CAIRO should drift with scroll").not.toBe(before.cairo);
  });

  test("CareLens keeps the wheel instead of trapping it", async ({ page }) => {
    // `.universe-detail` used to be a nested scroller, so putting the pointer
    // over the right half of CareLens stopped scrolling the page. On a site
    // whose whole identity is scroll choreography, the section took the scroll
    // away and then handed it back.
    expect(await styleOf(page, ".universe-detail", "overflow-y")).not.toBe("auto");

    // And it no longer paints the site's one persistent control out of view.
    expect(
      await styleOf(page, ".carelens", "z-index"),
      "CareLens must not out-stack the floating NOOR button",
    ).toBe("auto");
  });

  test("the full-bleed CareLens band does not push the page sideways", async ({ page }) => {
    // `width: 100vw` is the standard full-bleed trick and the standard way to
    // introduce a horizontal scrollbar: on a platform with a classic scrollbar,
    // 100vw is wider than the content box it sits in.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bandRight: document.querySelector(".treatment-universe")?.getBoundingClientRect().right ?? 0,
      viewport: window.innerWidth,
    }));
    expect(
      overflow.scrollWidth,
      `the page must not scroll horizontally (${overflow.scrollWidth} vs ${overflow.clientWidth})`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(
      overflow.bandRight,
      "the CareLens band should reach the viewport edge, not past it",
    ).toBeLessThanOrEqual(overflow.viewport + 1);
  });

  test("the header hairline fills with reading progress and the nav follows", async ({ page }) => {
    // The progress bar must be the header's own edge, not a strip floating
    // over the page — and it must actually track the scroll.
    const inHeader = await page.evaluate(
      () => !!document.querySelector(".site-header .scroll-progress span"),
    );
    expect(inHeader, "the progress hairline must live inside the header").toBe(true);

    const fillAt = () =>
      page.evaluate(() => {
        const span = document.querySelector<HTMLElement>(".scroll-progress span")!;
        return new DOMMatrix(getComputedStyle(span).transform).a;
      });

    expect(await fillAt(), "empty at the top").toBeLessThan(0.05);

    // Park mid-journey: the fill must have grown, and the Journey nav link
    // must be lit while its section straddles the viewport centre.
    await page.evaluate(() => {
      const section = document.querySelector<HTMLElement>("#journey")!;
      window.scrollTo(0, section.offsetTop + section.offsetHeight / 2 - window.innerHeight / 2);
    });
    await page.waitForTimeout(900);

    expect(await fillAt(), "filled mid-page").toBeGreaterThan(0.3);
    await expect(page.locator('.nav a[href="#journey"]')).toHaveClass(/is-current/);
    // And only one section is current at a time.
    expect(await page.locator(".nav a.is-current").count()).toBe(1);
  });

  test("focus rings inside the mounted explorer stay unified", async ({ page }) => {
    // The extraction audit found the one defect a resting computed-style diff
    // cannot see: the chunk stylesheet loads after globals.css, so a colour it
    // declares on :focus-visible now wins ties it used to lose — and it won
    // them on only two of the four CareLens controls, splitting the focus
    // vocabulary. The chunk sheet now declares ring geometry only; the
    // interaction layer in globals.css owns the colour. This holds it there.
    await page.locator("#carelens").scrollIntoViewIfNeeded();
    await page.locator(".universe-interface").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(800);

    // Establish keyboard modality first: Chromium only lets a scripted
    // .focus() match :focus-visible when the last interaction was a key.
    // Without it the pseudo-class may never engage, every control reads its
    // UNFOCUSED outline colour, and "all rings equal" passes vacuously. The
    // engagement assertions below make that failure mode loud instead of
    // silent.
    await page.keyboard.press("Tab");

    const ringOf = async (selector: string) => {
      const target = page.locator(selector).first();
      await target.focus();
      const state = await target.evaluate((el) => ({
        engaged: el.matches(":focus-visible"),
        color: window.getComputedStyle(el).outlineColor,
        style: window.getComputedStyle(el).outlineStyle,
      }));
      // A guard that cannot tell "same colour" from "never focused" is not a
      // guard. Hard-fail if the mechanism did not engage.
      expect(state.engaged, `${selector} never matched :focus-visible`).toBe(true);
      expect(state.style, `${selector} has no visible ring`).toBe("solid");
      return state.color;
    };

    const rings = {
      tabs: await ringOf(".universe-tabs button"),
      toolbar: await ringOf(".anatomy-system-toolbar button"),
      dock: await ringOf(".universe-layer-dock button"),
    };

    // One vocabulary: whatever the interaction layer says, everyone says.
    expect(rings.toolbar, `toolbar ring ${rings.toolbar} vs tabs ${rings.tabs}`).toBe(rings.tabs);
    expect(rings.dock, `dock ring ${rings.dock} vs tabs ${rings.tabs}`).toBe(rings.tabs);
  });

  test("no always-on blur rides the sticky header for the whole page", async ({ page }) => {
    // A backdrop-filter on a sticky, full-width bar is recomposited every
    // frame of every scroll, on every page.
    expect(await styleOf(page, ".site-header", "backdrop-filter")).toBe("none");
    await wheelTo(page, 0.3);
    expect(await styleOf(page, ".site-header", "backdrop-filter")).toBe("none");
  });

  test("reduced motion leaves every section readable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator(".hero h1")).toBeVisible();
    await page.waitForTimeout(1_200);

    // The scroll context returns early under reduced motion, so nothing gets a
    // GSAP from-state. The one element whose hidden state lives in CSS has to
    // say so itself, or the footer rule stays invisible forever.
    for (const [selector, property] of [
      [".journey-grid article", "opacity"],
      [".location-card", "opacity"],
      [".final-cta > div", "opacity"],
      [".footer-brand", "opacity"],
    ] as const) {
      expect(
        await styleOf(page, selector, property),
        `${selector} must be visible with motion reduced`,
      ).toBe("1");
    }
    expect(
      await styleOf(page, ".footer-rule", "transform"),
      "the footer rule must be drawn, not stuck at scaleX(0)",
    ).not.toContain("matrix(0,");
  });
});
