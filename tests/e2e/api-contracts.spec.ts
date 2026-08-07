import { expect, test } from "@playwright/test";
import { cancelTestBooking, createTestBooking, liveAvailability } from "./helpers";

test.describe.serial("HTTP route contracts", () => {
  const readRoutes = [
    ["health", "/api/health", 200],
    ["availability", "/api/availability", 200],
    ["bookings dashboard", "/api/bookings", 200],
    ["clinic analytics", "/api/clinic/analytics?days=30", 200],
    ["clinic growth", "/api/clinic/growth?days=30", 200],
    ["clinic growth rejects an unsupported window", "/api/clinic/growth?days=45", 400],
    ["audit", "/api/clinic/audit", 200],
    ["data request queue", "/api/clinic/data-requests", 200],
    ["notification operations", "/api/clinic/notifications", 200],
    ["pilot control", "/api/clinic/pilot", 200],
    ["missing managed appointment", "/api/appointments/not-a-real-token", 404],
    ["missing calendar invite", "/api/appointments/not-a-real-token/calendar", 404],
    ["missing history", "/api/bookings/not-a-real-id/history", 404],
  ] as const;

  for (const [name, path, status] of readRoutes) {
    test(`GET ${name}`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(status);
      expect(response.headers()["cache-control"]).toMatch(/no-store|private|max-age=0/i);
    });
  }

  test("public availability exposes the same active Dental catalogue used by staff", async ({ request }) => {
    const response = await request.get("/api/availability?service=dental-check");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      service: string;
      catalogue: {
        revision: string;
        branches: Array<{ id: string }>;
        services: Array<{ id: string; category: string }>;
      };
    };

    expect(body.service).toBe("dental-check");
    expect(body.catalogue.revision).toBeTruthy();
    expect(body.catalogue.branches.length).toBeGreaterThan(0);
    expect(body.catalogue.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dental-check", category: "dental" }),
        expect.objectContaining({ id: "dental-cosmetic", category: "dental" }),
        expect.objectContaining({ id: "dental-implant", category: "dental" }),
      ]),
    );
  });

  test("mutation routes reject malformed or nonexistent work explicitly", async ({ request }) => {
    const cases = [
      request.post("/api/availability", { data: {} }),
      request.delete("/api/availability", { data: {} }),
      request.post("/api/bookings", { data: {} }),
      request.patch("/api/appointments/not-a-real-token", { data: {} }),
      request.delete("/api/appointments/not-a-real-token", {
        headers: { "Content-Type": "application/json" },
      }),
      request.patch("/api/bookings/not-a-real-id", { data: { status: "checked_in" } }),
      request.post("/api/clinic/appointments", { data: {} }),
      request.post("/api/clinic/notifications", { data: { action: "unknown" } }),
      request.patch("/api/clinic/pilot", { data: { action: "unknown" } }),
      request.post("/api/data-requests", { data: {} }),
    ];
    const responses = await Promise.all(cases);
    for (const response of responses) {
      expect([400, 404]).toContain(response.status());
      await expect(response.json()).resolves.toHaveProperty("message");
    }
  });

  test("pilot mode bounds public booking to one branch and can pause new holds", async ({ request }) => {
    const originalResponse = await request.get("/api/clinic/pilot");
    expect(originalResponse.status()).toBe(200);
    const original = (await originalResponse.json()) as {
      settings: {
        status: string;
        branchId: string | null;
        startDate: string | null;
        endDate: string | null;
        decision: string;
        decisionNote: string | null;
      };
      checklist: Array<{ key: string; completed: boolean; note: string | null }>;
    };
    const branches = ["Maadi", "Mohandessin"];

    try {
      for (const item of original.checklist) {
        const response = await request.patch("/api/clinic/pilot", {
          data: { action: "checklist", key: item.key, completed: true, note: "Browser test" },
        });
        expect(response.status()).toBe(200);
      }
      const running = await request.patch("/api/clinic/pilot", {
        data: {
          action: "configure",
          status: "running",
          branchId: branches[1],
          startDate: "2026-08-01",
          endDate: "2026-08-29",
          decision: "pending",
        },
      });
      expect(running.status()).toBe(200);

      const bounded = await request.get(`/api/availability?branch=${branches[0]}`);
      expect(bounded.status()).toBe(200);
      const boundedBody = (await bounded.json()) as {
        branch: string;
        availableBranchIds: string[];
        pilot: { status: string; branchId: string };
      };
      expect(boundedBody.branch).toBe(branches[1]);
      expect(boundedBody.availableBranchIds).toEqual([branches[1]]);
      expect(boundedBody.pilot.status).toBe("running");

      const wrongBranch = await request.post("/api/availability", {
        data: { branch: branches[0], service: "aesthetic", slotDate: "2026-08-10", slotTime: "10:00" },
      });
      expect(wrongBranch.status()).toBe(409);

      const paused = await request.patch("/api/clinic/pilot", {
        data: {
          action: "configure",
          status: "paused",
          branchId: branches[1],
          startDate: "2026-08-01",
          endDate: "2026-08-29",
          decision: "pending",
        },
      });
      expect(paused.status()).toBe(200);
      const unavailable = await request.get("/api/availability");
      const unavailableBody = (await unavailable.json()) as { bookingPaused: boolean };
      expect(unavailableBody.bookingPaused).toBe(true);
    } finally {
      await request.patch("/api/clinic/pilot", {
        data: { action: "configure", ...original.settings },
      });
      for (const item of original.checklist) {
        await request.patch("/api/clinic/pilot", {
          data: {
            action: "checklist",
            key: item.key,
            completed: item.completed,
            note: item.note,
          },
        });
      }
    }
  });

  test("ten parallel HTTP holds produce one 201 and nine 409 responses", async ({ request }) => {
    const availability = await liveAvailability(request);
    const day = availability.dates.find((candidate) => candidate.slots.length > 0);
    expect(day).toBeTruthy();
    const slotTime = day!.slots[0];

    const racers = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request.post("/api/availability", {
          headers: { "cf-connecting-ip": `203.0.113.${index + 1}` },
          data: {
            branch: availability.branch,
            service: availability.service,
            slotDate: day!.date,
            slotTime,
          },
        }),
      ),
    );
    const statuses = racers.map((response) => response.status()).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(9);

    const winner = racers.find((response) => response.status() === 201)!;
    const hold = (await winner.json()) as { holdToken: string };
    const details = {
      holdToken: hold.holdToken,
      patientName: "HTTP Race Winner",
      patientPhone: "+201000001111",
      consent: true,
      language: "en",
    };
    const first = await request.post("/api/bookings", { data: details });
    const repeated = await request.post("/api/bookings", { data: details });
    expect(first.status()).toBe(201);
    expect(repeated.status()).toBe(201);
    const firstBody = (await first.json()) as { booking: TestBookingShape };
    const repeatedBody = (await repeated.json()) as { booking: TestBookingShape };
    expect(repeatedBody.booking.id).toBe(firstBody.booking.id);

    await cancelTestBooking(request, firstBody.booking);
    const refreshed = await liveAvailability(request);
    expect(
      refreshed.dates.find((candidate) => candidate.date === day!.date)?.slots,
    ).toContain(slotTime);
  });

  test("the complete public lifecycle supports move and cancel", async ({ request }) => {
    const booking = await createTestBooking(request, "API Lifecycle Patient");
    const availability = await liveAvailability(request);
    const destination = availability.dates
      .flatMap((day) => day.slots.map((slotTime) => ({ slotDate: day.date, slotTime })))
      .find(
        (candidate) =>
          candidate.slotDate !== booking.slotDate || candidate.slotTime !== booking.slotTime,
      );
    expect(destination).toBeTruthy();

    const moved = await request.patch(`/api/appointments/${booking.manageToken}`, {
      data: destination,
    });
    expect(moved.status()).toBe(200);
    const loaded = await request.get(`/api/appointments/${booking.manageToken}`);
    expect(loaded.status()).toBe(200);
    const loadedBody = (await loaded.json()) as { appointment: { slotTime: string } };
    expect(loadedBody.appointment.slotTime).toBe(destination!.slotTime);

    await cancelTestBooking(request, booking);
  });
});

type TestBookingShape = {
  id: string;
  manageToken: string;
};
