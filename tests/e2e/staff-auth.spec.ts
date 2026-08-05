import { expect, test } from "@playwright/test";
import { totp } from "../../lib/totp.ts";

/**
 * The second factor over real HTTP, against the running Worker.
 *
 * The integration suite proves the storage and the node suite proves the
 * algorithm; what neither can see is the part that only exists in a response —
 * the cookie attributes, the status codes, whether a refusal is machine-readable,
 * and whether the whole enrolment round trip actually works end to end.
 *
 * The run is self-cleaning: it finishes by resetting the account it enrolled, so
 * the suite can be run twice in a row. Lockout is deliberately left to the
 * integration suite, because a locked account would persist for fifteen minutes
 * and make this file flaky.
 */

const MFA = "/api/clinic/mfa";

/**
 * The account this file enrols.
 *
 * Deliberately its own, addressed through the proxy identity header, rather than
 * the unauthenticated development account. The spec then owns every bit of state
 * it touches — it can clear the account before it starts and after it finishes,
 * so the suite gives the same result on the second run as on the first, and a
 * developer's own local enrolment is left alone.
 */
const ACCOUNT = "e2e-mfa@drashrafmetwally.com";
const AS_ACCOUNT = { "oai-authenticated-user-email": ACCOUNT };

test.describe.serial("staff two-step sign-in", () => {
  let secret = "";
  let recoveryCodes: string[] = [];

  test.beforeAll(async ({ request }) => {
    // The development principal is an owner, so it can create the account and
    // clear any factor a previous run left behind.
    await request.post("/api/clinic/staff", {
      data: {
        action: "invite",
        email: ACCOUNT,
        displayName: "E2E two-step",
        roles: ["receptionist"],
      },
    });
    await request.post("/api/clinic/staff", {
      data: { action: "active", email: ACCOUNT, active: true },
    });
    await request.post("/api/clinic/staff", {
      data: { action: "reset_mfa", email: ACCOUNT },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.post("/api/clinic/staff", {
      data: { action: "reset_mfa", email: ACCOUNT },
    });
    await request.post("/api/clinic/staff", {
      data: { action: "active", email: ACCOUNT, active: false },
    });
  });

  test("reports the current state before anything is set up", async ({ request }) => {
    const response = await request.get(MFA, { headers: AS_ACCOUNT });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toMatch(/no-store/);

    const body = await response.json();
    expect(body.email).toBe(ACCOUNT);
    expect(body.enrolled).toBe(false);
    expect(typeof body.sessionHours).toBe("number");
    // Whether the deployment can actually store a secret is surfaced, so a
    // missing key shows on the page rather than failing on first enrolment.
    expect(body.configured).toMatchObject({
      encryptionKey: expect.any(Boolean),
      sessionSecret: expect.any(Boolean),
    });
  });

  test("issues a secret and an otpauth URI the authenticator can consume", async ({
    request,
  }) => {
    const response = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "enrol" },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    secret = body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    const uri = new URL(body.uri);
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(decodeURIComponent(uri.pathname)).toContain(ACCOUNT);
  });

  test("a wrong code does not complete enrolment", async ({ request }) => {
    const response = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "confirm", code: "000000" },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("bad-code");

    // Still not enrolled: a failed confirmation must not half-activate a factor.
    const state = await (await request.get(MFA, { headers: AS_ACCOUNT })).json();
    expect(state.enrolled).toBe(false);
    expect(state.pending).toBe(true);
  });

  test("a real code completes enrolment, returns recovery codes, and sets the session", async ({
    request,
  }) => {
    const response = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "confirm", code: await totp(secret) },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    recoveryCodes = body.recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);

    // The cookie is the whole point of this endpoint, and its attributes are the
    // difference between a session and a session anyone can steal or forge.
    const setCookie = response.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("carepoint_staff_mfa=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toMatch(/Max-Age=\d+/);

    const state = await (await request.get(MFA, { headers: AS_ACCOUNT })).json();
    expect(state.enrolled).toBe(true);
    expect(state.recoveryCodesRemaining).toBe(10);
  });

  test("re-enrolling over a working factor is refused", async ({ request }) => {
    // Otherwise whoever holds a borrowed session simply swaps the factor for
    // their own and locks the real staff member out.
    const response = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "enrol" },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe("already_enrolled");
  });

  test("a recovery code signs in and is then spent", async ({ request }) => {
    const code = recoveryCodes[0];
    const first = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "verify", code },
    });
    expect(first.status()).toBe(200);
    expect((await first.json()).usedRecoveryCode).toBe(true);
    expect(first.headers()["set-cookie"] ?? "").toContain("carepoint_staff_mfa=");

    const replay = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "verify", code },
    });
    expect(replay.status()).toBe(400);

    const state = await (await request.get(MFA, { headers: AS_ACCOUNT })).json();
    expect(state.recoveryCodesRemaining).toBe(9);
  });

  test("a wrong code is refused with a countable reason", async ({ request }) => {
    const response = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "verify", code: "000000" },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("bad-code");
    // The remaining-attempts count is what lets the page warn before the lockout.
    expect(typeof body.attemptsRemaining).toBe("number");
  });

  test("an unknown action is rejected rather than ignored", async ({ request }) => {
    const response = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "elevate" },
    });
    expect(response.status()).toBe(400);
  });

  test("resetting with a recovery code clears the factor and the cookie", async ({
    request,
  }) => {
    const response = await request.post(MFA, {
      headers: AS_ACCOUNT,
      data: { action: "reset", code: recoveryCodes[1] },
    });
    expect(response.status()).toBe(200);

    // The reset bumped the session epoch, so the cookie it clears could only ever
    // be refused from here on.
    const setCookie = response.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("carepoint_staff_mfa=;");
    expect(setCookie).toContain("Max-Age=0");

    const state = await (await request.get(MFA, { headers: AS_ACCOUNT })).json();
    expect(state.enrolled).toBe(false);
    expect(state.recoveryCodesRemaining).toBe(0);
  });
});

test.describe("staff directory and bulk export", () => {
  test("the directory lists roles with their descriptions", async ({ request }) => {
    const response = await request.get("/api/clinic/staff");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.roles.map((role: { id: string }) => role.id)).toEqual([
      "owner",
      "doctor",
      "receptionist",
      "privacy_admin",
      "auditor",
    ]);
    for (const role of body.roles) {
      expect(role.label).toBeTruthy();
      expect(role.detail).toBeTruthy();
    }
    expect(typeof body.canManage).toBe("boolean");
  });

  test("a staff change with no recognised action is refused", async ({ request }) => {
    const response = await request.post("/api/clinic/staff", {
      data: { action: "promote", email: "x@y.z" },
    });
    expect(response.status()).toBe(400);
  });

  test("adding somebody with no valid email is refused", async ({ request }) => {
    const response = await request.post("/api/clinic/staff", {
      data: { action: "invite", email: "not-an-email", displayName: "X", roles: ["auditor"] },
    });
    expect(response.status()).toBe(400);
  });

  test("the export is served as a downloadable CSV Excel can read", async ({ request }) => {
    const response = await request.get("/api/clinic/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["cache-control"]).toMatch(/no-store/);

    const body = await response.text();
    // The byte-order mark is what stops Excel rendering Arabic names as mojibake.
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain('"Patient"');
    expect(body).toContain('"Phone"');
    expect(body).toContain('"Treatment category"');
    expect(body).toContain('"Practitioner"');
  });

  test("the export is recorded in the access log", async ({ request }) => {
    await request.get("/api/clinic/export");
    const audit = await (await request.get("/api/clinic/audit?limit=25")).json();
    const exported = audit.entries.find(
      (entry: { action: string; detail: string | null }) =>
        entry.action === "export" && (entry.detail ?? "").includes("csv export"),
    );
    // A file assembled in the browser left no trace of who took a copy of the
    // register. This is the reason the export moved to the server.
    expect(exported).toBeTruthy();
  });

  test("the audit endpoint returns the security trail alongside patient access", async ({
    request,
  }) => {
    const response = await request.get("/api/clinic/audit?limit=50");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.entries)).toBe(true);
    // Authentication events matter even when no patient record was reached —
    // which is exactly the case during an attack.
    expect(Array.isArray(body.security)).toBe(true);
  });
});

/**
 * Role enforcement over real HTTP, using the identity header the proxy injects.
 *
 * Presenting the header makes the Worker take the production identity path — it
 * resolves the directory row and applies that person's roles — rather than the
 * unauthenticated development shortcut. So this is the actual boundary being
 * tested, not a simulation of it.
 *
 * Locally the header is believed because `lib/trusted-proxy.ts` only strips it
 * when a secret *is* configured. In production it is stripped at the edge unless
 * the request proves it came through the proxy, which is what stops anyone from
 * doing exactly what this test does.
 */
test.describe.serial("what a role is refused", () => {
  const AUDITOR = "e2e-auditor@drashrafmetwally.com";
  const RECEPTION = "e2e-reception@drashrafmetwally.com";
  const as = (email: string) => ({ "oai-authenticated-user-email": email });

  test.beforeAll(async ({ request }) => {
    for (const [email, role] of [
      [AUDITOR, "auditor"],
      [RECEPTION, "receptionist"],
    ] as const) {
      const response = await request.post("/api/clinic/staff", {
        data: { action: "invite", email, displayName: `E2E ${role}`, roles: [role] },
      });
      expect(response.status()).toBe(200);
      // Adding somebody does not reactivate them — that is deliberate, so an
      // owner correcting a name cannot silently restore access to a former
      // colleague. A previous run left these deactivated, so say it explicitly.
      await request.post("/api/clinic/staff", {
        data: { action: "active", email, active: true },
      });
    }
  });

  test.afterAll(async ({ request }) => {
    // Deactivating rather than deleting, which is all the API offers — and is the
    // behaviour the practice actually wants for somebody who leaves.
    for (const email of [AUDITOR, RECEPTION]) {
      await request.post("/api/clinic/staff", {
        data: { action: "active", email, active: false },
      });
    }
  });

  test("an auditor is refused every patient endpoint", async ({ request }) => {
    for (const path of ["/api/bookings", "/api/clinic/export"]) {
      const response = await request.get(path, { headers: as(AUDITOR) });
      expect(response.status(), path).toBe(403);
      const body = await response.json();
      expect(body.code).toBe("forbidden");
      // The response names what was missing, so the dashboard can explain itself.
      expect(body.required).toBeTruthy();
      // And it carries no patient data whatsoever.
      expect(JSON.stringify(body)).not.toContain("patientPhone");
    }
  });

  test("an auditor can still read the log they exist to read", async ({ request }) => {
    const response = await request.get("/api/clinic/audit", { headers: as(AUDITOR) });
    expect(response.status()).toBe(200);
  });

  test("reception can read patients but cannot export the register", async ({ request }) => {
    const list = await request.get("/api/bookings", { headers: as(RECEPTION) });
    expect(list.status()).toBe(200);

    // The single distinction the receptionist role exists to draw.
    const exported = await request.get("/api/clinic/export", { headers: as(RECEPTION) });
    expect(exported.status()).toBe(403);
    expect((await exported.json()).required).toBe("patient:export");
  });

  test("reception cannot fulfil a data request or administer staff", async ({ request }) => {
    const erase = await request.post("/api/clinic/data-requests", {
      headers: as(RECEPTION),
      data: { id: "whatever", action: "fulfil" },
    });
    expect(erase.status()).toBe(403);
    expect((await erase.json()).required).toBe("dsr:fulfil");

    const promote = await request.post("/api/clinic/staff", {
      headers: as(RECEPTION),
      data: { action: "roles", email: RECEPTION, roles: ["owner"] },
    });
    // The privilege-escalation attempt: reception granting itself owner.
    expect(promote.status()).toBe(403);
    expect((await promote.json()).required).toBe("staff:write");
  });

  test("an authenticated stranger is refused outright", async ({ request }) => {
    const response = await request.get("/api/bookings", {
      headers: as("stranger@example.com"),
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe("not_staff");
  });

  test("somebody who has left loses access immediately", async ({ request }) => {
    await request.post("/api/clinic/staff", {
      data: { action: "active", email: RECEPTION, active: false },
    });
    const response = await request.get("/api/bookings", { headers: as(RECEPTION) });
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe("account_inactive");

    await request.post("/api/clinic/staff", {
      data: { action: "active", email: RECEPTION, active: true },
    });
    expect((await request.get("/api/bookings", { headers: as(RECEPTION) })).status()).toBe(200);
  });

  test("refusals are recorded in the security trail", async ({ request }) => {
    await request.get("/api/clinic/export", { headers: as(AUDITOR) });
    const audit = await (await request.get("/api/clinic/audit?limit=100")).json();
    const denied = audit.security.find(
      (event: { event: string; actor: string; detail: string | null }) =>
        event.event === "access_denied" &&
        event.actor === AUDITOR &&
        (event.detail ?? "").includes("patient:export"),
    );
    // Without this, the only trace of somebody probing the dashboard is nothing.
    expect(denied).toBeTruthy();
  });
});
