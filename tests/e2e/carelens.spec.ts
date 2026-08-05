import { expect, test, type Page } from "@playwright/test";

/**
 * CareLens, driven in a real browser.
 *
 * The geometry is proved by arithmetic in `tests/carelens-geometry.test.mts`.
 * What that cannot prove is that the scene reaches the screen: the canvas sits
 * behind two dynamic imports and an IntersectionObserver, and any one of those
 * failing leaves a placeholder where the model should be — with nothing in the
 * console to say so.
 *
 * So these tests check the wiring and the accessible path, not the pixels.
 *
 * ## Why the timeout is raised
 *
 * Headless Chromium has no GPU, so WebGL runs through SWiftShader in software.
 * Compiling the physically based shaders and the pre-filtered environment map
 * that way takes tens of seconds, and tearing the context down afterwards takes
 * tens more — the suite's default 60s budget expires during teardown and every
 * test reports as failed with its assertions already passed. The work is real,
 * so the allowance is raised rather than the checks weakened.
 */
test.describe.configure({ timeout: 180_000 });

async function openCareLens(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  /**
   * The intro overlay has to be gone, not merely clicked.
   *
   * A first version checked `isVisible()` and clicked if so, which races the
   * overlay's own transition — the click lands, the element is still animating
   * out, and every later click is swallowed by `.intro-grid`. Waiting for the
   * overlay to be hidden is the pattern the rest of this suite already uses.
   */
  await page.getByRole("button", { name: /Skip introduction|تخطي المقدمة/ }).click();
  await expect(page.locator(".experience-intro")).toBeHidden({ timeout: 10_000 });

  await page.locator("#carelens").scrollIntoViewIfNeeded();
  return page.locator(".treatment-universe");
}

async function selectDental(universe: ReturnType<Page["locator"]>) {
  await universe
    .getByRole("group", { name: /care areas/i })
    .getByRole("button", { name: /dental/i })
    .click();
}

test("the explorer offers five areas, including Dental", async ({ page }) => {
  const universe = await openCareLens(page);
  const tabs = universe.getByRole("group", { name: /care areas/i }).getByRole("button");

  await expect(tabs).toHaveCount(5);
  await expect(tabs.nth(4)).toContainText("Dental");
});

test("Hair & scalp is absent from every CareLens control", async ({ page }) => {
  /**
   * The area was withdrawn before launch. Removing it from the content model is
   * not enough on its own — an icon rail, a region label or a bookable
   * procedure left behind advertises a consultation the booking form can no
   * longer take, and none of those would fail a unit test.
   */
  const universe = await openCareLens(page);

  for (const group of ["care areas", "quick care area selector", "anatomical regions"]) {
    const controls = universe.getByRole("group", { name: new RegExp(group, "i") });
    await expect(controls.getByRole("button", { name: /hair|scalp/i })).toHaveCount(0);
  }

  await expect(universe).not.toContainText(/hair & scalp/i);
});

test("the safety limitation stays visible beside the model", async ({ page }) => {
  const universe = await openCareLens(page);
  const note = universe.locator(".universe-safety-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText(/education/i);
  await expect(note).toContainText(/not a medical diagnosis/i);
  await expect(note).toContainText(/not.*guaranteed/i);
});

test("Body architecture exposes its abdominal and frame landmarks", async ({ page }) => {
  const universe = await openCareLens(page);
  await universe
    .getByRole("group", { name: /care areas/i })
    .getByRole("button", { name: /body architecture/i })
    .click();

  const regions = universe.getByRole("group", { name: /anatomical regions/i });
  await expect(regions.getByRole("button", { name: "Waist & flanks", exact: true })).toBeVisible();
  await universe.getByRole("button", { name: "Structure", exact: true }).click();
  await expect(regions.getByRole("button", { name: "Abdominal wall", exact: true })).toBeVisible();
  await expect(universe.locator(".universe-region-card")).toContainText(/Body contouring consultation/i);
});

test("the 3D scene mounts once it is scrolled into view", async ({ page }) => {
  await openCareLens(page);

  // Two dynamic boundaries and a viewport gate stand between the page and this
  // element. If any regresses the placeholder simply stays — the kind of silent
  // failure a size budget cannot catch.
  const canvas = page.locator(".universe-canvas canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  const live = await canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement;
    const gl = element.getContext("webgl2") ?? element.getContext("webgl");
    return {
      width: element.width,
      height: element.height,
      lost: gl ? (gl as WebGLRenderingContext).isContextLost() : true,
    };
  });

  expect(live.width).toBeGreaterThan(0);
  expect(live.height).toBeGreaterThan(0);
  expect(live.lost).toBe(false);
});

test("Dental exposes all three depths and its own vocabulary", async ({ page }) => {
  const universe = await openCareLens(page);
  await selectDental(universe);

  const depth = universe.getByRole("group", { name: /view depth/i });
  await expect(depth.getByRole("button")).toHaveCount(3);

  // The default hints describe a body. If Dental ever falls back to them it
  // tells a patient their teeth are "the shape you see in a mirror".
  const hint = universe.locator(".universe-depth-hint");
  await expect(hint).toContainText(/enamel/i);
  await expect(hint).not.toContainText(/mirror/i);
});

test("cutting deeper reveals regions that were not there before", async ({ page }) => {
  const universe = await openCareLens(page);
  await selectDental(universe);

  const regions = universe.getByRole("group", { name: /anatomical regions/i }).getByRole("button");
  const atSurface = await regions.allInnerTexts();

  await universe.getByRole("button", { name: "Skeleton", exact: true }).click();
  const atSkeleton = await regions.allInnerTexts();

  expect(atSkeleton.length).toBeGreaterThan(atSurface.length);
  expect(atSkeleton).toContain("Implants");
  // Surface regions stay. Losing the outline of what you were just looking at
  // is disorienting, so depth adds rather than replaces.
  expect(atSkeleton).toEqual(expect.arrayContaining(atSurface));
});

test("every region is reachable and described without the canvas", async ({ page }) => {
  const universe = await openCareLens(page);

  /**
   * The scene is hidden from assistive technology on purpose — a canvas cannot
   * describe itself, and a focusable one that announces nothing is worse than
   * one that is skipped. That makes the region rail the only path for a
   * keyboard or a screen reader, so it has to carry the whole content.
   *
   * The assertion is on the subtree rather than the element: react-three-fiber
   * spreads `<Canvas>` props onto a wrapper div, so `aria-hidden` sits one
   * level above the canvas and hides it by inheritance. Asserting on the canvas
   * node itself failed while the behaviour was perfectly correct.
   */
  const canvas = page.locator(".universe-canvas canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const hiddenFromAssistiveTech = await canvas.evaluate(
    (node) => node.closest('[aria-hidden="true"]') !== null,
  );
  expect(hiddenFromAssistiveTech).toBe(true);

  const regions = universe.getByRole("group", { name: /anatomical regions/i }).getByRole("button");
  const count = await regions.count();
  expect(count).toBeGreaterThan(1);

  /**
   * One region, not all of them.
   *
   * An earlier version clicked through every region in every area. Each click
   * re-renders the scene, and under software WebGL that costs seconds — the
   * test ran past three minutes and told us nothing the unit suite had not
   * already proved. `tests/anatomy.test.mts` checks the content of all 24
   * regions exhaustively and in milliseconds; what only a browser can show is
   * that clicking the rail actually drives the panel.
   */
  const last = regions.nth(count - 1);
  const label = (await last.innerText()).trim();
  await last.click();

  const card = universe.locator(".universe-region-card");
  await expect(card.locator("h4")).toHaveText(label);
  await expect(card.locator("p").first()).not.toBeEmpty();
  await expect(card).toContainText(/STRUCTURES/i);
});

test("the region rail is operable from the keyboard", async ({ page }) => {
  const universe = await openCareLens(page);
  const regions = universe.getByRole("group", { name: /anatomical regions/i }).getByRole("button");

  const second = regions.nth(1);
  const label = (await second.innerText()).trim();

  await second.focus();
  await expect(second).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(universe.locator(".universe-region-card h4")).toHaveText(label);
  await expect(second).toHaveAttribute("aria-pressed", "true");
});

test("switching area re-frames rather than stranding the camera", async ({ page }) => {
  const universe = await openCareLens(page);
  await expect(page.locator(".universe-canvas canvas")).toBeVisible({ timeout: 20_000 });

  // Dragging hands the camera to the viewer. Changing area has to take it back,
  // or the new area opens at whatever angle the last one was left at.
  const canvas = page.locator(".universe-canvas canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  // The hint retires once obeyed; a prompt that keeps asking for something
  // already done reads as decoration.
  await expect(universe.locator(".universe-rotate")).toHaveCount(0);

  await selectDental(universe);
  await expect(universe.locator(".universe-region-card h4")).toHaveText("Smile design");
});

test.describe("mobile CareLens", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the canvas leaves vertical gestures to the page", async ({ page }) => {
    await openCareLens(page);
    const canvas = page.locator(".universe-canvas canvas");
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect(canvas).toHaveCSS("touch-action", "pan-y");
  });

  test("the information sheet traps focus and restores it when dismissed", async ({ page }) => {
    const universe = await openCareLens(page);
    const trigger = universe.getByRole("button", { name: /brow & forehead/i });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: /anatomy information/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("button", { name: /close anatomy information/i })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
