import { expect, test } from "@playwright/test";

/**
 * The gaps this pass closed, over real HTTP.
 *
 * Each of these was named as still-open in the previous handoff rather than
 * quietly skipped, so each gets a test that would fail if it regressed.
 */

const CATALOGUE = "/api/clinic/catalogue";
const MFA = "/api/clinic/mfa";

test.describe("cancelling records why", () => {
  test("the staff list offers reasons only reception could know", async ({ request }) => {
    const body = (await (await request.get("/api/bookings?limit=1")).json()) as {
      cancellationReasons: Array<{ code: string; labelEn: string }>;
    };
    const codes = body.cancellationReasons.map((reason) => reason.code);
    expect(codes).toContain("no_contact");
    expect(codes).toContain("clinic_closed");
    // A patient's own motive is not reception's to record on their behalf.
    expect(codes).not.toContain("changed_mind");
    for (const reason of body.cancellationReasons) {
      expect(reason.labelEn.trim().length).toBeGreaterThan(0);
    }
  });

  test("a staff cancellation stores its reason and shows in the breakdown", async ({
    request,
  }) => {
    // A booking of our own, so no real appointment is disturbed.
    const availability = (await (
      await request.get("/api/availability?branch=Maadi&service=aesthetic")
    ).json()) as { dates: Array<{ date: string; slots: string[] }> };
    const day = availability.dates.find((item) => item.slots.length > 0);
    expect(day, "there should be a bookable slot").toBeTruthy();

    const hold = await request.post("/api/availability", {
      data: {
        branch: "Maadi",
        service: "aesthetic",
        slotDate: day!.date,
        slotTime: day!.slots[0],
      },
    });
    expect(hold.status()).toBe(201);
    const { holdToken } = (await hold.json()) as { holdToken: string };

    const confirmed = await request.post("/api/bookings", {
      data: {
        holdToken,
        patientName: `Cancellation reason ${Date.now()}`,
        patientPhone: "01000000123",
        consent: true,
      },
    });
    expect(confirmed.status()).toBe(201);
    const { booking } = (await confirmed.json()) as { booking: { id: string } };

    const cancelled = await request.patch(`/api/bookings/${booking.id}`, {
      data: { status: "cancelled", cancellationReason: "no_contact" },
    });
    expect(cancelled.status()).toBe(200);

    const summary = (await (await request.get("/api/bookings?limit=1")).json()) as {
      summary: { cancellationReasons: Array<{ reason: string | null; total: number }> };
    };
    const recorded = summary.summary.cancellationReasons.find(
      (row) => row.reason === "no_contact",
    );
    // "You lost 22 appointments" prompts nothing. "Eleven could not be reached"
    // prompts a look at how the clinic contacts people.
    expect(recorded, "the reason should appear in the breakdown").toBeTruthy();
    expect(recorded!.total).toBeGreaterThan(0);
  });

  test("an invented reason code is discarded rather than stored", async ({ request }) => {
    const availability = (await (
      await request.get("/api/availability?branch=Maadi&service=aesthetic")
    ).json()) as { dates: Array<{ date: string; slots: string[] }> };
    const day = availability.dates.find((item) => item.slots.length > 0)!;

    const hold = await request.post("/api/availability", {
      data: {
        branch: "Maadi",
        service: "aesthetic",
        slotDate: day.date,
        slotTime: day.slots[0],
      },
    });
    const { holdToken } = (await hold.json()) as { holdToken: string };
    const confirmed = await request.post("/api/bookings", {
      data: {
        holdToken,
        patientName: `Bad reason ${Date.now()}`,
        patientPhone: "01000000124",
        consent: true,
      },
    });
    const { booking } = (await confirmed.json()) as { booking: { id: string } };

    // Accepted as a cancellation, but the code is dropped — otherwise a
    // hand-crafted request could pollute a breakdown nobody can then interpret.
    const cancelled = await request.patch(`/api/bookings/${booking.id}`, {
      data: { status: "cancelled", cancellationReason: "because-i-said-so" },
    });
    expect(cancelled.status()).toBe(200);

    const summary = (await (await request.get("/api/bookings?limit=1")).json()) as {
      summary: { cancellationReasons: Array<{ reason: string | null; total: number }> };
    };
    expect(
      summary.summary.cancellationReasons.some((row) => row.reason === "because-i-said-so"),
    ).toBe(false);
  });

  test("the patient manage endpoint offers its own reason list", async ({ request }) => {
    const availability = (await (
      await request.get("/api/availability?branch=Maadi&service=aesthetic")
    ).json()) as { dates: Array<{ date: string; slots: string[] }> };
    const day = availability.dates.find((item) => item.slots.length > 0)!;
    const hold = await request.post("/api/availability", {
      data: {
        branch: "Maadi",
        service: "aesthetic",
        slotDate: day.date,
        slotTime: day.slots[0],
      },
    });
    const { holdToken } = (await hold.json()) as { holdToken: string };
    const confirmed = await request.post("/api/bookings", {
      data: {
        holdToken,
        patientName: `Patient reason ${Date.now()}`,
        patientPhone: "01000000125",
        consent: true,
      },
    });
    const { booking } = (await confirmed.json()) as {
      booking: { manageToken: string };
    };

    const manage = (await (
      await request.get(`/api/appointments/${booking.manageToken}`)
    ).json()) as {
      cancellationReasons: Array<{ code: string; labelEn: string; labelAr: string }>;
    };
    const codes = manage.cancellationReasons.map((reason) => reason.code);
    expect(codes).toContain("changed_mind");
    expect(codes).not.toContain("no_contact");
    // Both languages, because the patient chose one of them when they booked.
    for (const reason of manage.cancellationReasons) {
      expect(reason.labelAr.trim().length).toBeGreaterThan(0);
    }

    // A reason is optional and must never block a cancellation.
    const cancelled = await request.delete(`/api/appointments/${booking.manageToken}`, {
      data: { reason: "travelling" },
    });
    expect(cancelled.status()).toBe(200);
  });
});

test.describe("staff sessions are visible", () => {
  test("the security payload reports where this account is signed in", async ({ request }) => {
    const body = (await (await request.get(MFA)).json()) as {
      sessions: Array<{ id: string; device: string | null }>;
    };
    // Present whether or not any session is live — the page needs the shape.
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  test("ending an unknown session is refused rather than silently accepted", async ({
    request,
  }) => {
    const response = await request.post(MFA, {
      data: { action: "revoke_session", sessionId: "not-a-real-session" },
    });
    expect(response.status()).toBe(409);
  });

  test("a revoke with no id is a bad request", async ({ request }) => {
    const response = await request.post(MFA, { data: { action: "revoke_session" } });
    expect(response.status()).toBe(400);
  });
});

test.describe("practitioners can be added", () => {
  const NAME = "Dr. E2E Associate";
  let created = "";

  test.afterAll(async ({ request }) => {
    if (!created) return;
    await request.post(CATALOGUE, { data: { action: "remove_practitioner", id: created } });
  });

  test("a new practitioner appears and can hold a session", async ({ request }) => {
    const save = await request.post(CATALOGUE, {
      data: {
        action: "practitioner",
        nameEn: NAME,
        nameAr: "د. زميل",
        departmentId: "dental",
        titleEn: "Associate",
      },
    });
    expect(save.status()).toBe(200);

    const body = (await save.json()) as {
      practitioners: Array<{ id: string; name: string }>;
    };
    const person = body.practitioners.find((item) => item.name === NAME);
    expect(person, "the new practitioner should be listed").toBeTruthy();
    created = person!.id;
  });

  test("a practitioner with no line of care is refused", async ({ request }) => {
    const response = await request.post(CATALOGUE, {
      data: { action: "practitioner", nameEn: "Dr. Nobody", departmentId: "" },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).message).toMatch(/line of care/i);
  });

  test("removing a practitioner who still has sessions is refused with the count", async ({
    request,
  }) => {
    const response = await request.post(CATALOGUE, {
      data: { action: "remove_practitioner", id: "surgeon" },
    });
    expect(response.status()).toBe(400);
    // Cascading would withdraw every slot in their sessions from the booking page.
    expect((await response.json()).message).toMatch(/session/i);
  });

  test("reception cannot add a practitioner", async ({ request }) => {
    const RECEPTION = "e2e-hardening-reception@drashrafmetwally.com";
    await request.post("/api/clinic/staff", {
      data: {
        action: "invite",
        email: RECEPTION,
        displayName: "E2E hardening reception",
        roles: ["receptionist"],
      },
    });
    await request.post("/api/clinic/staff", {
      data: { action: "active", email: RECEPTION, active: true },
    });

    const response = await request.post(CATALOGUE, {
      headers: { "oai-authenticated-user-email": RECEPTION },
      data: {
        action: "practitioner",
        nameEn: "Dr. Sneaky",
        departmentId: "dental",
      },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).required).toBe("catalogue:write");

    await request.post("/api/clinic/staff", {
      data: { action: "active", email: RECEPTION, active: false },
    });
  });
});
