import { expect, test, type Page } from "@playwright/test";

async function enterWithoutIntroduction(page: Page, path = "/") {
  await page.addInitScript(() => {
    window.localStorage.setItem("carepoint:intro-seen", "1");
  });
  await page.goto(path);
  await expect(page.locator(".experience-intro")).toBeHidden({ timeout: 10_000 });
}

test("Dental is a first-class bilingual navigation destination", async ({ page }) => {
  await enterWithoutIntroduction(page);
  const english = page.locator(".site-header").getByRole("link", {
    name: "Dental",
    exact: true,
  });
  await expect(english).toHaveAttribute("href", "/treatments/dental-care");

  await english.click();
  await expect(page).toHaveURL(/\/treatments\/dental-care$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Dental care & smile design",
  );
  await expect(page.locator(".treatment-credential")).toContainText(
    "Care Point dental team",
  );
  await expect(page.locator(".treatment-credential")).not.toContainText(
    "Dr. Ashraf",
  );

  await enterWithoutIntroduction(page, "/ar");
  const arabic = page.locator(".site-header").getByRole("link", {
    name: "الأسنان",
    exact: true,
  });
  await expect(arabic).toHaveAttribute("href", "/ar/treatments/dental-care");

  await page.setViewportSize({ width: 390, height: 844 });
  await enterWithoutIntroduction(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  const mobile = page.locator(".site-header").getByRole("link", {
    name: "Dental",
    exact: true,
  });
  await expect(mobile).toBeVisible();
  await expect(mobile).toHaveAttribute("href", "/treatments/dental-care");
});

test("deep links and explicit booking requests preselect their service", async ({ page }) => {
  await enterWithoutIntroduction(page, "/?book=dental-implant#book");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByLabel("Consultation type")).toHaveValue("dental-implant");

  await dialog.getByRole("button", { name: "Close booking" }).click();
  await expect(dialog).toBeHidden();

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("carepoint:open-booking", {
        detail: { serviceId: "dental-cosmetic" },
      }),
    );
  });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Consultation type")).toHaveValue("dental-cosmetic");
});

test("NOOR routes dental questions to a dental-team answer", async ({ page }) => {
  await enterWithoutIntroduction(page);
  await page.getByRole("button", { name: "Ask NOOR" }).first().click();

  const dialog = page.getByRole("dialog");
  await dialog
    .getByPlaceholder("Ask anything about your care...")
    .fill("Which dental visit should I choose for veneers?");
  await dialog.getByRole("button", { name: "Send" }).click();

  await expect(dialog).toContainText("Care Point dental team", { timeout: 5_000 });
  await expect(dialog).toContainText("only an examination can determine a plan");
});
