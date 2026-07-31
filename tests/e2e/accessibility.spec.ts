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
  await expect(page.getByRole("button", { name: /Nose & profile/ })).toBeVisible();
  await expectAccessible(page, testInfo, "CareLens interface", "#carelens");

  const nose = page.getByRole("button", { name: /Nose & profile/ });
  await nose.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /balance from every angle/i })).toBeVisible();
});

test("booking dialog passes WCAG checks and preserves keyboard focus", async ({ page }, testInfo) => {
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
  } finally {
    await cancelTestBooking(request, booking);
  }
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
