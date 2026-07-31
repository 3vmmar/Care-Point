import assert from "node:assert/strict";
import test from "node:test";

/**
 * Phone-number normalisation for data-subject requests.
 *
 * Mirrors `phoneKey` in db/dsr.ts, which cannot be imported here because that
 * module pulls in `cloudflare:workers`. Keep the two in step.
 *
 * This matters more than it looks. Erasure is the only irreversible operation
 * in the system, and it is keyed on a phone number the patient types from
 * memory. If `+201501606307` and `01501606307` do not resolve to the same
 * person, an erasure silently leaves half their records in place — and the
 * clinic reports the request as fulfilled.
 */
function phoneKey(phone: string): string {
  let digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.startsWith("20") && digits.length >= 11) {
    digits = digits.slice(2);
  }
  return digits.replace(/^0+/, "");
}

test("every way of writing one Egyptian mobile resolves to the same key", () => {
  const forms = [
    "01501606307",
    "+201501606307",
    "00201501606307",
    "0150 160 6307",
    "+20 150 160 6307",
    "(020) 150-160-6307",
    "20 1501606307",
  ];
  const keys = new Set(forms.map(phoneKey));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(", ")}`);
  assert.equal([...keys][0], "1501606307");
});

test("different patients never collide", () => {
  assert.notEqual(phoneKey("01501606307"), phoneKey("01001606307"));
  assert.notEqual(phoneKey("01000000001"), phoneKey("01000000002"));
});

test("a landline keeps its area code", () => {
  // 02 is Cairo's landline prefix; stripping it would merge unrelated numbers.
  assert.equal(phoneKey("0223591234"), "223591234");
  assert.notEqual(phoneKey("0223591234"), phoneKey("23591234"));
});

test("empty or junk input produces an empty key, never a wildcard", () => {
  // An empty key must not be treated as "matches everything" by the caller —
  // exportPatientData returns [] for it, which is what stops a blank request
  // from erasing the entire book.
  assert.equal(phoneKey(""), "");
  assert.equal(phoneKey("not a phone"), "");
  assert.equal(phoneKey("+++"), "");
  assert.equal(phoneKey("0000"), "");
});

/* -------------------------------------------------------------------------- */

/** Mirrors the guard in `erasePatientData`. */
function canErase(
  records: Array<{ slotDate: string; status: string }>,
  today: string,
): { ok: boolean; upcoming: number } {
  const upcoming = records.filter(
    (row) =>
      row.slotDate >= today && (row.status === "confirmed" || row.status === "checked_in"),
  ).length;
  return { ok: records.length > 0 && upcoming === 0, upcoming };
}

const TODAY = "2026-07-31";

test("erasure is refused while an upcoming appointment exists", () => {
  // Stripping the name from a visit the clinic is about to run would leave a
  // slot occupied by someone nobody can identify or contact.
  const result = canErase(
    [
      { slotDate: "2026-06-01", status: "completed" },
      { slotDate: "2026-08-05", status: "confirmed" },
    ],
    TODAY,
  );
  assert.equal(result.ok, false);
  assert.equal(result.upcoming, 1);
});

test("a checked-in patient also blocks erasure", () => {
  const result = canErase([{ slotDate: TODAY, status: "checked_in" }], TODAY);
  assert.equal(result.ok, false);
});

test("past visits alone can be erased", () => {
  const result = canErase(
    [
      { slotDate: "2026-05-01", status: "completed" },
      { slotDate: "2026-06-01", status: "no_show" },
    ],
    TODAY,
  );
  assert.equal(result.ok, true);
  assert.equal(result.upcoming, 0);
});

test("a cancelled future appointment does not block erasure", () => {
  // It occupies no slot and needs no contact, so it is not a reason to refuse.
  const result = canErase([{ slotDate: "2026-09-01", status: "cancelled" }], TODAY);
  assert.equal(result.ok, true);
});

test("erasing when there is nothing to erase is not a success", () => {
  // The caller reports "no records found" rather than claiming a fulfilment,
  // so the clinic does not tell a patient their data is gone when it was
  // simply never found under that number.
  assert.equal(canErase([], TODAY).ok, false);
});
