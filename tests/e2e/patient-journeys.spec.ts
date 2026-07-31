import { expect, test } from "@playwright/test";
import { cancelTestBooking, createTestBooking } from "./helpers";

test("English booking completes in the browser and can be cancelled from its manage page", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Skip introduction|تخطي المقدمة/ }).click();
  await expect(page.locator(".experience-intro")).toBeHidden({ timeout: 10_000 });
  await page.locator(".desktop-book").click();
  const modal = page.locator(".booking-modal");
  await expect(modal).toHaveAttribute("dir", "ltr");

  const slot = modal.locator(".slots button").first();
  await expect(slot).toBeEnabled({ timeout: 20_000 });
  await slot.click();
  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.getByLabel("Full name").fill("Browser Booking Patient");
  await modal.getByLabel("Mobile number").fill("+201007770001");
  await modal.getByLabel("Email (optional)").fill("browser@example.test");
  await modal.locator('input[name="consent"]').check();
  await modal.getByRole("button", { name: "Confirm appointment" }).click();

  await expect(modal.getByRole("heading", { name: "Your visit is reserved." })).toBeVisible();
  const manageHref = await modal.getByRole("link", { name: "Manage this booking" }).getAttribute("href");
  expect(manageHref).toMatch(/^\/appointment\//);

  await page.goto(manageHref!);
  await page.getByRole("button", { name: "Cancel appointment" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByRole("status")).toContainText("Your appointment is cancelled");

  const token = manageHref!.split("/").pop()!;
  await cancelTestBooking(request, { manageToken: token });
});

test("patient self-service reschedules a confirmed appointment in the browser", async ({
  page,
  request,
}) => {
  const booking = await createTestBooking(request, "Browser Reschedule Patient");
  await page.goto(`/appointment/${booking.manageToken}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Change time" }).click();
  await expect(page.locator(".manage-reschedule")).toBeVisible();

  const slot = page.locator(".manage-slots button").first();
  await expect(slot).toBeEnabled({ timeout: 20_000 });
  await slot.click();
  await page.getByRole("button", { name: "Confirm new time" }).click();
  await expect(page.getByRole("status")).toContainText("Your appointment has been moved");

  await cancelTestBooking(request, booking);
});

test("the Arabic experience and booking surface are genuinely RTL", async ({ page }) => {
  await page.goto("/ar");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByRole("button", { name: /Skip introduction|تخطي المقدمة/ }).click();
  await expect(page.locator(".experience-intro")).toBeHidden({ timeout: 10_000 });
  await page.locator(".desktop-book").click();
  await expect(page.locator(".booking-modal")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "اختر الموعد المناسب." })).toBeVisible();
});
