import assert from "node:assert/strict";
import test from "node:test";
import {
  GRID_MINUTES,
  dayCapacity,
  generateSlots,
  isOfferedSlot,
  occupiedCells,
  overlaps,
  practitionersOn,
  sessionsOn,
  toMinutes,
  toTime,
  validateSchedule,
} from "../lib/schedule.ts";
import {
  BRANCHES,
  CLINIC_TURNAROUND_MINUTES,
  PRACTITIONERS,
  findBranch,
  serviceDuration,
  type Branch,
} from "../lib/clinic.ts";
import { weekdayIndex } from "../lib/dates.ts";

/** 2026-08-02 is a Sunday; 2026-08-07 is a Friday (the clinic's closed day). */
const SUNDAY = "2026-08-02";
const MONDAY = "2026-08-03";
const FRIDAY = "2026-08-07";
const SATURDAY = "2026-08-08";

const maadi = findBranch("Maadi")!;
const mohandessin = findBranch("Mohandessin")!;

test("the fixture dates are the weekdays these tests assume", () => {
  assert.equal(weekdayIndex(SUNDAY), 0);
  assert.equal(weekdayIndex(MONDAY), 1);
  assert.equal(weekdayIndex(FRIDAY), 5);
  assert.equal(weekdayIndex(SATURDAY), 6);
});

/* -------------------------------------------------------------------------- */
/* Time helpers                                                                */
/* -------------------------------------------------------------------------- */

test("minutes and times round-trip", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("16:30"), 990);
  assert.equal(toTime(990), "16:30");
  assert.equal(toTime(0), "00:00");
  // Wraps rather than producing "24:00" or a negative time.
  assert.equal(toTime(1440), "00:00");
  assert.equal(toTime(-30), "23:30");
});

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

test("sessions are day-specific, not the same every day", () => {
  // The whole point of the rebuild: Maadi runs on Sunday, not on Monday.
  assert.ok(sessionsOn(maadi, SUNDAY).length > 0);
  assert.equal(sessionsOn(maadi, MONDAY).length, 0);
  assert.ok(sessionsOn(mohandessin, MONDAY).length > 0);
  assert.equal(sessionsOn(mohandessin, SUNDAY).length, 0);
});

test("no sessions run on a closed day", () => {
  for (const branch of BRANCHES) {
    assert.equal(sessionsOn(branch, FRIDAY).length, 0, `${branch.id} runs on a Friday`);
  }
});

test("practitioners are reported per branch per day", () => {
  const sunday = practitionersOn(maadi, SUNDAY);
  assert.ok(sunday.includes(PRACTITIONERS.surgeon));
  assert.ok(sunday.includes(PRACTITIONERS.dental));
  assert.deepEqual(practitionersOn(maadi, MONDAY), []);
});

/* -------------------------------------------------------------------------- */
/* Slot generation                                                             */
/* -------------------------------------------------------------------------- */

test("slots are generated from sessions, not from a fixed list", () => {
  const slots = generateSlots(maadi, SUNDAY, "aesthetic");
  assert.ok(slots.length > 0);
  // Surgeon session is 16:00–21:00 at 30-minute intervals.
  assert.equal(slots.find((s) => s.practitioner === PRACTITIONERS.surgeon)!.time, "16:00");
});

test("a longer service yields fewer slots than a shorter one", () => {
  // 30 minutes vs 60 minutes in the same sessions.
  const short = generateSlots(maadi, SUNDAY, "nonsurgical");
  const long = generateSlots(maadi, SUNDAY, "nose");
  assert.ok(
    long.length < short.length,
    `expected fewer 60-minute slots (${long.length}) than 30-minute (${short.length})`,
  );
});

test("an appointment and its turnaround must fit inside the session", () => {
  const duration = serviceDuration("nose");
  for (const slot of generateSlots(maadi, SUNDAY, "nose")) {
    const session = sessionsOn(maadi, SUNDAY).find(
      (s) => s.practitioner === slot.practitioner,
    )!;
    assert.ok(
      toMinutes(slot.time) + duration + CLINIC_TURNAROUND_MINUTES <= toMinutes(session.end),
      `${slot.time} + ${duration}m overruns ${session.end}`,
    );
  }
});

test("dental cannot be booked into the surgeon's session", () => {
  const dental = generateSlots(maadi, SUNDAY, "dental-check");
  assert.ok(dental.length > 0, "dental should be bookable at Maadi on Sunday");
  for (const slot of dental) {
    assert.equal(slot.practitioner, PRACTITIONERS.dental);
  }

  const surgical = generateSlots(maadi, SUNDAY, "nose");
  for (const slot of surgical) {
    assert.equal(slot.practitioner, PRACTITIONERS.surgeon);
  }
});

test("no slots on a closed day, or for an unknown service", () => {
  assert.deepEqual(generateSlots(maadi, FRIDAY, "aesthetic"), []);
  assert.deepEqual(generateSlots(maadi, SUNDAY, "not-a-service"), []);
});

test("slots come back in time order", () => {
  const slots = generateSlots(maadi, SUNDAY, "aesthetic");
  for (let i = 1; i < slots.length; i += 1) {
    assert.ok(slots[i].time >= slots[i - 1].time, "slots must be ordered");
  }
});

test("isOfferedSlot agrees exactly with generateSlots", () => {
  const slots = generateSlots(mohandessin, MONDAY, "face");
  for (const slot of slots) {
    assert.ok(isOfferedSlot(mohandessin, MONDAY, "face", slot.time));
  }
  // A time inside the session but off the interval is not an offer.
  assert.ok(!isOfferedSlot(mohandessin, MONDAY, "face", "10:07"));
  // A time on the right day at the wrong branch is not an offer.
  assert.ok(!isOfferedSlot(maadi, MONDAY, "face", "10:00"));
});

/* -------------------------------------------------------------------------- */
/* Occupancy — the part that keeps variable durations safe                     */
/* -------------------------------------------------------------------------- */

test("an appointment reserves every grid cell it covers, including turnaround", () => {
  // 60 minutes + 10 turnaround = 70 minutes = five 15-minute cells.
  const cells = occupiedCells("16:00", 60, 10);
  assert.deepEqual(cells, ["16:00", "16:15", "16:30", "16:45", "17:00"]);
});

test("a start that is not grid-aligned still reserves the cell it sits in", () => {
  const cells = occupiedCells("16:20", 30, 0);
  assert.equal(cells[0], "16:15", "must claim the cell containing the start");
  assert.ok(cells.includes("16:45"));
});

test("overlapping appointments of different lengths are detected", () => {
  // This is the case exact-start uniqueness could never catch: different start
  // times, same occupied time.
  const long = { time: "16:00", durationMinutes: 60 };
  const short = { time: "16:30", durationMinutes: 30 };
  assert.ok(overlaps(long, short), "16:00+60 and 16:30+30 must be seen as clashing");
});

test("back-to-back appointments respecting turnaround do not overlap", () => {
  const first = { time: "16:00", durationMinutes: 30 };
  const second = { time: "16:45", durationMinutes: 30 };
  assert.ok(!overlaps(first, second, 10));
});

test("an appointment always overlaps itself", () => {
  const one = { time: "10:00", durationMinutes: 45 };
  assert.ok(overlaps(one, one));
});

test("generated slots for one service never overlap each other", () => {
  for (const service of ["aesthetic", "nose", "nonsurgical", "dental-check"]) {
    for (const branch of BRANCHES) {
      for (const date of [SUNDAY, MONDAY, SATURDAY]) {
        const slots = generateSlots(branch, date, service);
        for (let i = 0; i < slots.length; i += 1) {
          for (let j = i + 1; j < slots.length; j += 1) {
            if (slots[i].practitioner !== slots[j].practitioner) continue;
            assert.ok(
              !overlaps(slots[i], slots[j]),
              `${branch.id} ${date} ${service}: ${slots[i].time} clashes with ${slots[j].time}`,
            );
          }
        }
      }
    }
  }
});

test("every occupied cell falls on the grid", () => {
  for (const cell of occupiedCells("10:00", 45, 10)) {
    assert.equal(toMinutes(cell) % GRID_MINUTES, 0, `${cell} is off the grid`);
  }
});

/* -------------------------------------------------------------------------- */
/* Capacity                                                                    */
/* -------------------------------------------------------------------------- */

test("capacity reflects the day, not a constant", () => {
  assert.equal(dayCapacity(FRIDAY), 0, "a closed day has no capacity");
  assert.ok(dayCapacity(SUNDAY) > 0);
  // Different days run different branches, so capacity genuinely differs.
  assert.notEqual(dayCapacity(SUNDAY), dayCapacity(MONDAY));
});

test("capacity can be scoped to one branch", () => {
  const all = dayCapacity(SUNDAY, "aesthetic");
  const justMaadi = dayCapacity(SUNDAY, "aesthetic", "Maadi");
  assert.ok(justMaadi > 0);
  assert.ok(justMaadi <= all);
});

/* -------------------------------------------------------------------------- */
/* Configuration validation                                                    */
/* -------------------------------------------------------------------------- */

test("the configured schedule is structurally valid", () => {
  const problems = validateSchedule();
  assert.deepEqual(
    problems,
    [],
    `schedule problems:\n${problems.map((p) => `  ${p.branch}: ${p.message}`).join("\n")}`,
  );
});

test("validation catches a session that ends before it starts", () => {
  const broken: Branch[] = [
    {
      ...maadi,
      sessions: [
        { weekday: 0, start: "18:00", end: "16:00", interval: 30, practitioner: "X", categories: ["surgical"] },
      ],
    },
  ];
  assert.ok(validateSchedule(broken).some((p) => /ends before it starts/.test(p.message)));
});

test("validation catches times off the grid and bad intervals", () => {
  const broken: Branch[] = [
    {
      ...maadi,
      sessions: [
        { weekday: 0, start: "16:07", end: "20:00", interval: 7, practitioner: "X", categories: ["surgical"] },
      ],
    },
  ];
  const problems = validateSchedule(broken);
  assert.ok(problems.some((p) => /boundary/.test(p.message)));
  assert.ok(problems.some((p) => /interval/.test(p.message)));
});

test("validation catches one practitioner in two places at once", () => {
  const clashing: Branch[] = [
    {
      ...maadi,
      sessions: [
        { weekday: 0, start: "16:00", end: "20:00", interval: 30, practitioner: "Dr. Clash", categories: ["surgical"] },
      ],
    },
    {
      ...mohandessin,
      sessions: [
        { weekday: 0, start: "18:00", end: "21:00", interval: 30, practitioner: "Dr. Clash", categories: ["surgical"] },
      ],
    },
  ];
  assert.ok(
    validateSchedule(clashing).some((p) => /also at/.test(p.message)),
    "a practitioner double-booked across branches must be reported",
  );
});

test("validation catches a branch with no sessions", () => {
  assert.ok(
    validateSchedule([{ ...maadi, sessions: [] }]).some((p) => /no sessions/.test(p.message)),
  );
});
