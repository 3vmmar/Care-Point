import { expect, test } from "@playwright/test";

/**
 * Signing in with an email and password, from the practice's own website.
 *
 * The front door, so these assertions are about what it gives away as much as what
 * it lets through. Every credential failure must look identical from outside, and
 * a wrong password must not be distinguishable from an address that was never here.
 *
 * Self-cleaning: the account is deactivated on the way out.
 */

const LOGIN = "/api/staff/login";
const ACCOUNT = "e2e-login@drashrafmetwally.com";
const PASSWORD = "tuesday rota in mohandessin";

test.describe.serial("staff sign-in", () => {
  test.beforeAll(async ({ request }) => {
    // The development principal is an owner, so it can create the account and
    // hand it a password to sign in with.
    await request.post("/api/clinic/staff", {
      data: {
        action: "invite",
        email: ACCOUNT,
        displayName: "E2E login",
        roles: ["receptionist"],
      },
    });
    await request.post("/api/clinic/staff", {
      data: { action: "active", email: ACCOUNT, active: true },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.post("/api/clinic/staff", {
      data: { action: "active", email: ACCOUNT, active: false },
    });
  });

  test("the sign-in page is on the main site and says who it is for", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    // A patient who lands here must not think they need an account to book.
    await expect(page.getByText(/if you are a patient/i)).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  });

  test("the footer offers it without advertising it to patients", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const link = page.locator('.site-footer a[href="/login"]');
    await expect(link).toHaveCount(1);
    // Last in the list, after the patient-facing links.
    const labels = await page.locator(".footer-links a").allTextContents();
    expect(labels[labels.length - 1]).toMatch(/staff sign-in/i);
  });

  test("an owner issues a temporary password that must be changed", async ({ request }) => {
    const issued = await request.post("/api/clinic/staff", {
      data: { action: "reset_password", email: ACCOUNT },
    });
    expect(issued.status()).toBe(200);
    const body = (await issued.json()) as {
      temporaryPassword: string;
      staff: Array<{ email: string; mustChangePassword: boolean }>;
    };
    // Unambiguous and grouped, because it gets read out over a phone.
    expect(body.temporaryPassword).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(
      body.staff.find((member) => member.email === ACCOUNT)?.mustChangePassword,
    ).toBe(true);

    // It works, and it says the holder has to replace it.
    const signIn = await request.post(LOGIN, {
      data: { email: ACCOUNT, password: body.temporaryPassword },
    });
    expect(signIn.status()).toBe(200);
    const session = (await signIn.json()) as { mustChangePassword: boolean; next: string };
    expect(session.mustChangePassword).toBe(true);
    expect(session.next).toBe("/command-center/security");
  });

  test("an owner cannot issue a password to themselves this way", async ({ request }) => {
    // Self-service goes through the form that asks for the current password, so a
    // borrowed session cannot mint a new credential for the account it borrowed.
    const response = await request.post("/api/clinic/staff", {
      data: { action: "reset_password", email: "dev@localhost" },
    });
    expect(response.status()).toBe(400);
  });

  test("the account holder replaces the temporary password", async ({ request }) => {
    const issued = await request.post("/api/clinic/staff", {
      data: { action: "reset_password", email: ACCOUNT },
    });
    const { temporaryPassword } = (await issued.json()) as { temporaryPassword: string };

    const changed = await request.post("/api/staff/password", {
      headers: { "oai-authenticated-user-email": ACCOUNT },
      data: { currentPassword: temporaryPassword, newPassword: PASSWORD },
    });
    expect(changed.status()).toBe(200);
    // The cookie is cleared, because the epoch moved.
    expect(changed.headers()["set-cookie"] ?? "").toContain("Max-Age=0");
  });

  test("signing in with the right password sets a session and points at the dashboard", async ({
    request,
  }) => {
    const response = await request.post(LOGIN, {
      data: { email: ACCOUNT, password: PASSWORD },
    });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { next: string; mfa: { required: boolean } };
    // With MFA off in development, the password alone is enough to land on the
    // dashboard. With it on, this would point at the code challenge instead.
    expect(body.next).toBe(body.mfa.required ? "/command-center/verify" : "/command-center");

    const cookie = response.headers()["set-cookie"] ?? "";
    expect(cookie).toContain("carepoint_staff_mfa=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  test("a wrong password and an unknown address are indistinguishable", async ({
    request,
  }) => {
    const wrong = await request.post(LOGIN, {
      data: { email: ACCOUNT, password: "not the right phrase at all" },
    });
    const unknown = await request.post(LOGIN, {
      data: { email: "nobody-here@drashrafmetwally.com", password: "not the right phrase at all" },
    });

    expect(wrong.status()).toBe(unknown.status());
    expect(wrong.status()).toBe(401);
    // Identical body, because the difference is exactly what an attacker wants in
    // order to turn the practice website into a target list.
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  test("an empty submission is refused before any hashing happens", async ({ request }) => {
    for (const data of [{}, { email: ACCOUNT }, { password: PASSWORD }]) {
      const response = await request.post(LOGIN, { data });
      expect(response.status()).toBe(400);
      expect((await response.json()).code).toBe("incomplete");
    }
  });

  test("the setup token cannot claim an account that already has a password", async ({
    request,
  }) => {
    // Without this, anyone holding the token could reset every break-glass owner.
    const response = await request.post(LOGIN, {
      data: { email: ACCOUNT, password: "a brand new phrase entirely", setupToken: "guess" },
    });
    // Falls through to a normal sign-in attempt, and fails as one.
    expect(response.status()).toBe(401);
  });

  test("signing out clears the cookie", async ({ request }) => {
    // The header is required even with no body: the CSRF guard rejects any
    // mutation that is not declared as JSON.
    const response = await request.delete(LOGIN, {
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["set-cookie"] ?? "").toContain("Max-Age=0");
  });

  test("a sign-out that does not declare itself as JSON is blocked", async ({ request }) => {
    // The CSRF control, confirmed rather than assumed — an HTML form cannot send
    // application/json, so this is the vector it closes.
    const response = await request.delete(LOGIN, {
      headers: { "Content-Type": "text/plain" },
    });
    expect(response.status()).toBe(403);
  });

  test("changing a password needs the current one", async ({ request }) => {
    const response = await request.post("/api/staff/password", {
      headers: { "oai-authenticated-user-email": ACCOUNT },
      data: { currentPassword: "wrong", newPassword: "another perfectly fine phrase" },
    });
    // A borrowed session must not be enough to lock the real owner out.
    expect(response.status()).toBe(401);
  });

  test("a new password is held to the strength rules", async ({ request }) => {
    const response = await request.post("/api/staff/password", {
      headers: { "oai-authenticated-user-email": ACCOUNT },
      data: { currentPassword: PASSWORD, newPassword: "short" },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).message).toMatch(/12 characters/i);
  });

  test("the new password cannot be the current one", async ({ request }) => {
    const response = await request.post("/api/staff/password", {
      headers: { "oai-authenticated-user-email": ACCOUNT },
      data: { currentPassword: PASSWORD, newPassword: PASSWORD },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).message).toMatch(/different/i);
  });
});

test.describe("the surface split still exists", () => {
  test("sign-in is classed as a staff route", async ({ request }) => {
    // On a `patient`-surface deployment this and /api/staff/* are refused at the
    // edge, so the split remains available even though the practice is running
    // one combined site. Asserted through `lib/surface.ts` in the unit suite; here
    // we only confirm the route is reachable on a combined deployment.
    expect((await request.get("/login")).status()).toBe(200);
  });
});
