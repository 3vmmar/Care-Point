import { expect, test } from "@playwright/test";

/**
 * The clinic changing its own opening hours, end to end.
 *
 * This is the point of moving the rota into D1, so this is the test that decides
 * whether it worked: an edit made through the staff API has to reach the *public*
 * booking calendar, in the same process, without a deploy. Everything else about
 * the catalogue is covered against real D1 in the integration suite.
 *
 * Self-cleaning: the original hours are restored at the end, so the suite can be
 * run repeatedly and the other specs still see the seeded timetable.
 */

const CATALOGUE = "/api/clinic/catalogue";

type Session = {
  id: string;
  branchId: string;
  practitionerId: string;
  weekday: number;
  start: string;
  end: string;
  interval: number;
  categories: string[];
};

test.describe.serial("the clinic edits its own hours", () => {
  /** The Maadi Sunday surgeon sitting, 16:00–21:00 in the seeded rota. */
  let original: Session | undefined;

  async function maadiSunday(request: import("@playwright/test").APIRequestContext) {
    const body = (await (await request.get(CATALOGUE)).json()) as { sessions: Session[] };
    return body.sessions.find(
      (session) =>
        session.branchId === "Maadi" &&
        session.weekday === 0 &&
        session.practitionerId === "surgeon",
    );
  }

  /** First offered Sunday slot for a Maadi aesthetic consultation, from the public API. */
  async function firstPublicSunday(request: import("@playwright/test").APIRequestContext) {
    const response = await request.get("/api/availability?branch=Maadi&service=aesthetic");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      dates: Array<{ date: string; slots: string[] }>;
    };
    const sunday = body.dates.find(
      (day) =>
        day.slots.length > 0 && new Date(`${day.date}T12:00:00Z`).getUTCDay() === 0,
    );
    return sunday ? { date: sunday.date, slots: sunday.slots } : null;
  }

  test.beforeAll(async ({ request }) => {
    original = await maadiSunday(request);
    expect(original, "the seeded Maadi Sunday session should exist").toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    if (!original) return;
    await request.post(CATALOGUE, {
      data: { action: "session", ...original },
    });
  });

  test("the timetable is served with row ids and no structural problems", async ({
    request,
  }) => {
    const response = await request.get(CATALOGUE);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toMatch(/no-store/);

    const body = await response.json();
    expect(body.live).toBe(true);
    expect(body.canEdit).toBe(true);
    expect(body.sessions.length).toBeGreaterThan(0);
    expect(body.branches.length).toBeGreaterThan(0);
    expect(body.practitioners.length).toBeGreaterThan(0);
    // Seeded from the constants, which are checked by `validateSchedule` in CI —
    // so anything here means the two have diverged.
    expect(body.problems).toEqual([]);
  });

  test("changing a session changes what the public booking page offers", async ({
    request,
  }) => {
    const before = await firstPublicSunday(request);
    expect(before?.slots[0]).toBe("16:00");
    const slotsBefore = before!.slots.length;

    const save = await request.post(CATALOGUE, {
      data: {
        action: "session",
        id: original!.id,
        branchId: "Maadi",
        practitionerId: "surgeon",
        weekday: 0,
        start: "17:30",
        end: "21:00",
        interval: 30,
        categories: original!.categories,
      },
    });
    expect(save.status()).toBe(200);

    // The whole point: no deploy, no restart, and the patient-facing calendar is
    // already offering the new hours.
    const after = await firstPublicSunday(request);
    expect(after?.date).toBe(before?.date);
    expect(after?.slots[0]).toBe("17:30");
    expect(after!.slots.length).toBeLessThan(slotsBefore);
  });

  test("a refused edit explains itself in terms the clinic can act on", async ({
    request,
  }) => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [
        // The surgeon is at Mohandessin on Monday 10:00–14:00.
        { practitionerId: "surgeon", weekday: 1, start: "11:00", end: "13:00" },
        /cannot be at Maadi and Mohandessin at the same time on Monday/i,
      ],
      [
        { practitionerId: "dental", weekday: 1, start: "09:07", end: "12:00" },
        /15-minute boundary/i,
      ],
      [
        { practitionerId: "dental", weekday: 1, start: "12:00", end: "09:00" },
        /end before it starts/i,
      ],
    ];

    for (const [overrides, expected] of cases) {
      const response = await request.post(CATALOGUE, {
        data: {
          action: "session",
          branchId: "Maadi",
          interval: 30,
          categories: ["surgical"],
          ...overrides,
        },
      });
      expect(response.status(), JSON.stringify(overrides)).toBe(400);
      expect((await response.json()).message).toMatch(expected);
    }
  });

  test("a closure removes the day from the public calendar in both languages", async ({
    request,
  }) => {
    const sunday = (await firstPublicSunday(request))!.date;

    const save = await request.post(CATALOGUE, {
      data: { action: "closure", date: sunday, en: "Eid al-Fitr", ar: "عيد الفطر" },
    });
    expect(save.status()).toBe(200);

    for (const [locale, label] of [
      ["en", "Eid al-Fitr"],
      ["ar", "عيد الفطر"],
    ] as const) {
      const body = (await (
        await request.get(`/api/availability?branch=Maadi&locale=${locale}`)
      ).json()) as { dates: Array<{ date: string; slots: string[]; closure: string | null }> };
      const day = body.dates.find((item) => item.date === sunday);
      // The day is gone from the window entirely, or present and explicitly closed
      // with no slots — either is correct, silently offering slots is not.
      if (day) {
        expect(day.slots).toHaveLength(0);
        expect(day.closure).toBe(label);
      }
    }

    expect(
      (await request.post(CATALOGUE, { data: { action: "remove_closure", date: sunday } })).status(),
    ).toBe(200);
    // Reopened: the slots come back.
    expect((await firstPublicSunday(request))?.date).toBe(sunday);
  });

  test("a longer consultation reduces how many slots are offered", async ({ request }) => {
    const before = (await firstPublicSunday(request))!.slots.length;

    expect(
      (
        await request.post(CATALOGUE, {
          data: { action: "service", id: "aesthetic", durationMinutes: 90 },
        })
      ).status(),
    ).toBe(200);
    const stretched = (await firstPublicSunday(request))!.slots.length;
    expect(stretched).toBeLessThan(before);

    // Restore, and confirm the count comes back.
    expect(
      (
        await request.post(CATALOGUE, {
          data: { action: "service", id: "aesthetic", durationMinutes: 45 },
        })
      ).status(),
    ).toBe(200);
    expect((await firstPublicSunday(request))!.slots.length).toBe(before);
  });

  test("an unknown action and a bad duration are refused", async ({ request }) => {
    expect((await request.post(CATALOGUE, { data: { action: "rewrite" } })).status()).toBe(400);
    const bad = await request.post(CATALOGUE, {
      data: { action: "service", id: "aesthetic", durationMinutes: 20 },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).message).toMatch(/multiple of 15/i);
  });

  test("a rota change is written to the access log", async ({ request }) => {
    const audit = (await (await request.get("/api/clinic/audit?limit=50")).json()) as {
      entries: Array<{ action: string; subjectId: string | null; detail: string | null }>;
    };
    const change = audit.entries.find(
      (entry) => entry.subjectId === "catalogue" && entry.action === "update",
    );
    // Opening hours decide what every patient is offered, so a change belongs in
    // the same trail as a change to a patient record.
    expect(change).toBeTruthy();
  });
});

test.describe("who may change the hours", () => {
  const RECEPTION = "e2e-hours-reception@drashrafmetwally.com";
  const as = { "oai-authenticated-user-email": RECEPTION };

  test.beforeAll(async ({ request }) => {
    await request.post("/api/clinic/staff", {
      data: {
        action: "invite",
        email: RECEPTION,
        displayName: "E2E hours reception",
        roles: ["receptionist"],
      },
    });
    await request.post("/api/clinic/staff", {
      data: { action: "active", email: RECEPTION, active: true },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.post("/api/clinic/staff", {
      data: { action: "active", email: RECEPTION, active: false },
    });
  });

  test("reception can read the timetable but not change it", async ({ request }) => {
    const read = await request.get(CATALOGUE, { headers: as });
    expect(read.status()).toBe(200);
    // Everyone who works here needs to know when the clinic is open.
    expect((await read.json()).canEdit).toBe(false);

    const write = await request.post(CATALOGUE, {
      headers: as,
      data: {
        action: "session",
        branchId: "Maadi",
        practitionerId: "dental",
        weekday: 1,
        start: "09:00",
        end: "12:00",
        interval: 30,
        categories: ["dental"],
      },
    });
    // Deleting a session silently withdraws every slot in it from the booking
    // page, which is not reception's call to make.
    expect(write.status()).toBe(403);
    expect((await write.json()).required).toBe("catalogue:write");
  });
});
