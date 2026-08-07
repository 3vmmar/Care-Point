import { beforeEach, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import { getClinicGrowth } from "@/db/analytics-growth";

/**
 * Growth analytics against a real D1, not a mirror.
 *
 * The module makes claims a clinic would act on — "new patients are up 40%",
 * "Tuesday afternoons are your busiest" — so the arithmetic has to be checked
 * against rows, and just as importantly the REFUSALS have to be checked: a
 * figure derived from four appointments must report itself as insufficient
 * rather than render as a confident number.
 */

type Row = {
  id: string;
  status: "held" | "confirmed" | "checked_in" | "completed" | "no_show" | "cancelled";
  branch?: string;
  service?: string;
  slotDate: string;
  slotTime?: string;
  phone?: string | null;
  confirmedAt?: string | null;
  checkedInAt?: string | null;
  statusUpdatedAt?: string | null;
};

async function insert(row: Row) {
  await database().prepare(
    `INSERT INTO appointments
     (id, hold_token, status, branch, service, slot_date, slot_time,
      duration_minutes, practitioner, patient_name, patient_phone, language,
      source, created_at, confirmed_at, checked_in_at, status_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 45, 'Dr. Ashraf Metwally', ?, ?, 'en',
             'website', ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      `hold-${row.id}`,
      row.status,
      row.branch ?? "Maadi",
      row.service ?? "face",
      row.slotDate,
      row.slotTime ?? "12:00",
      `Patient ${row.id}`,
      row.phone === undefined ? `0100 000 ${row.id.slice(-4).padStart(4, "0")}` : row.phone,
      `${row.slotDate}T06:00:00.000Z`,
      row.confirmedAt === undefined ? `${row.slotDate}T06:00:00.000Z` : row.confirmedAt,
      row.checkedInAt ?? null,
      row.statusUpdatedAt ?? null,
    )
    .run();
}

const clear = () =>
  database().batch([
    database().prepare("DELETE FROM appointment_cells"),
    database().prepare("DELETE FROM appointments"),
  ]);

beforeEach(clear);

/** Fixed "today" so nothing depends on the wall clock. */
const TODAY = "2026-08-07";

describe("period comparison", () => {
  it("computes growth against the immediately preceding window of equal length", async () => {
    // Current window is the 30 days ending 2026-08-07, i.e. from 2026-07-09.
    for (const day of ["2026-07-20", "2026-07-21", "2026-07-22"]) {
      await insert({ id: `cur-${day}`, status: "completed", slotDate: day });
    }
    // Previous window: 2026-06-09 .. 2026-07-08.
    await insert({ id: "prev-1", status: "completed", slotDate: "2026-06-20" });
    await insert({ id: "prev-2", status: "completed", slotDate: "2026-06-25" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });

    expect(growth.appointments.current.total).toBe(3);
    expect(growth.appointments.previous.total).toBe(2);
    expect(growth.appointments.changePercent).toBe(50);
    expect(growth.appointments.direction).toBe("up");
    expect(growth.window).toEqual({ days: 30, from: "2026-07-09", to: TODAY });
  });

  it("reports growth as unknown rather than infinite when the previous window is empty", async () => {
    await insert({ id: "only-1", status: "completed", slotDate: "2026-07-20" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });

    // 0 -> 1 is not "infinite growth"; a percentage there cannot be reasoned
    // about and must not reach a dashboard.
    expect(growth.appointments.previous.total).toBe(0);
    expect(growth.appointments.changePercent).toBeNull();
    expect(growth.appointments.direction).toBe("unknown");
  });

  it("marks a comparison insufficient when it rests on a handful of bookings", async () => {
    await insert({ id: "thin-1", status: "completed", slotDate: "2026-07-20" });
    await insert({ id: "thin-2", status: "completed", slotDate: "2026-06-20" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });

    expect(growth.appointments.sufficiency.ok).toBe(false);
    expect(growth.appointments.sufficiency.sample).toBe(2);
    expect(growth.appointments.sufficiency.reason).toMatch(/individual bookings/i);
  });

  it("excludes holds, which are an intention rather than a booking", async () => {
    await insert({ id: "held-1", status: "held", slotDate: "2026-07-20" });
    await insert({ id: "real-1", status: "confirmed", slotDate: "2026-07-21" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });
    expect(growth.appointments.current.total).toBe(1);
  });
});

describe("patient cohorts", () => {
  it("counts a patient as new only in the period of their first linkable visit", async () => {
    const phone = "0150 160 6307";
    // First ever visit sits in the previous window...
    await insert({ id: "first", status: "completed", slotDate: "2026-06-20", phone });
    // ...so the return visit in the current window is not a new patient.
    await insert({ id: "return", status: "completed", slotDate: "2026-07-20", phone: "+20 150 160 6307" });
    await insert({ id: "genuinely-new", status: "completed", slotDate: "2026-07-21", phone: "0111 222 3333" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });

    expect(growth.newPatients.current.total).toBe(1);
    expect(growth.newPatients.previous.total).toBe(1);
  });

  it("matches Egyptian local and international number forms as one person", async () => {
    await insert({ id: "local", status: "completed", slotDate: "2026-07-10", phone: "01501606307" });
    await insert({ id: "intl", status: "completed", slotDate: "2026-07-20", phone: "+20 150 160 6307" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });
    expect(growth.newPatients.current.total).toBe(1);
  });

  it("splits each month into new and returning, and flags a month still running", async () => {
    const phone = "0150 160 6307";
    await insert({ id: "m1", status: "completed", slotDate: "2026-06-10", phone });
    await insert({ id: "m2", status: "completed", slotDate: "2026-07-10", phone });
    await insert({ id: "m3", status: "completed", slotDate: "2026-07-11", phone: "0111 111 1111" });
    await insert({ id: "m4", status: "completed", slotDate: "2026-08-02", phone: "0122 222 2222" });

    const growth = await getClinicGrowth({ days: 90, today: TODAY });
    const july = growth.months.find((month) => month.month === "2026-07");
    const august = growth.months.find((month) => month.month === "2026-08");

    expect(july).toMatchObject({ total: 2, newPatients: 1, returning: 1, complete: true });
    // August is the month "today" falls in, so it is still accumulating and
    // must say so or it reads as a collapse next to July.
    expect(august?.complete).toBe(false);
  });
});

describe("demand", () => {
  it("groups by hour of day and by weekday", async () => {
    await insert({ id: "h1", status: "completed", slotDate: "2026-07-20", slotTime: "09:30" });
    await insert({ id: "h2", status: "completed", slotDate: "2026-07-21", slotTime: "09:45" });
    await insert({ id: "h3", status: "completed", slotDate: "2026-07-22", slotTime: "17:00" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });

    expect(growth.demandByHour).toEqual(
      expect.arrayContaining([
        { hour: 9, total: 2 },
        { hour: 17, total: 1 },
      ]),
    );
    // 2026-07-20 is a Monday; SQLite's %w makes Sunday 0, so Monday is 1.
    expect(growth.demandByWeekday.find((day) => day.weekday === 1)?.total).toBe(1);
  });
});

describe("lead time", () => {
  it("buckets how far ahead patients book, and takes a median", async () => {
    // Confirmed on the day: 0 days lead.
    await insert({
      id: "same-day", status: "completed", slotDate: "2026-07-20",
      confirmedAt: "2026-07-20T06:00:00.000Z",
    });
    // Confirmed five days out.
    await insert({
      id: "five", status: "completed", slotDate: "2026-07-25",
      confirmedAt: "2026-07-20T06:00:00.000Z",
    });
    // Confirmed twenty days out.
    await insert({
      id: "twenty", status: "completed", slotDate: "2026-08-01",
      confirmedAt: "2026-07-12T06:00:00.000Z",
    });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });
    const bucket = (label: string) =>
      growth.leadTime.buckets.find((entry) => entry.label === label)?.total;

    expect(bucket("Same day")).toBe(1);
    expect(bucket("3–7 days")).toBe(1);
    expect(bucket("15+ days")).toBe(1);
    expect(growth.leadTime.medianDays).toBe(5);
    expect(growth.leadTime.sufficiency.ok).toBe(false);
  });
});

describe("punctuality and consultation length", () => {
  it("measures arrival against the appointed time, counting early and late", async () => {
    // 12:00 Africa/Cairo in July is 09:00 UTC (UTC+3 under DST).
    await insert({
      id: "early", status: "completed", slotDate: "2026-07-20", slotTime: "12:00",
      checkedInAt: "2026-07-20T08:50:00.000Z",
    });
    await insert({
      id: "late", status: "completed", slotDate: "2026-07-21", slotTime: "12:00",
      checkedInAt: "2026-07-21T09:20:00.000Z",
    });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });

    expect(growth.punctuality.earlyOrOnTime).toBe(1);
    expect(growth.punctuality.late).toBe(1);
    expect(growth.punctuality.medianMinutes).toBe(5); // (-10 + 20) / 2
  });

  it("discards a retrospective tidy-up rather than reporting a six-hour visit", async () => {
    await insert({
      id: "real", status: "completed", slotDate: "2026-07-20", slotTime: "12:00",
      checkedInAt: "2026-07-20T09:00:00.000Z",
      statusUpdatedAt: "2026-07-20T09:40:00.000Z",
    });
    // Reception marking the morning complete at closing time is not a
    // six-hour consultation, and must not drag the median.
    await insert({
      id: "tidied", status: "completed", slotDate: "2026-07-21", slotTime: "12:00",
      checkedInAt: "2026-07-21T09:00:00.000Z",
      statusUpdatedAt: "2026-07-21T15:30:00.000Z",
    });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });
    expect(growth.consultation.medianMinutes).toBe(40);
  });

  it("refuses to report a median from too few check-ins", async () => {
    await insert({
      id: "one", status: "completed", slotDate: "2026-07-20", slotTime: "12:00",
      checkedInAt: "2026-07-20T09:00:00.000Z",
    });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });
    expect(growth.punctuality.sufficiency.ok).toBe(false);
    expect(growth.punctuality.sufficiency.reason).toMatch(/checked in/i);
  });
});

describe("utilisation", () => {
  it("reports insufficiency rather than a zero when no capacity was supplied", async () => {
    await insert({ id: "u1", status: "confirmed", slotDate: "2026-07-20" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });

    expect(growth.utilisation.days).toEqual([]);
    expect(growth.utilisation.averagePercent).toBeNull();
    expect(growth.utilisation.sufficiency.ok).toBe(false);
    expect(growth.utilisation.sufficiency.reason).toMatch(/consultation types/i);
  });

  it("measures booked against published capacity when the catalogue is supplied", async () => {
    // Maadi consults on weekdays 0, 2 and 4 (Sunday, Tuesday, Thursday), so a
    // booking has to land on one of those to have any published capacity to
    // measure against. 2026-07-21 is a Tuesday.
    await insert({ id: "u1", status: "confirmed", slotDate: "2026-07-21", branch: "Maadi" });

    const growth = await getClinicGrowth({
      days: 30,
      today: TODAY,
      branch: "Maadi",
      capacityServices: ["face"],
    });

    expect(growth.utilisation.days.length).toBeGreaterThan(0);
    for (const day of growth.utilisation.days) {
      expect(day.capacity).toBeGreaterThan(0);
      expect(day.percent).toBe(Math.round((day.booked / day.capacity) * 100));
    }
    const busy = growth.utilisation.days.find((day) => day.date === "2026-07-21");
    expect(busy?.booked).toBe(1);
  });

  it("omits a closed day, rather than reporting it as 0% used", async () => {
    // Every branch consults seven days a week since 2026-08-07, so a weekday no
    // longer distinguishes an open day from a closed one — a one-off closure
    // does. Showing a closure as "0% utilised" would read as a wasted day
    // instead of a day the clinic was shut.
    const closed = "2026-07-22";
    const growth = await getClinicGrowth({
      days: 30,
      today: TODAY,
      branch: "Maadi",
      capacityServices: ["face"],
      schedule: { closures: [{ date: closed, en: "Planned leave", ar: "إجازة" }] },
    });

    expect(growth.utilisation.days.length).toBeGreaterThan(0);
    expect(growth.utilisation.days.some((day) => day.date === closed)).toBe(false);
  });
});

describe("branch scoping", () => {
  it("counts only the selected clinic", async () => {
    await insert({ id: "maadi", status: "completed", slotDate: "2026-07-20", branch: "Maadi" });
    await insert({ id: "mohandessin", status: "completed", slotDate: "2026-07-21", branch: "Mohandessin" });

    const all = await getClinicGrowth({ days: 30, today: TODAY });
    const maadi = await getClinicGrowth({ days: 30, today: TODAY, branch: "Maadi" });

    expect(all.appointments.current.total).toBe(2);
    expect(maadi.appointments.current.total).toBe(1);
    expect(maadi.branch).toBe("Maadi");
  });
});

describe("privacy", () => {
  it("returns no patient identifiers anywhere in the payload", async () => {
    await insert({
      id: "p1", status: "completed", slotDate: "2026-07-20",
      phone: "0150 160 6307",
    });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });
    const serialised = JSON.stringify(growth);

    expect(serialised).not.toContain("6307");
    expect(serialised).not.toContain("Patient p1");
    // The horizon is surfaced so the UI can say why the history stops.
    expect(growth.identityHorizonDays).toBe(540);
  });

  it("cannot link a patient whose contact details were purged", async () => {
    // The retention job clears the phone, which is what makes a long-standing
    // patient reappear as new. Asserted so the limitation is documented in a
    // test rather than only in a comment.
    await insert({ id: "purged", status: "completed", slotDate: "2026-06-20", phone: null });
    await insert({ id: "now", status: "completed", slotDate: "2026-07-20", phone: "0150 160 6307" });

    const growth = await getClinicGrowth({ days: 30, today: TODAY });
    expect(growth.newPatients.current.total).toBe(1);
  });
});
