import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  ensureCatalogueSchema,
  getCatalogue,
  getCatalogueForEditing,
  invalidateCatalogue,
  removeClosure,
  removeSession,
  saveClosure,
  saveServiceDuration,
  saveSession,
} from "@/db/catalogue";
import { BRANCHES, PRACTITIONERS, SERVICES } from "@/lib/clinic";
import { generateSlots, validateSchedule } from "@/lib/schedule";
import { isOpenDay } from "@/lib/dates";

/**
 * The clinic's timetable, against a real D1 database.
 *
 * The point of moving the rota out of `lib/clinic.ts` was that the practice could
 * not change its own opening hours without a deploy. These tests are about
 * whether that is actually true now: does an edit reach the booking calendar, and
 * does a bad edit get refused before it can break a Tuesday?
 */

const OWNER = "owner@drashrafmetwally.com";

/** A Sunday and a Monday, chosen because the seeded rota runs on both. */
const SUNDAY = "2026-08-02";
const MONDAY = "2026-08-03";

async function resetCatalogue() {
  await ensureCatalogueSchema();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM schedule_exceptions"),
    env.DB.prepare("DELETE FROM weekly_sessions"),
    env.DB.prepare("DELETE FROM clinic_services"),
    env.DB.prepare("DELETE FROM practitioners"),
    env.DB.prepare("DELETE FROM clinic_branches"),
    env.DB.prepare("DELETE FROM departments"),
  ]);
  invalidateCatalogue();
}

beforeEach(async () => {
  await resetCatalogue();
});

describe("seeding a fresh database", () => {
  it("installs the defaults on first read, then reads live", async () => {
    // What the first request against a fresh deployment does. Without this a new
    // clinic's booking page would offer nothing at all.
    const seeded = await getCatalogue();
    expect(seeded.live).toBe(true);
    expect(seeded.branches.map((branch) => branch.id).sort()).toEqual(
      BRANCHES.map((branch) => branch.id).sort(),
    );
    expect(seeded.services).toHaveLength(SERVICES.length);
    // The seeded rota must be structurally sound, or the constants are wrong.
    expect(validateSchedule(seeded.branches)).toEqual([]);
  });

  it("does not resurrect a rota the clinic deliberately cleared", async () => {
    await getCatalogue();
    const editable = await getCatalogueForEditing();
    for (const session of editable.sessions) await removeSession(session.id);
    invalidateCatalogue();

    // Removal deactivates rather than deletes, so the rows are still there and
    // the defaults must not be reinstalled over the clinic's decision.
    const after = await getCatalogue();
    expect(after.live).toBe(false);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM weekly_sessions",
    ).first<{ total: number }>();
    expect(rows?.total).toBeGreaterThan(0);
  });
});

describe("editing the rota", () => {
  beforeEach(async () => {
    await seedFromConstants();
  });

  it("a new session immediately produces bookable slots", async () => {
    const before = await getCatalogue();
    const maadiBefore = before.branches.find((branch) => branch.id === "Maadi")!;
    const slotsBefore = generateSlots(maadiBefore, MONDAY, "aesthetic", {
      services: before.services,
      turnaround: before.turnaroundMinutes,
    });
    // Maadi runs 11:00–19:00 every day, so Monday already has slots and the
    // earliest is 11:00. The edit below opens the morning ahead of it.
    expect(slotsBefore.length).toBeGreaterThan(0);
    expect(slotsBefore[0].time).toBe("11:00");

    await saveSession({
      branchId: "Maadi",
      practitionerId: "dental",
      weekday: 1,
      // Ends before the standing 11:00 sitting begins: an overlapping session
      // for the same person at one branch is refused, and rightly.
      start: "08:00",
      end: "10:00",
      interval: 30,
      categories: ["dental"],
      actor: OWNER,
    });

    const after = await getCatalogue();
    const maadiAfter = after.branches.find((branch) => branch.id === "Maadi")!;
    const slotsAfter = generateSlots(maadiAfter, MONDAY, "dental-check", {
      services: after.services,
      turnaround: after.turnaroundMinutes,
    });
    // 45-minute consultation + 10 turnaround inside two hours, on a 30 grid.
    expect(slotsAfter.length).toBeGreaterThan(0);
    expect(slotsAfter[0].time).toBe("08:00");
    expect(slotsAfter[0].practitioner).toBe(PRACTITIONERS.dental);
  });

  it("the revision changes with every edit, so caches cannot go stale", async () => {
    const before = (await getCatalogue()).revision;
    await saveSession({
      branchId: "Maadi",
      practitionerId: "dental",
      weekday: 1,
      start: "08:00",
      end: "10:00",
      interval: 30,
      categories: ["dental"],
      actor: OWNER,
    });
    expect((await getCatalogue()).revision).not.toBe(before);
  });

  it("permits one practitioner at two branches at once, because the practice asked for it", async () => {
    // This was refused until 2026-08-07. The rota now runs the surgeon at Maadi
    // and Fifth Settlement over the same 11:00–19:00 window every day, so the
    // cross-branch guard is off (PRACTITIONERS_MAY_SPAN_BRANCHES in
    // lib/clinic.ts) and a save that spans branches has to succeed.
    //
    // Mohandessin's own sitting is 18:00–22:00, so this adds a midday session
    // that clashes with the other two branches and with nothing at this one.
    // Resolving at all is the assertion — this call threw before the change.
    await saveSession({
      branchId: "Mohandessin",
      practitionerId: "surgeon",
      weekday: 1,
      start: "12:00",
      end: "14:00",
      interval: 30,
      categories: ["surgical"],
      actor: OWNER,
    });

    // The consequence, asserted rather than assumed: the surgeon is now
    // bookable at three branches at 12:00 on the same Monday, and nothing
    // downstream will object. Whoever runs the desk has to.
    const catalogue = await getCatalogue();
    const noon = catalogue.branches.filter((branch) =>
      branch.sessions.some(
        (session) =>
          session.weekday === 1 &&
          session.practitioner === PRACTITIONERS.surgeon &&
          session.start <= "12:00" &&
          session.end > "12:00",
      ),
    );
    expect(noon.map((branch) => branch.id).sort()).toEqual([
      "Fifth Settlement",
      "Maadi",
      "Mohandessin",
    ]);
  });

  it("refuses overlapping sessions for the same practitioner at one branch", async () => {
    await expect(
      saveSession({
        branchId: "Maadi",
        practitionerId: "surgeon",
        weekday: 0,
        start: "17:00",
        end: "19:00",
        interval: 30,
        categories: ["surgical"],
        actor: OWNER,
      }),
    ).rejects.toThrow(/overlapping sessions/i);
  });

  it("refuses times off the quarter hour, backwards, or with a bad interval", async () => {
    const base = {
      branchId: "Maadi",
      practitionerId: "dental",
      weekday: 1,
      start: "09:00",
      end: "12:00",
      interval: 30,
      categories: ["dental"],
      actor: OWNER,
    };
    // Caught by validateSchedule, which names the field rather than just the rule.
    await expect(saveSession({ ...base, start: "09:07" })).rejects.toThrow(
      /start must fall on a 15-minute boundary/i,
    );
    await expect(saveSession({ ...base, start: "not-a-time" })).rejects.toThrow(/HH:mm/i);
    await expect(saveSession({ ...base, start: "12:00", end: "09:00" })).rejects.toThrow(
      /end before it starts/i,
    );
    await expect(saveSession({ ...base, interval: 20 })).rejects.toThrow(/multiple of 15/i);
    await expect(saveSession({ ...base, weekday: 9 })).rejects.toThrow(/weekday/i);
    await expect(saveSession({ ...base, categories: [] })).rejects.toThrow(/line of care/i);
  });

  it("refuses a session for a practitioner who does not exist", async () => {
    await expect(
      saveSession({
        branchId: "Maadi",
        practitionerId: "ghost",
        weekday: 1,
        start: "09:00",
        end: "12:00",
        interval: 30,
        categories: ["dental"],
        actor: OWNER,
      }),
    ).rejects.toThrow(/not in the directory/i);
  });

  it("editing a session does not treat it as overlapping itself", async () => {
    const editable = await getCatalogueForEditing();
    const session = editable.sessions.find(
      (item) => item.branchId === "Maadi" && item.practitionerId === "surgeon",
    )!;

    // Shortening a session must not fail the overlap check against its own row.
    await saveSession({
      id: session.id,
      branchId: session.branchId,
      practitionerId: session.practitionerId,
      weekday: session.weekday,
      start: "17:00",
      end: "20:00",
      interval: session.interval,
      categories: session.categories,
      actor: OWNER,
    });

    const after = await getCatalogueForEditing();
    const updated = after.sessions.find((item) => item.id === session.id)!;
    expect(updated.start).toBe("17:00");
    expect(updated.end).toBe("20:00");
  });

  it("removing a session withdraws its slots but keeps the row", async () => {
    const editable = await getCatalogueForEditing();
    const session = editable.sessions.find((item) => item.branchId === "Maadi")!;

    expect(await removeSession(session.id)).toBe(true);
    // Removing twice is not an error the second time — it is already gone.
    expect(await removeSession(session.id)).toBe(false);

    const after = await getCatalogueForEditing();
    expect(after.sessions.some((item) => item.id === session.id)).toBe(false);

    // Deactivated, not deleted: an accidental removal stays reversible and
    // appointments already booked into it keep an explanation.
    const row = await env.DB.prepare("SELECT active FROM weekly_sessions WHERE id = ?")
      .bind(session.id)
      .first<{ active: number }>();
    expect(row?.active).toBe(0);
  });
});

describe("consultation durations", () => {
  beforeEach(async () => {
    await seedFromConstants();
  });

  it("a longer consultation reduces how many fit in a session", async () => {
    const before = await getCatalogue();
    const maadi = before.branches.find((branch) => branch.id === "Maadi")!;
    const context = { services: before.services, turnaround: before.turnaroundMinutes };
    const initial = generateSlots(maadi, SUNDAY, "aesthetic", context).length;
    expect(initial).toBeGreaterThan(0);

    await saveServiceDuration({ id: "aesthetic", durationMinutes: 90 });

    const after = await getCatalogue();
    const later = generateSlots(
      after.branches.find((branch) => branch.id === "Maadi")!,
      SUNDAY,
      "aesthetic",
      { services: after.services, turnaround: after.turnaroundMinutes },
    );
    expect(later.length).toBeLessThan(initial);
    expect(later[0].durationMinutes).toBe(90);
  });

  it("refuses a duration off the grid, zero, or longer than a clinic day", async () => {
    await expect(
      saveServiceDuration({ id: "aesthetic", durationMinutes: 20 }),
    ).rejects.toThrow(/multiple of 15/i);
    await expect(saveServiceDuration({ id: "aesthetic", durationMinutes: 0 })).rejects.toThrow(
      /positive multiple/i,
    );
    await expect(
      saveServiceDuration({ id: "aesthetic", durationMinutes: 600 }),
    ).rejects.toThrow(/longer than a clinic day/i);
  });

  it("refuses a consultation type that does not exist", async () => {
    await expect(
      saveServiceDuration({ id: "not-a-service", durationMinutes: 30 }),
    ).rejects.toThrow(/does not exist/i);
  });
});

describe("closures", () => {
  beforeEach(async () => {
    await seedFromConstants();
  });

  it("a closure closes the day for booking, in both languages", async () => {
    expect(isOpenDay(SUNDAY, (await getCatalogue()).closures)).toBe(true);

    await saveClosure({ date: SUNDAY, en: "Eid al-Fitr", ar: "عيد الفطر", actor: OWNER });

    const catalogue = await getCatalogue();
    expect(isOpenDay(SUNDAY, catalogue.closures)).toBe(false);
    const closure = catalogue.closures.find((item) => item.date === SUNDAY);
    expect(closure).toEqual({ date: SUNDAY, en: "Eid al-Fitr", ar: "عيد الفطر" });

    // And no slots are generated for a closed day, whatever the rota says.
    const maadi = catalogue.branches.find((branch) => branch.id === "Maadi")!;
    expect(
      generateSlots(maadi, SUNDAY, "aesthetic", {
        services: catalogue.services,
        closures: catalogue.closures,
      }),
    ).toHaveLength(0);
  });

  it("re-saving a date corrects the label rather than stacking closures", async () => {
    await saveClosure({ date: SUNDAY, en: "Holiday", ar: "عطلة", actor: OWNER });
    await saveClosure({ date: SUNDAY, en: "Eid al-Adha", ar: "عيد الأضحى", actor: OWNER });

    const closures = (await getCatalogue()).closures.filter((item) => item.date === SUNDAY);
    expect(closures).toHaveLength(1);
    expect(closures[0].en).toBe("Eid al-Adha");
  });

  it("reopening a day restores its slots", async () => {
    await saveClosure({ date: SUNDAY, en: "Holiday", ar: "عطلة", actor: OWNER });
    expect(await removeClosure(SUNDAY)).toBe(true);
    expect(await removeClosure(SUNDAY)).toBe(false);
    expect(isOpenDay(SUNDAY, (await getCatalogue()).closures)).toBe(true);
  });

  it("requires both languages and a real date", async () => {
    await expect(
      saveClosure({ date: "not-a-date", en: "x", ar: "س", actor: OWNER }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    await expect(
      saveClosure({ date: SUNDAY, en: "Holiday", ar: "  ", actor: OWNER }),
    ).rejects.toThrow(/both English and Arabic/i);
  });
});

describe("the editor view", () => {
  beforeEach(async () => {
    await seedFromConstants();
  });

  it("carries the row ids the editor needs, and reports no problems", async () => {
    const editable = await getCatalogueForEditing();
    expect(editable.live).toBe(true);
    expect(editable.sessions.length).toBeGreaterThan(0);
    for (const session of editable.sessions) {
      expect(session.id).toBeTruthy();
      expect(session.practitionerName).toBeTruthy();
      expect(session.categories.length).toBeGreaterThan(0);
    }
    expect(editable.branches.length).toBe(BRANCHES.length);
    expect(editable.practitioners.length).toBeGreaterThan(0);
    // The seeded rota is sound, so the editor has nothing to warn about.
    expect(editable.problems).toEqual([]);
  });

  it("surfaces a problem written straight into the database", async () => {
    // A row inserted behind the validator's back — a migration, a console, or an
    // older version of this code. The editor has to show it rather than wait for
    // two patients to arrive for the same slot.
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO weekly_sessions
       (id, branch_id, practitioner_id, weekday, start_time, end_time,
        interval_minutes, categories, active, created_at, updated_at)
       VALUES ('bad', 'Maadi', 'surgeon', 0, '16:30', '18:00', 30, 'surgical', 1, ?, ?)`,
    )
      .bind(now, now)
      .run();
    invalidateCatalogue();

    const editable = await getCatalogueForEditing();
    expect(editable.problems.length).toBeGreaterThan(0);
    expect(editable.problems.some((problem) => /overlapping/i.test(problem.message))).toBe(true);
  });
});

/** One read installs the defaults; every suite below starts from them. */
async function seedFromConstants() {
  const catalogue = await getCatalogue();
  expect(catalogue.live).toBe(true);
}
