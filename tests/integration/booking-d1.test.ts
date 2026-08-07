import { beforeEach, describe, expect, it } from "vitest";
import { database } from "@/db/client";
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
import { addDays, clinicToday, openDayKeys } from "@/lib/dates";
import { generateSlots } from "@/lib/schedule";
import {
  PILOT_CHECKLIST,
  createPilotIncident,
  createPilotReview,
  evaluatePilot,
  getPilotDashboard,
  getPilotPolicy,
  resolvePilotIncident,
  updatePilotChecklist,
  updatePilotSettings,
} from "@/db/pilot";

type OfferedSlot = {
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  practitioner: string;
};

async function resetApplicationData() {
  await database().batch([
    database().prepare("DELETE FROM pilot_reviews"),
    database().prepare("DELETE FROM pilot_incidents"),
    database().prepare("DELETE FROM pilot_checklist"),
    database().prepare("DELETE FROM pilot_settings"),
    database().prepare("DELETE FROM notification_attempts"),
    database().prepare("DELETE FROM notification_jobs"),
    database().prepare("DELETE FROM appointment_cells"),
    database().prepare("DELETE FROM appointments"),
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
    const tables = await database().prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = (tables.results ?? []).map((row) => row.name);

    expect(names).toContain("appointments");
    expect(names).toContain("appointment_cells");
    expect(names).toContain("notification_jobs");
    expect(names).toContain("notification_attempts");
    expect(names).toContain("pilot_settings");
    expect(names).toContain("pilot_checklist");
    expect(names).toContain("pilot_incidents");
    expect(names).toContain("pilot_reviews");
  });

  it("cannot start a pilot until every sign-off exists, then restricts and pauses booking", async () => {
    const actor = "pilot.manager@example.test";
    const branchId = BRANCHES[1].id;
    const startDate = clinicToday();
    const endDate = addDays(startDate, 28);

    await expect(
      updatePilotSettings({ status: "running", branchId, startDate, endDate, actor }),
    ).rejects.toThrow(/complete every readiness/i);

    await updatePilotSettings({ status: "setup", branchId, startDate, endDate, actor });
    for (const item of PILOT_CHECKLIST) {
      await updatePilotChecklist({ key: item.key, completed: true, actor });
    }
    await updatePilotSettings({ status: "running", branchId, startDate, endDate, actor });

    expect(await getPilotPolicy()).toEqual({
      status: "running",
      branchId,
      restrictsBooking: true,
      bookingPaused: false,
    });

    await updatePilotSettings({ status: "paused", branchId, startDate, endDate, actor });
    expect((await getPilotPolicy()).bookingPaused).toBe(true);
  });

  it("records incidents and freezes an immutable weekly pilot review", async () => {
    const actor = "pilot.manager@example.test";
    const incidentRows = await createPilotIncident({
      summary: "Notification delivery exceeded the expected delay.",
      severity: "critical",
      actor,
    });
    const incident = incidentRows[0] as { id: string };

    const dashboard = await getPilotDashboard();
    expect(dashboard.metrics.criticalIncidents).toBe(1);
    expect(evaluatePilot(dashboard.metrics, true).recommendation).toBe("stop");
    expect(await resolvePilotIncident(incident.id, actor)).toBe(true);
    expect(await resolvePilotIncident(incident.id, actor)).toBe(false);

    const reviews = await createPilotReview({
      recommendation: "investigate",
      note: "Verify delivery providers before expanding the pilot.",
      actor,
    });
    expect(reviews).toHaveLength(1);
    expect((reviews[0] as { recommendation: string }).recommendation).toBe("investigate");
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

    const confirmationJobs = await database().prepare(
      "SELECT channel, dedupe_key AS dedupeKey FROM notification_jobs WHERE subject_id = ? AND kind = 'booking.confirmed' ORDER BY channel",
    )
      .bind(first!.id)
      .all<{ channel: string; dedupeKey: string }>();
    // Five independent channels since branch SMS joined the fan-out: patient
    // email + WhatsApp, clinic email + webhook, and the branch manager's text.
    expect(confirmationJobs.results).toHaveLength(5);
    expect(confirmationJobs.results?.map((job) => job.channel)).toContain("branch_sms");
    expect(new Set(confirmationJobs.results?.map((job) => job.dedupeKey)).size).toBe(5);

    const occupiedBefore = await database().prepare(
      "SELECT COUNT(*) AS total FROM appointment_cells WHERE appointment_id = ?",
    )
      .bind(first!.id)
      .first<{ total: number }>();
    expect(occupiedBefore?.total).toBeGreaterThan(0);

    expect(await cancelByManageToken(first!.manageToken!)).toBe(true);
    expect(await cancelByManageToken(first!.manageToken!)).toBe(false);

    const occupiedAfter = await database().prepare(
      "SELECT COUNT(*) AS total FROM appointment_cells WHERE appointment_id = ?",
    )
      .bind(first!.id)
      .first<{ total: number }>();
    expect(occupiedAfter?.total).toBe(0);

    const cancellationJobs = await database().prepare(
      "SELECT COUNT(*) AS total FROM notification_jobs WHERE subject_id = ? AND kind = 'booking.cancelled'",
    )
      .bind(first!.id)
      .first<{ total: number }>();
    // A cancellation frees a slot the branch could refill — the manager's
    // text rides along, so this is five channels too.
    expect(cancellationJobs?.total).toBe(5);
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

    const cells = await database().prepare(
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

    const cells = await database().prepare(
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

    const appointments = await database().prepare(
      "SELECT COUNT(*) AS total FROM appointments WHERE slot_date = ? AND slot_time = ?",
    )
      .bind(slot.slotDate, slot.slotTime)
      .first<{ total: number }>();
    const owners = await database().prepare(
      "SELECT COUNT(DISTINCT appointment_id) AS total FROM appointment_cells WHERE slot_date = ?",
    )
      .bind(slot.slotDate)
      .first<{ total: number }>();

    expect(appointments?.total).toBe(1);
    expect(owners?.total).toBe(1);
  });
});
