import assert from "node:assert/strict";
import test from "node:test";
import {
  BRANCHES,
  BRANCH_IDS,
  SERVICES,
  SERVICE_IDS,
  findBranch,
  findService,
} from "../lib/clinic.ts";
import { isSlotTime, openDayKeys } from "../lib/dates.ts";
import { AVAILABILITY_WINDOW_DAYS } from "../lib/clinic.ts";

test("branch and service identifiers are unique", () => {
  assert.equal(new Set(BRANCH_IDS).size, BRANCH_IDS.length);
  assert.equal(new Set(SERVICE_IDS).size, SERVICE_IDS.length);
});

test("every branch publishes valid, unique, sorted slot times", () => {
  for (const branch of BRANCHES) {
    assert.ok(branch.slots.length > 0, `${branch.id} has no slots`);
    assert.equal(
      new Set(branch.slots).size,
      branch.slots.length,
      `${branch.id} has duplicate slots`,
    );
    for (const slot of branch.slots) {
      assert.ok(isSlotTime(slot), `${branch.id} slot "${slot}" is not HH:mm`);
    }
    assert.deepEqual(branch.slots, [...branch.slots].sort());
  }
});

test("every branch and service is fully bilingual", () => {
  for (const branch of BRANCHES) {
    assert.ok(branch.en.trim().length > 0);
    assert.ok(branch.ar.trim().length > 0);
    assert.notEqual(branch.ar, branch.en, `${branch.id} is missing an Arabic label`);
  }
  for (const service of SERVICES) {
    assert.ok(service.en.trim().length > 0);
    assert.ok(service.ar.trim().length > 0);
    assert.notEqual(service.ar, service.en, `${service.id} is missing an Arabic label`);
  }
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

/**
 * Mirrors the guard in POST /api/availability. A hold request is only valid if
 * the branch, service, day and time all come from the server's own window.
 */
function isBookableRequest(input: {
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
}) {
  const branch = findBranch(input.branch);
  const service = findService(input.service);
  const offered = openDayKeys(AVAILABILITY_WINDOW_DAYS);
  return Boolean(
    branch &&
      service &&
      offered.includes(input.slotDate) &&
      branch.slots.includes(input.slotTime),
  );
}

test("hold validation accepts a slot from the offered window", () => {
  const day = openDayKeys(AVAILABILITY_WINDOW_DAYS)[0];
  assert.ok(
    isBookableRequest({
      branch: "Maadi",
      service: "nose",
      slotDate: day,
      slotTime: BRANCHES[0].slots[0],
    }),
  );
});

test("hold validation rejects dates outside the offered window", () => {
  const base = {
    branch: "Maadi",
    service: "nose",
    slotTime: BRANCHES[0].slots[0],
  };
  // These all used to pass: slotDate was never checked at all.
  assert.ok(!isBookableRequest({ ...base, slotDate: "2020-01-01" }));
  assert.ok(!isBookableRequest({ ...base, slotDate: "9999-01-01" }));
  assert.ok(!isBookableRequest({ ...base, slotDate: "not-a-date" }));
  assert.ok(!isBookableRequest({ ...base, slotDate: "" }));
});

test("hold validation rejects a time from a different branch", () => {
  const day = openDayKeys(AVAILABILITY_WINDOW_DAYS)[0];
  const foreignSlot = BRANCHES[1].slots.find(
    (slot) => !BRANCHES[0].slots.includes(slot),
  );
  assert.ok(foreignSlot, "fixture requires branches with differing slots");
  assert.ok(
    !isBookableRequest({
      branch: BRANCHES[0].id,
      service: "nose",
      slotDate: day,
      slotTime: foreignSlot!,
    }),
  );
});
