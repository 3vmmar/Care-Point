import assert from "node:assert/strict";
import test from "node:test";
import {
  AVAILABILITY_WINDOW_DAYS,
  BRANCHES,
  BRANCH_IDS,
  CLINIC_CLOSURES,
  PII_RETENTION_DAYS,
  REPORTING_CATEGORIES,
  SERVICES,
  SERVICE_IDS,
  branchLabel,
  findBranch,
  findService,
  isClosureDate,
  reportingCategoryForService,
  serviceDuration,
  serviceLabel,
} from "../lib/clinic.ts";
import {
  isDateKey,
  isOpenDay,
  isSlotBookable,
  isSlotTime,
  openDayKeys,
} from "../lib/dates.ts";
import { generateSlots, isOfferedSlot } from "../lib/schedule.ts";

test("branch and service identifiers are unique", () => {
  assert.equal(new Set(BRANCH_IDS).size, BRANCH_IDS.length);
  assert.equal(new Set(SERVICE_IDS).size, SERVICE_IDS.length);
});

test("every branch runs at least one session, with valid times", () => {
  for (const branch of BRANCHES) {
    assert.ok(branch.sessions.length > 0, `${branch.id} has no sessions`);
    for (const session of branch.sessions) {
      assert.ok(isSlotTime(session.start), `${branch.id}: bad start ${session.start}`);
      assert.ok(isSlotTime(session.end), `${branch.id}: bad end ${session.end}`);
      assert.ok(session.practitioner.trim().length > 0, `${branch.id}: no practitioner`);
      assert.ok(session.categories.length > 0, `${branch.id}: session offers nothing`);
    }
  }
});

test("every service category is actually reachable somewhere", () => {
  // A category no session ever runs would be selectable in the booking form and
  // impossible to book, which is worse than not offering it at all.
  const offered = new Set(
    BRANCHES.flatMap((branch) => branch.sessions.flatMap((session) => session.categories)),
  );
  for (const category of ["surgical", "nonsurgical", "dental"] as const) {
    assert.ok(offered.has(category), `no session anywhere offers ${category}`);
  }
});

test("every branch and service is fully bilingual", () => {
  for (const branch of BRANCHES) {
    assert.ok(branch.en.trim().length > 0);
    assert.ok(branch.ar.trim().length > 0);
    assert.notEqual(branch.ar, branch.en, `${branch.id} is missing an Arabic label`);
    assert.ok(branch.addressEn.trim().length > 0, `${branch.id} has no English address`);
    assert.ok(branch.addressAr.trim().length > 0, `${branch.id} has no Arabic address`);
  }
  for (const service of SERVICES) {
    assert.ok(service.en.trim().length > 0);
    assert.ok(service.ar.trim().length > 0);
    assert.notEqual(service.ar, service.en, `${service.id} is missing an Arabic label`);
  }
});

test("every branch links to a map so patients can get directions", () => {
  for (const branch of BRANCHES) {
    assert.match(
      branch.mapUrl,
      /^https:\/\/(maps\.google\.com|www\.google\.com\/maps|goo\.gl\/maps)/,
      `${branch.id} needs a Google Maps link`,
    );
  }
});

test("every consultation declares a usable duration", () => {
  for (const service of SERVICES) {
    assert.ok(
      service.durationMinutes >= 15 && service.durationMinutes <= 180,
      `${service.id} has an implausible duration`,
    );
    assert.equal(serviceDuration(service.id), service.durationMinutes);
  }
  // An unknown id must not produce a zero-length appointment.
  assert.ok(serviceDuration("not-a-service") >= 15);
});

test("reporting categories are explicit and never guessed from display copy", () => {
  assert.equal(reportingCategoryForService("dental-check"), "dental");
  assert.equal(reportingCategoryForService("dental-cosmetic"), "dental");
  assert.equal(reportingCategoryForService("face"), "face");
  assert.equal(reportingCategoryForService("nose"), "face");
  assert.equal(reportingCategoryForService("skin"), "face");
  assert.equal(reportingCategoryForService("breast"), "breast");
  assert.equal(reportingCategoryForService("body"), "body");
  // A broad consultation must stay visible as Other rather than being silently
  // attributed to whichever category happens to be most common.
  assert.equal(reportingCategoryForService("aesthetic"), "other");
  assert.equal(reportingCategoryForService("future-service"), "other");
  /**
   * Hair & scalp was withdrawn before launch, and the reporting category went
   * with it. A booking taken against the old service still has to count toward
   * the clinic's totals, so those ids report as Other rather than being dropped
   * — an appointment that silently stops existing is worse than one filed under
   * a general heading.
   */
  assert.equal(reportingCategoryForService("hair"), "other");
  assert.equal(reportingCategoryForService("hair-transplant"), "other");
  assert.equal(reportingCategoryForService("scalp"), "other");
  // Widened to string on purpose: comparing the union directly is a type error
  // now that "hair" is gone, and an assertion the compiler deletes is not a
  // guard against anyone adding the category back.
  const categoryIds: readonly string[] = REPORTING_CATEGORIES.map((category) => category.id);
  assert.ok(!categoryIds.includes("hair"), "the Hair reporting category should no longer exist");
});

test("labels fall back to the raw identifier rather than rendering blank", () => {
  assert.equal(branchLabel("Maadi"), "Maadi");
  assert.equal(branchLabel("Maadi", "ar"), "المعادي");
  assert.equal(branchLabel("Alexandria"), "Alexandria");
  assert.equal(serviceLabel("nose", "ar"), "استشارة تجميل الأنف");
  assert.equal(serviceLabel("unknown-service"), "unknown-service");
});

test("configured closures are well formed and shut the clinic", () => {
  for (const closure of CLINIC_CLOSURES) {
    assert.ok(isDateKey(closure.date), `${closure.date} is not YYYY-MM-DD`);
    assert.ok(closure.en.trim().length > 0);
    assert.ok(closure.ar.trim().length > 0);
    assert.ok(isClosureDate(closure.date));
    assert.ok(!isOpenDay(closure.date), `${closure.date} should be closed`);
  }
});

test("retention window is set and not absurd", () => {
  assert.ok(PII_RETENTION_DAYS >= 365 && PII_RETENTION_DAYS <= 3650);
});

test("lookups reject unknown and malformed identifiers", () => {
  assert.equal(findBranch("Maadi")?.id, "Maadi");
  assert.equal(findBranch("Alexandria"), undefined);
  assert.equal(findBranch(null), undefined);
  assert.equal(findBranch(""), undefined);

  assert.equal(findService("nose")?.id, "nose");
  assert.equal(findService("Rhinoplasty consultation"), undefined);
  assert.equal(findService(undefined), undefined);
});

/* -------------------------------------------------------------------------- */
/* Hold validation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors the guard in POST /api/availability. A hold request is only valid if
 * the branch, service, day and time all come from the server's own generated
 * schedule, and the slot still satisfies the lead time.
 */
function isBookableRequest(input: {
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const branch = findBranch(input.branch);
  const service = findService(input.service);
  const offeredDays = openDayKeys(AVAILABILITY_WINDOW_DAYS, now);
  return Boolean(
    branch &&
      service &&
      offeredDays.includes(input.slotDate) &&
      isOfferedSlot(branch, input.slotDate, service.id, input.slotTime) &&
      isSlotBookable(input.slotDate, input.slotTime, now),
  );
}

/** The first day in the window that genuinely offers this service. */
function firstOffer(branchId: string, service: string, now = new Date()) {
  const branch = findBranch(branchId)!;
  for (const day of openDayKeys(AVAILABILITY_WINDOW_DAYS, now)) {
    const slot = generateSlots(branch, day, service).find((candidate) =>
      isSlotBookable(day, candidate.time, now),
    );
    if (slot) return { date: day, time: slot.time };
  }
  return null;
}

test("hold validation accepts a slot the schedule actually offers", () => {
  const offer = firstOffer("Maadi", "nose");
  assert.ok(offer, "Maadi must offer a rhinoplasty consultation within the window");
  assert.ok(
    isBookableRequest({
      branch: "Maadi",
      service: "nose",
      slotDate: offer!.date,
      slotTime: offer!.time,
    }),
  );
});

test("hold validation rejects dates outside the offered window", () => {
  const base = {
    branch: "Maadi",
    service: "nose",
    slotTime: firstOffer("Maadi", "nose")?.time ?? "16:00",
  };
  // These all used to pass: slotDate was never checked at all.
  assert.ok(!isBookableRequest({ ...base, slotDate: "2020-01-01" }));
  assert.ok(!isBookableRequest({ ...base, slotDate: "9999-01-01" }));
  assert.ok(!isBookableRequest({ ...base, slotDate: "not-a-date" }));
  assert.ok(!isBookableRequest({ ...base, slotDate: "" }));
});

test("hold validation rejects a time the branch does not run that day", () => {
  const offer = firstOffer("Mohandessin", "nose");
  assert.ok(offer, "Mohandessin must offer a consultation within the window");
  // Mohandessin runs Monday and Wednesday; Maadi does not open on those days.
  assert.ok(
    !isBookableRequest({
      branch: "Maadi",
      service: "nose",
      slotDate: offer!.date,
      slotTime: offer!.time,
    }),
  );
});

test("a surgical service cannot be booked into a dental session", () => {
  const dental = firstOffer("Maadi", "dental-check");
  assert.ok(dental, "Maadi must offer dental within the window");
  // The dental session runs earlier than the surgeon's, so its start time is
  // not a valid surgical offer even though the clinic is open that day.
  assert.ok(
    !isOfferedSlot(findBranch("Maadi")!, dental!.date, "nose", dental!.time),
    "dental start time must not be bookable as a rhinoplasty consultation",
  );
});

test("hold validation respects the notice period", () => {
  // 2026-08-02 is a Sunday. Maadi's surgeon session opens at 16:00 local,
  // which is 13:00Z in summer (Cairo runs at UTC+3).
  const tooLate = new Date("2026-08-02T11:00:00.000Z"); // two hours before
  assert.ok(
    !isBookableRequest({
      branch: "Maadi",
      service: "aesthetic",
      slotDate: "2026-08-02",
      slotTime: "16:00",
      now: tooLate,
    }),
  );

  const inGoodTime = new Date("2026-08-02T06:00:00.000Z"); // seven hours before
  assert.ok(
    isBookableRequest({
      branch: "Maadi",
      service: "aesthetic",
      slotDate: "2026-08-02",
      slotTime: "16:00",
      now: inGoodTime,
    }),
  );
});
