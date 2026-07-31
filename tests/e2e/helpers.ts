import { expect, type APIRequestContext } from "@playwright/test";

type Availability = {
  branch: string;
  service: string;
  dates: Array<{ date: string; slots: string[] }>;
};

export type TestBooking = {
  id: string;
  holdToken: string;
  manageToken: string;
  manageUrl: string;
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
};

export async function liveAvailability(request: APIRequestContext): Promise<Availability> {
  const response = await request.get("/api/availability");
  expect(response.status()).toBe(200);
  return (await response.json()) as Availability;
}

export async function createTestBooking(
  request: APIRequestContext,
  patientName: string,
): Promise<TestBooking> {
  const availability = await liveAvailability(request);
  const candidates = availability.dates.flatMap((day) =>
    day.slots.map((slotTime) => ({ slotDate: day.date, slotTime })),
  );

  for (const candidate of candidates) {
    const holdResponse = await request.post("/api/availability", {
      headers: { "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
      data: {
        branch: availability.branch,
        service: availability.service,
        ...candidate,
      },
    });
    if (holdResponse.status() === 409) continue;
    expect(holdResponse.status()).toBe(201);
    const hold = (await holdResponse.json()) as { holdToken: string };

    const confirmation = await request.post("/api/bookings", {
      data: {
        holdToken: hold.holdToken,
        patientName,
        patientPhone: "+201001234567",
        patientEmail: "phase4@example.test",
        consent: true,
        language: "en",
      },
    });
    expect(confirmation.status()).toBe(201);
    const body = (await confirmation.json()) as {
      booking: {
        id: string;
        manageToken: string;
        manageUrl: string;
      };
    };

    return {
      ...body.booking,
      holdToken: hold.holdToken,
      branch: availability.branch,
      service: availability.service,
      ...candidate,
    };
  }

  throw new Error("No free appointment remained for the browser test.");
}

export async function cancelTestBooking(
  request: APIRequestContext,
  booking: Pick<TestBooking, "manageToken">,
) {
  const response = await request.delete(`/api/appointments/${booking.manageToken}`, {
    headers: { "Content-Type": "application/json" },
  });
  expect([200, 409]).toContain(response.status());
}
