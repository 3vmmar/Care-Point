import { beforeEach, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import { getClinicAnalytics } from "@/db/analytics";
import { getDashboardSummary } from "@/db/bookings";

type Row = {
  id: string;
  status: "held" | "confirmed" | "checked_in" | "completed" | "no_show" | "cancelled";
  branch: string;
  service: string;
  slotDate: string;
  phone: string | null;
  source: string;
  practitioner: string | null;
  confirmedAt: string | null;
};

async function insert(row: Row) {
  await database().prepare(
    `INSERT INTO appointments
     (id, hold_token, status, branch, service, slot_date, slot_time,
      duration_minutes, practitioner, patient_name, patient_phone, language,
      source, created_at, confirmed_at, cancelled_at, status_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '12:00', 45, ?, ?, ?, 'en', ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      `hold-${row.id}`,
      row.status,
      row.branch,
      row.service,
      row.slotDate,
      row.practitioner,
      `Patient ${row.id}`,
      row.phone,
      row.source,
      row.confirmedAt ?? `${row.slotDate}T09:00:00.000Z`,
      row.confirmedAt,
      row.status === "cancelled" ? `${row.slotDate}T10:00:00.000Z` : null,
      `${row.slotDate}T10:00:00.000Z`,
    )
    .run();
}

beforeEach(async () => {
  await database().batch([
    database().prepare("DELETE FROM appointment_cells"),
    database().prepare("DELETE FROM appointments"),
  ]);

  await insert({
    id: "returning-old",
    status: "completed",
    branch: "Mohandessin",
    service: "face",
    slotDate: "2026-06-20",
    phone: "0150 160 6307",
    source: "website",
    practitioner: "Dr. Ashraf Metwally",
    confirmedAt: "2026-06-01T09:00:00.000Z",
  });
  await insert({
    id: "returning-current",
    status: "completed",
    branch: "Maadi",
    service: "face",
    slotDate: "2026-07-10",
    phone: "+20 150 160 6307",
    source: "website",
    practitioner: "Dr. Ashraf Metwally",
    confirmedAt: "2026-07-05T09:00:00.000Z",
  });
  await insert({
    id: "dental-new",
    status: "no_show",
    branch: "Maadi",
    service: "dental-check",
    slotDate: "2026-07-15",
    phone: "0100 000 0002",
    source: "phone",
    practitioner: "Dental team",
    confirmedAt: "2026-07-12T09:00:00.000Z",
  });
  await insert({
    id: "breast-cancelled",
    status: "cancelled",
    branch: "Maadi",
    service: "breast",
    slotDate: "2026-07-20",
    phone: "0100 000 0003",
    source: "website",
    practitioner: "Dr. Ashraf Metwally",
    confirmedAt: "2026-07-13T09:00:00.000Z",
  });
  await insert({
    id: "body-other-branch",
    status: "completed",
    branch: "Fifth Settlement",
    service: "body",
    slotDate: "2026-07-25",
    phone: "0100 000 0004",
    source: "walk_in",
    practitioner: "Dr. Ashraf Metwally",
    confirmedAt: "2026-07-20T09:00:00.000Z",
  });
  // An anonymised retained appointment remains valid operational data but is
  // not counted as a known patient once its contact key has been purged.
  await insert({
    id: "purged-contact",
    status: "completed",
    branch: "Maadi",
    service: "aesthetic",
    slotDate: "2026-08-01",
    phone: null,
    source: "website",
    practitioner: "Dr. Ashraf Metwally",
    confirmedAt: "2026-07-28T09:00:00.000Z",
  });
  await insert({
    id: "unconfirmed-hold",
    status: "held",
    branch: "Maadi",
    service: "hair-transplant",
    slotDate: "2026-08-02",
    phone: "0100 000 0005",
    source: "website",
    practitioner: null,
    confirmedAt: null,
  });
});

describe("real clinic analytics", () => {
  it("derives cohorts, demand, categories, attendance and load without PII", async () => {
    const analytics = await getClinicAnalytics({ days: 30, today: "2026-08-02" });

    expect(analytics.window).toMatchObject({
      days: 30,
      from: "2026-07-04",
      to: "2026-08-02",
      bucketDays: 1,
    });
    expect(analytics.patients).toMatchObject({ known: 4, new: 3, returning: 1 });
    expect(analytics.trend).toHaveLength(30);
    expect(analytics.trend.reduce((sum, point) => sum + point.total, 0)).toBe(5);
    expect(Object.fromEntries(analytics.statuses.map((row) => [row.status, row.total]))).toMatchObject({
      completed: 3,
      no_show: 1,
      cancelled: 1,
    });
    /**
     * The `hair-transplant` hold above is deliberately a service id the
     * catalogue no longer sells. Hair & scalp was withdrawn before launch, so
     * rows left behind by it must fall into Other rather than reviving a column
     * of their own or vanishing from the totals.
     */
    expect(Object.fromEntries(analytics.categories.map((row) => [row.category, row.total]))).toEqual({
      dental: 1,
      face: 1,
      breast: 1,
      body: 1,
      other: 1,
    });
    expect(analytics.attendance).toEqual({
      completed: 3,
      noShow: 1,
      decided: 4,
      attendedRate: 75,
    });
    expect(analytics.sources.map((row) => [row.source, row.total])).toEqual([
      ["website", 3],
      ["phone", 1],
      ["walk_in", 1],
    ]);
    expect(analytics.practitioners).toEqual([
      { practitioner: "Dr. Ashraf Metwally", total: 3 },
      { practitioner: "Dental team", total: 1 },
    ]);
    expect(JSON.stringify(analytics)).not.toContain("0150 160 6307");
    expect(JSON.stringify(analytics)).not.toContain("+20 150 160 6307");
  });

  it("applies the branch filter while keeping returning-patient history clinic-wide", async () => {
    const analytics = await getClinicAnalytics({
      days: 30,
      branch: "Maadi",
      today: "2026-08-02",
    });

    expect(analytics.branch).toBe("Maadi");
    expect(analytics.patients).toMatchObject({ known: 3, new: 2, returning: 1 });
    expect(analytics.trend.reduce((sum, point) => sum + point.total, 0)).toBe(4);
    expect(analytics.categories.find((row) => row.category === "body")?.total).toBe(0);
    expect(analytics.practitioners).toEqual([
      { practitioner: "Dr. Ashraf Metwally", total: 2 },
      { practitioner: "Dental team", total: 1 },
    ]);
  });

  it("uses weekly buckets for longer windows", async () => {
    const analytics = await getClinicAnalytics({ days: 90, today: "2026-08-02" });
    expect(analytics.window.bucketDays).toBe(7);
    expect(analytics.trend).toHaveLength(13);
    expect(analytics.trend.reduce((sum, point) => sum + point.total, 0)).toBe(6);
  });

  it("scopes the live dashboard summary to the selected branch", async () => {
    const all = await getDashboardSummary({ today: "2026-08-02" });
    const maadi = await getDashboardSummary({ branch: "Maadi", today: "2026-08-02" });

    expect(all.completedLast30Days).toBe(3);
    expect(maadi.completedLast30Days).toBe(2);
    expect(all.byService.some((row) => row.service === "body")).toBe(true);
    expect(maadi.byService.some((row) => row.service === "body")).toBe(false);
    expect(maadi.byBranch.map((row) => row.branch)).not.toContain("Fifth Settlement");
  });
});
