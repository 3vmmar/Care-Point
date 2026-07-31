import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  cancelByManageToken,
  confirmAppointment,
  getAppointmentByManageToken,
  holdAppointment,
  listAppointments,
  releaseHold,
  rescheduleByManageToken,
} from "@/db/bookings";
import { BRANCHES, SERVICES } from "@/lib/clinic";
import { openDayKeys } from "@/lib/dates";
import { generateSlots } from "@/lib/schedule";

type OfferedSlot = {
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  practitioner: string;
};

async function resetApplicationData() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM notification_attempts"),
    env.DB.prepare("DELETE FROM notification_jobs"),
    env.DB.prepare("DELETE FROM appointment_cells"),
    env.DB.prepare("DELETE FROM appointments"),
  ]);
}

function offeredSlots(count = 2): OfferedSlot[] {
  const branch = BRANCHES[0];
  const service = SERVICES[0];
  const found: OfferedSlot[] = [];

  for (const slotDate of openDayKeys(14)) {
    for (const slot of generateSlots(branch, slotDate, service.id)) {
      found.push({
        branch: branch.id,
        service: service.id,
        slotDate,
        slotTime: slot.time,
        practitioner: slot.practitioner,
      });
      if (found.length >= count) return found;
    }
  }

  throw new Error(`The configured schedule did not offer ${count} test slots.`);
}

describe.sequential("booking lifecycle against an isolated D1 database", () => {
  beforeEach(resetApplicationData);

  it("applies every migration and exposes the occupancy and outbox tables", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = (tables.results ?? []).map((row) => row.name);

    expect(names).toContain("appointments");
    expect(names).toContain("appointment_cells");
    expect(names).toContain("notification_jobs");
    expect(names).toContain("notification_attempts");
  });

  it("confirms idempotently, writes one channel fan-out, and releases cells on cancel", async () => {
    const slot = offeredSlots(1)[0];
    const hold = await holdAppointment({ ...slot, fingerprint: "integration-patient" });
    const input = {
      holdToken: hold.holdToken,
      patientName: "Integration Patient",
      patientPhone: "+201001112233",
      patientEmail: "integration@example.test",
      language: "en" as const,
    };

    const first = await confirmAppointment(input);
    const repeated = await confirmAppointment(input);

    expect(first).not.toBeNull();
    expect(repeated?.id).toBe(first?.id);
    expect(repeated?.manageToken).toBe(first?.manageToken);

    const confirmationJobs = await env.DB.prepare(
      "SELECT channel, dedupe_key AS dedupeKey FROM notification_jobs WHERE subject_id = ? AND kind = 'booking.confirmed' ORDER BY channel",
    )
      .bind(first!.id)
      .all<{ channel: string; dedupeKey: string }>();
    expect(confirmationJobs.results).toHaveLength(4);
    expect(new Set(confirmationJobs.results?.map((job) => job.dedupeKey)).size).toBe(4);

    const occupiedBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM appointment_cells WHERE appointment_id = ?",
    )
      .bind(first!.id)
      .first<{ total: number }>();
    expect(occupiedBefore?.total).toBeGreaterThan(0);

    expect(await cancelByManageToken(first!.manageToken!)).toBe(true);
    expect(await cancelByManageToken(first!.manageToken!)).toBe(false);

    const occupiedAfter = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM appointment_cells WHERE appointment_id = ?",
    )
      .bind(first!.id)
      .first<{ total: number }>();
    expect(occupiedAfter?.total).toBe(0);

    const cancellationJobs = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM notification_jobs WHERE subject_id = ? AND kind = 'booking.cancelled'",
    )
      .bind(first!.id)
      .first<{ total: number }>();
    expect(cancellationJobs?.total).toBe(4);
  });

  it("moves the occupancy grid atomically when a patient reschedules", async () => {
    const [original, destination] = offeredSlots(2);
    const hold = await holdAppointment({ ...original, fingerprint: "reschedule-patient" });
    const confirmed = await confirmAppointment({
      holdToken: hold.holdToken,
      patientName: "Reschedule Patient",
      patientPhone: "+201009998877",
      language: "ar",
    });
    expect(confirmed?.manageToken).toBeTruthy();

    const moved = await rescheduleByManageToken({
      token: confirmed!.manageToken!,
      slotDate: destination.slotDate,
      slotTime: destination.slotTime,
      practitioner: destination.practitioner,
    });
    expect(moved?.slotDate).toBe(destination.slotDate);
    expect(moved?.slotTime).toBe(destination.slotTime);

    const cells = await env.DB.prepare(
      "SELECT DISTINCT slot_date AS slotDate FROM appointment_cells WHERE appointment_id = ?",
    )
      .bind(confirmed!.id)
      .all<{ slotDate: string }>();
    expect(cells.results?.map((row) => row.slotDate)).toEqual([destination.slotDate]);

    const loaded = await getAppointmentByManageToken(confirmed!.manageToken!);
    expect(loaded?.slotTime).toBe(destination.slotTime);
  });

  it("searches the complete appointment set before applying pagination", async () => {
    const slot = offeredSlots(1)[0];
    const hold = await holdAppointment({ ...slot, fingerprint: "search-patient" });
    const confirmed = await confirmAppointment({
      holdToken: hold.holdToken,
      patientName: "Unique Search Patient",
      patientPhone: "+201008881234",
      language: "en",
    });
    expect(confirmed).not.toBeNull();

    const match = await listAppointments({ search: "unique search", limit: 1, offset: 0 });
    expect(match.total).toBe(1);
    expect(match.appointments[0]?.id).toBe(confirmed?.id);

    const escapedWildcard = await listAppointments({ search: "%", limit: 1 });
    expect(escapedWildcard.total).toBe(0);
  });

  it("releases an abandoned hold and all of its occupancy cells", async () => {
    const slot = offeredSlots(1)[0];
    const fingerprint = "release-patient";
    const hold = await holdAppointment({ ...slot, fingerprint });

    expect(await releaseHold(hold.holdToken, "someone-else")).toBe(false);
    expect(await releaseHold(hold.holdToken, fingerprint)).toBe(true);
    expect(await releaseHold(hold.holdToken, fingerprint)).toBe(false);

    const cells = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM appointment_cells WHERE appointment_id = ?",
    )
      .bind(hold.id)
      .first<{ total: number }>();
    expect(cells?.total).toBe(0);
  });

  it("allows exactly one winner when twelve requests race for one slot", async () => {
    const slot = offeredSlots(1)[0];
    const racers = Array.from({ length: 12 }, (_, index) =>
      holdAppointment({ ...slot, fingerprint: `race-${index}` }),
    );
    const results = await Promise.allSettled(racers);
    const winners = results.filter((result) => result.status === "fulfilled");
    const losers = results.filter((result) => result.status === "rejected");

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(11);
    for (const loser of losers) {
      expect(String((loser as PromiseRejectedResult).reason)).toMatch(/constraint|unique/i);
    }

    const appointments = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM appointments WHERE slot_date = ? AND slot_time = ?",
    )
      .bind(slot.slotDate, slot.slotTime)
      .first<{ total: number }>();
    const owners = await env.DB.prepare(
      "SELECT COUNT(DISTINCT appointment_id) AS total FROM appointment_cells WHERE slot_date = ?",
    )
      .bind(slot.slotDate)
      .first<{ total: number }>();

    expect(appointments?.total).toBe(1);
    expect(owners?.total).toBe(1);
  });
});
