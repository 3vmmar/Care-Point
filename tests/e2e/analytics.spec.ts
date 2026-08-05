import { expect, test } from "@playwright/test";
import { cancelTestBooking, createTestBooking } from "./helpers";

test("Insights fetches real analytics only when opened and responds to its filters", async ({
  page,
  request,
}) => {
  const booking = await createTestBooking(request, `Insights Patient ${Date.now()}`);
  const analyticsRequests: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.url().includes("/api/clinic/analytics")) {
      analyticsRequests.push(outgoing.url());
    }
  });

  try {
    await page.goto("/command-center");
    await expect(page.getByRole("heading", { name: /good (morning|afternoon|evening)/i })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(analyticsRequests, "historical queries must not run on the live day view").toHaveLength(0);

    const firstReport = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clinic/analytics?days=30") && response.status() === 200,
    );
    await page.locator(".command-sidebar nav button").filter({ hasText: "Insights" }).click();
    await firstReport;

    await expect(page.getByRole("heading", { name: "Practice insights" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What patients asked to book" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Not recorded in Clinic OS" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Clinical progress & outcomes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Before & after activity" })).toBeVisible();

    const longerWindow = page.waitForResponse(
      (response) =>
        response.url().includes("/api/clinic/analytics?days=90") && response.status() === 200,
    );
    await page.getByLabel("Reporting window").selectOption("90");
    await longerWindow;
    await expect(page.getByText("Appointments by week")).toBeVisible();

    const branchReport = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/clinic/analytics" &&
        url.searchParams.get("days") === "90" &&
        url.searchParams.get("branch") === booking.branch &&
        response.status() === 200
      );
    });
    await page.getByLabel("Filter by clinic").selectOption(booking.branch);
    await branchReport;

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Practice insights" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await cancelTestBooking(request, booking);
  }
});

test("Insights explains a data failure and retries without hiding coverage limits", async ({
  page,
}) => {
  let failNext = true;
  await page.route("**/api/clinic/analytics?*", async (route) => {
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Test analytics outage." }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/command-center");
  await expect(page.getByRole("heading", { name: /good (morning|afternoon|evening)/i })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.locator(".command-sidebar nav button").filter({ hasText: "Insights" }).click();
  await expect(page.locator(".analytics-error[role='alert']")).toContainText(
    "Test analytics outage.",
  );
  // Coverage limitations are facts about the data model, not a network error,
  // so they remain visible while aggregate counts are unavailable.
  await expect(page.getByRole("heading", { name: "Not recorded in Clinic OS" })).toBeVisible();

  const recovered = page.waitForResponse(
    (response) => response.url().includes("/api/clinic/analytics") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await recovered;
  await expect(page.getByRole("heading", { name: "Known patients in retained records" })).toBeVisible();
});
