import { expect, test } from "@playwright/test";
import { createTestBooking } from "./helpers";

test("Clinic OS can find, check in, and cancel a real D1 appointment", async ({
  page,
  request,
}) => {
  const name = `Clinic Journey ${Date.now()}`;
  const booking = await createTestBooking(request, name);

  await page.goto("/command-center");
  await page.waitForLoadState("networkidle");
  await page.locator(".command-sidebar nav button").filter({ hasText: "Schedule" }).click();
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search appointments" }).fill(name);

  // Vinext development mode briefly retains prior RSC frames during a client
  // refresh. Scope to the one interactive row the receptionist can see.
  const row = page.locator(`[data-appointment-id="${booking.id}"]:visible`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "Show details" }).click();
  await row.getByRole("button", { name: "Check in" }).click();
  const currentStatus = row.locator(":scope > .row-main .status-pill");
  await expect(currentStatus).toHaveText("Checked in");

  await row.getByRole("button", { name: "Cancel visit" }).click();
  await expect(currentStatus).toHaveText("Cancelled");
});
