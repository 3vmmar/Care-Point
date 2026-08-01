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

  /**
   * Cancelling is two presses now, and deliberately so.
   *
   * It used to fire on a single click in a dense list where the wrong row is easy
   * to hit, and it recorded no reason. The first press reveals the reason picker
   * and doubles as the confirmation, so asking why costs nothing extra.
   */
  await row.getByRole("button", { name: "Cancel visit" }).click();
  const reason = row.getByLabel("Reason for cancelling");
  await expect(reason).toBeVisible();
  await reason.selectOption("no_contact");
  await row.getByRole("button", { name: "Confirm cancel" }).click();
  await expect(currentStatus).toHaveText("Cancelled");

  // And the reason is on the record, not just in the click.
  const summary = (await (await request.get("/api/bookings?limit=1")).json()) as {
    summary: { cancellationReasons: Array<{ reason: string | null; total: number }> };
  };
  expect(
    summary.summary.cancellationReasons.some((row) => row.reason === "no_contact"),
  ).toBe(true);
});

test("a receptionist can back out of a cancellation", async ({ page, request }) => {
  // The reason the confirm step exists: hitting Cancel on the wrong row in a busy
  // list must be recoverable without having to rebook the patient.
  const name = `Cancel Backout ${Date.now()}`;
  const booking = await createTestBooking(request, name);

  await page.goto("/command-center");
  await page.waitForLoadState("networkidle");
  await page.locator(".command-sidebar nav button").filter({ hasText: "Schedule" }).click();
  await page.getByRole("textbox", { name: "Search appointments" }).fill(name);

  const row = page.locator(`[data-appointment-id="${booking.id}"]:visible`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "Show details" }).click();
  await row.getByRole("button", { name: "Cancel visit" }).click();
  await row.getByRole("button", { name: "Keep it" }).click();

  // Still bookable, still theirs.
  await expect(row.locator(":scope > .row-main .status-pill")).not.toHaveText("Cancelled");
  await request.delete(`/api/appointments/${booking.manageToken}`, {
    headers: { "Content-Type": "application/json" },
  });
});
