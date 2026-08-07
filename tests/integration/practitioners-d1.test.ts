import { beforeEach, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import {
  DEFAULT_CANCELLATION_REASONS,
  deactivatePractitioner,
  getCatalogue,
  getCatalogueForEditing,
  invalidateCatalogue,
  isValidCancellationReason,
  listCancellationReasons,
  removeSession,
  savePractitioner,
  saveSession,
} from "@/db/catalogue";
import { generateSlots } from "@/lib/schedule";

/**
 * Two items from the plan that had never been built: a third practitioner, and
 * any record of *why* an appointment was cancelled.
 */

const OWNER = "owner@drashrafmetwally.com";
/** A Monday, which the seeded Maadi rota leaves empty. */
const MONDAY = "2026-08-03";

async function resetCatalogue() {
  await database().batch([
    database().prepare("DELETE FROM cancellation_reasons"),
    database().prepare("DELETE FROM schedule_exceptions"),
    database().prepare("DELETE FROM weekly_sessions"),
    database().prepare("DELETE FROM clinic_services"),
    database().prepare("DELETE FROM practitioners"),
    database().prepare("DELETE FROM clinic_branches"),
    database().prepare("DELETE FROM departments"),
  ]);
  invalidateCatalogue();
  // One read installs the defaults, the way a fresh deployment does.
  expect((await getCatalogue()).live).toBe(true);
}

beforeEach(resetCatalogue);

describe("more than one practitioner", () => {
  it("adds an associate who can then be rostered", async () => {
    // The gap the plan named: the rota treated practitioners as first-class but
    // only the two seeded people existed, so a new dentist could not be rostered.
    const id = await savePractitioner({
      nameEn: "Dr. Sara Fouad",
      nameAr: "د. سارة فؤاد",
      departmentId: "dental",
      titleEn: "Consultant",
      actor: OWNER,
    });
    expect(id).toBe("dr-sara-fouad");

    const editable = await getCatalogueForEditing();
    expect(editable.practitioners.map((person) => person.id)).toContain(id);

    await saveSession({
      branchId: "Maadi",
      practitionerId: id,
      weekday: 1,
      start: "09:00",
      end: "12:00",
      interval: 30,
      categories: ["dental"],
      actor: OWNER,
    });

    const catalogue = await getCatalogue();
    const maadi = catalogue.branches.find((branch) => branch.id === "Maadi")!;
    const slots = generateSlots(maadi, MONDAY, "dental-check", {
      services: catalogue.services,
      turnaround: catalogue.turnaroundMinutes,
    });
    expect(slots.length).toBeGreaterThan(0);
    // Their name is what the occupancy grid keys on, so it has to reach the slot.
    expect(slots[0].practitioner).toBe("Dr. Sara Fouad");
  });

  it("gives two people with the same name distinct ids", async () => {
    const first = await savePractitioner({
      nameEn: "Dr. Ahmed",
      departmentId: "surgical",
      actor: OWNER,
    });
    const second = await savePractitioner({
      nameEn: "Dr. Ahmed",
      departmentId: "dental",
      actor: OWNER,
    });
    expect(first).toBe("dr-ahmed");
    expect(second).toBe("dr-ahmed-2");
  });

  it("falls back to a usable id when the name has no latin characters", async () => {
    const id = await savePractitioner({
      nameEn: "د. سارة",
      departmentId: "dental",
      actor: OWNER,
    });
    expect(id).toBe("practitioner");
  });

  it("refuses a practitioner with no name or an unknown line of care", async () => {
    await expect(
      savePractitioner({ nameEn: "   ", departmentId: "dental", actor: OWNER }),
    ).rejects.toThrow(/needs a name/i);
    await expect(
      savePractitioner({ nameEn: "Dr. X", departmentId: "astrology", actor: OWNER }),
    ).rejects.toThrow(/line of care/i);
  });

  it("renaming leaves existing bookings protected under the old name", async () => {
    const id = await savePractitioner({
      nameEn: "Dr. Sara Fouad",
      departmentId: "dental",
      actor: OWNER,
    });
    await savePractitioner({
      id,
      nameEn: "Dr. Sara Fouad-Hassan",
      departmentId: "dental",
      actor: OWNER,
    });

    const editable = await getCatalogueForEditing();
    expect(editable.practitioners.find((person) => person.id === id)?.name).toBe(
      "Dr. Sara Fouad-Hassan",
    );
    // The id is stable, which is what keeps the rota rows pointing at the right
    // person across a rename.
    expect(editable.practitioners.filter((person) => person.id === id)).toHaveLength(1);
  });

  it("refuses to remove somebody who is still on the rota", async () => {
    // Cascading would withdraw every slot in their sessions from the public
    // booking page as a side effect of an unrelated action.
    await expect(deactivatePractitioner("surgeon")).rejects.toThrow(
      /Remove this practitioner's \d+ session/i,
    );
  });

  it("removes somebody once their sessions are gone", async () => {
    const editable = await getCatalogueForEditing();
    for (const session of editable.sessions.filter((s) => s.practitionerId === "dental")) {
      await removeSession(session.id);
    }
    await deactivatePractitioner("dental");

    const after = await getCatalogueForEditing();
    expect(after.practitioners.map((person) => person.id)).not.toContain("dental");
  });

  it("refuses to remove somebody who does not exist", async () => {
    await expect(deactivatePractitioner("ghost")).rejects.toThrow(/not in the directory/i);
  });
});

describe("cancellation reasons", () => {
  it("seeds itself and offers different reasons to patients and staff", async () => {
    const patient = await listCancellationReasons("patient");
    const staff = await listCancellationReasons("staff");

    expect(patient.length).toBeGreaterThan(0);
    expect(staff.length).toBeGreaterThan(0);

    // "No longer going ahead" is a patient's answer; reception has no business
    // guessing it on their behalf.
    expect(patient.map((r) => r.code)).toContain("changed_mind");
    expect(staff.map((r) => r.code)).not.toContain("changed_mind");

    // "Could not reach the patient" is only ever something the clinic knows.
    expect(staff.map((r) => r.code)).toContain("no_contact");
    expect(patient.map((r) => r.code)).not.toContain("no_contact");

    // Shared ones appear to both.
    expect(patient.map((r) => r.code)).toContain("travelling");
    expect(staff.map((r) => r.code)).toContain("travelling");
  });

  it("carries both languages, because half the practice reads Arabic", async () => {
    for (const reason of await listCancellationReasons("patient")) {
      expect(reason.labelEn.trim().length).toBeGreaterThan(0);
      expect(reason.labelAr.trim().length).toBeGreaterThan(0);
      expect(reason.labelAr).not.toBe(reason.labelEn);
    }
  });

  it("validates a submitted code against the list that audience was offered", async () => {
    expect(await isValidCancellationReason("travelling", "patient")).toBe(true);
    expect(await isValidCancellationReason("no_contact", "staff")).toBe(true);
    // A patient must not be able to submit a staff-only code, and neither may a
    // hand-crafted request invent one.
    expect(await isValidCancellationReason("no_contact", "patient")).toBe(false);
    expect(await isValidCancellationReason("changed_mind", "staff")).toBe(false);
    expect(await isValidCancellationReason("made-up", "patient")).toBe(false);
    expect(await isValidCancellationReason("", "patient")).toBe(false);
    expect(await isValidCancellationReason(null, "patient")).toBe(false);
  });

  it("does not reseed once the clinic has edited the list", async () => {
    await listCancellationReasons("patient");
    await database().prepare("UPDATE cancellation_reasons SET active = 0 WHERE code = 'travelling'")
      .run();

    const after = await listCancellationReasons("patient");
    // Deactivating a reason is a decision, not an empty table to be refilled.
    expect(after.map((r) => r.code)).not.toContain("travelling");
    expect(after.length).toBe(
      DEFAULT_CANCELLATION_REASONS.filter(
        (r) => r.audience !== "staff" && r.code !== "travelling",
      ).length,
    );
  });
});
