import { expect, test } from "@playwright/test";
import { cancelTestBooking, createTestBooking, liveAvailability } from "./helpers";

test.describe.serial("HTTP route contracts", () => {
  const readRoutes = [
    ["health", "/api/health", 200],
    ["availability", "/api/availability", 200],
    ["bookings dashboard", "/api/bookings", 200],
    ["audit", "/api/clinic/audit", 200],
    ["data request queue", "/api/clinic/data-requests", 200],
    ["notification operations", "/api/clinic/notifications", 200],
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

  test("mutation routes reject malformed or nonexistent work explicitly", async ({ request }) => {
    const cases = [
      request.post("/api/availability", { data: {} }),
      request.post("/api/bookings", { data: {} }),
      request.patch("/api/appointments/not-a-real-token", { data: {} }),
      request.delete("/api/appointments/not-a-real-token", {
        headers: { "Content-Type": "application/json" },
      }),
      request.patch("/api/bookings/not-a-real-id", { data: { status: "checked_in" } }),
      request.post("/api/clinic/appointments", { data: {} }),
      request.post("/api/clinic/notifications", { data: { action: "unknown" } }),
      request.post("/api/data-requests", { data: {} }),
    ];
    const responses = await Promise.all(cases);
    for (const response of responses) {
      expect([400, 404]).toContain(response.status());
      await expect(response.json()).resolves.toHaveProperty("message");
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
