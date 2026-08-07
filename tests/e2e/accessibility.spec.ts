import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cancelTestBooking, createTestBooking } from "./helpers";

const WCAG_21_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function dismissIntroduction(page: Page) {
  await page.waitForLoadState("networkidle");
  const skip = page.getByRole("button", { name: /Skip introduction|تخطي المقدمة/ });
  if (await skip.isVisible()) {
    await skip.click();
    await expect(page.locator(".experience-intro")).toBeHidden({ timeout: 10_000 });
  }
}

async function expectAccessible(
  page: Page,
  testInfo: TestInfo,
  name: string,
  include?: string,
) {
  let audit = new AxeBuilder({ page }).withTags(WCAG_21_AA);
  if (include) audit = audit.include(include);
  const results = await audit.analyze();

  if (results.violations.length > 0) {
    await testInfo.attach(`${name}-axe-results`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
  }

  const summary = results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => ({
      target: node.target.join(" "),
      message: node.failureSummary,
    })),
  }));
  expect(summary, `${name} has WCAG 2.1 AA violations`).toEqual([]);
}

test("English and Arabic patient experiences pass automated WCAG 2.1 AA checks", async ({
  page,
}, testInfo) => {
  for (const [path, language] of [
    ["/", "English"],
    ["/ar", "Arabic"],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    if (language === "English") {
      await expectAccessible(page, testInfo, "English introduction");
    }
    await dismissIntroduction(page);
    await expectAccessible(page, testInfo, `${language} patient experience`);
  }
});

test("patient and Clinic OS skip links move keyboard focus to their workspaces", async ({ page }) => {
  await page.goto("/");
  await dismissIntroduction(page);
  await page.keyboard.press("Tab");
  const patientSkip = page.getByRole("link", { name: "Skip to content" });
  await expect(patientSkip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#patient-content")).toBeFocused();

  await page.goto("/command-center");
  await page.keyboard.press("Tab");
  const clinicSkip = page.getByRole("link", { name: "Skip to clinic workspace" });
  await expect(clinicSkip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#clinic-content")).toBeFocused();

  const schedule = page.getByRole("button", { name: /Schedule/ });
  await schedule.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
});

test("CareLens remains readable and operable when its deferred interface mounts", async ({
  page,
}, testInfo) => {
  // Scan the stable authored colours, not a partially transparent reveal frame.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await dismissIntroduction(page);
  await page.locator("#carelens").scrollIntoViewIfNeeded();
  await expect(page.locator(".treatment-universe")).toBeVisible({ timeout: 15_000 });
  /**
   * Scoped to the Care areas rail: the quick toolbar over the canvas carries a
   * second "Nose & profile" button (same accessible name, by design — it is the
   * same control offered twice), so the bare role query is ambiguous under
   * strict mode. The rail is the keyboard path this test is exercising.
   */
  const nose = page
    .getByRole("group", { name: /care areas/i })
    .getByRole("button", { name: /Nose & profile/ });
  await expect(nose).toBeVisible();
  await expectAccessible(page, testInfo, "CareLens interface", "#carelens");

  await nose.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /balance from every angle/i })).toBeVisible();
});

test("booking dialog passes WCAG checks and preserves keyboard focus", async ({ page }, testInfo) => {
  /**
   * Audited with motion reduced, so the result does not depend on timing.
   *
   * This test failed roughly one run in four: CareLens fades its detail panel in
   * over 450ms, and a scan that landed mid-fade measured the *transitional*
   * opacity — 2.58:1 for a label whose authored colour is 7.95:1. The site's
   * global reduced-motion rule collapses that animation, so what is audited is
   * the colour the design actually specifies rather than a frame of it.
   */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await dismissIntroduction(page);

  const trigger = page.locator(".desktop-book");
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveAttribute("aria-label", "Close booking");
  await expectAccessible(page, testInfo, "booking dialog");

  const slot = dialog.locator(".slots button").first();
  await expect(slot).toBeEnabled({ timeout: 20_000 });
  await slot.click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByLabel("Full name")).toBeVisible();
  await expectAccessible(page, testInfo, "booking details");

  const released = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/availability") &&
      response.request().method() === "DELETE",
  );
  await page.keyboard.press("Escape");
  await expect((await released).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("appointment management and Clinic OS pass automated WCAG checks", async ({
  page,
  request,
}, testInfo) => {
  const booking = await createTestBooking(request, `Accessibility ${Date.now()}`);

  try {
    await page.goto(`/appointment/${booking.manageToken}`);
    await page.waitForLoadState("networkidle");
    await expectAccessible(page, testInfo, "appointment management");

    await page.goto("/command-center");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /Good .+/ })).toBeVisible();
    await expectAccessible(page, testInfo, "Clinic OS dashboard");

    /**
     * Status pills render only when the appointment table has rows, so this
     * scan has been measuring a dashboard with no pills in it. That is how the
     * confirmed pill sat at 3.81:1 and the cancelled at 3.82:1 while this suite
     * reported a clean pass — a green result over less surface than it looked.
     *
     * Mounting one of every variant makes the contrast of all five observable
     * on every run, independent of what happens to be in the local database.
     */
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.style.cssText = "display:flex;gap:8px;padding:12px";
      for (const variant of [
        "confirmed", "checked", "completed", "missed", "cancelled",
      ]) {
        const pill = document.createElement("span");
        pill.className = `status-pill status-pill--${variant}`;
        pill.textContent = variant;
        host.appendChild(pill);
      }
      (document.querySelector(".command-main") ?? document.body).appendChild(host);
    });
    await expectAccessible(page, testInfo, "Clinic OS status pills");

    await page.getByRole("button", { name: /Pilot/ }).click();
    await expect(page.getByRole("heading", { name: "Pilot Control" })).toBeVisible();
    await expectAccessible(page, testInfo, "Clinic OS Pilot Control");
  } finally {
    await cancelTestBooking(request, booking);
  }
});

/**
 * The practice overview, audited on its own.
 *
 * SVG is where accessibility quietly disappears: a picture carrying the whole
 * message, with no text alternative, and axis labels sized for density rather
 * than for reading. So the charts are audited mounted, and again with their
 * data tables open — those tables are the non-visual route to the same numbers
 * and are worthless if they are themselves inaccessible.
 *
 * Its own test rather than an addition to the Clinic OS one: five axe scans in
 * a single test exceeds the 60s timeout, and a slow test that fails on time
 * tells you nothing about accessibility.
 */
test("the practice overview and its charts pass automated WCAG 2.1 AA checks", async ({
  page,
}, testInfo) => {
  await page.goto("/command-center");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: /^Overview/ }).click();
  await expect(page.getByRole("heading", { name: /Is the practice growing/ })).toBeVisible();
  await expectAccessible(page, testInfo, "Clinic OS practice overview");

  // Each click renames the button to "Hide numbers", so a snapshot taken by
  // `.all()` goes stale after the first one and the rest never resolve. Open
  // whichever is still closed, until none are.
  let opened = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const next = page.getByRole("button", { name: "Show numbers" }).first();
    if ((await next.count()) === 0) break;
    await next.click();
    opened += 1;
  }
  expect(opened, "no chart offered its numbers as a table").toBeGreaterThan(0);
  await expectAccessible(page, testInfo, "Clinic OS overview data tables");
});

/**
 * The two-step screens, audited separately.
 *
 * These are the pages a member of staff meets when they are locked out and in a
 * hurry — the worst possible moment to hand somebody an unlabelled input or a
 * contrast failure.
 */
test("the two-step sign-in screens pass automated WCAG 2.1 AA checks", async ({
  page,
}, testInfo) => {
  await page.goto("/command-center/verify");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: /two-step code/i })).toBeVisible();
  await expectAccessible(page, testInfo, "Clinic OS two-step challenge");

  await page.goto("/command-center/security");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Two-step sign-in" })).toBeVisible();
  await expectAccessible(page, testInfo, "Clinic OS security settings");
});

/**
 * The clinic timetable editor.
 *
 * Dense, form-heavy, and the screen an owner uses least often — which is exactly
 * where an unlabelled select or a contrast failure survives unnoticed.
 */
test("the clinic hours editor passes automated WCAG 2.1 AA checks", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/command-center");
  await page.waitForLoadState("networkidle");
  await page.locator(".command-sidebar nav button").filter({ hasText: "Hours" }).click();
  await expect(page.getByRole("heading", { name: "The weekly rota" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: "Who consults here" })).toBeVisible();
  await expectAccessible(page, testInfo, "Clinic OS hours editor");

  // The session editor is a separate form that only exists once opened.
  await page.getByRole("button", { name: "Add a session" }).first().click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expectAccessible(page, testInfo, "Clinic OS session editor");
});

test("reduced-motion visitors enter without a decorative exit delay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const started = Date.now();
  await page.getByRole("button", { name: "Skip introduction" }).click();
  await expect(page.locator(".experience-intro")).toBeHidden({ timeout: 2_000 });
  expect(Date.now() - started).toBeLessThan(750);
});
