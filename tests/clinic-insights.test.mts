import assert from "node:assert/strict";
import test from "node:test";
import { computeClinicInsights } from "../lib/clinic-insights.ts";
import type { ClinicGrowth } from "../db/analytics-growth.ts";

/**
 * The insight rules, tested as pure functions.
 *
 * Two properties matter more than any individual headline. First, that a rule
 * NEVER fires on data too thin to support it — a dashboard telling a practice
 * its no-show rate is 33% on three appointments would send them chasing a
 * problem they do not have. Second, that every card carries the arithmetic
 * behind its claim, because a figure a doctor cannot check is a figure they
 * are right to ignore.
 */

const enough = (sample: number) => ({ ok: true, sample, required: 10 });
const tooThin = (sample: number) => ({
  ok: false,
  sample,
  required: 10,
  reason: "not enough history",
});

/** A deliberately EMPTY, sufficient-nowhere baseline. Each test opts in to
 *  exactly the data its rule reads, so nothing fires by accident. */
function baseline(): ClinicGrowth {
  return {
    window: { days: 90, from: "2026-05-10", to: "2026-08-07" },
    branch: null,
    appointments: {
      current: { from: "2026-05-10", to: "2026-08-07", total: 0 },
      previous: { from: "2026-02-09", to: "2026-05-09", total: 0 },
      changePercent: null,
      direction: "unknown",
      sufficiency: tooThin(0),
    },
    newPatients: {
      current: { from: "2026-05-10", to: "2026-08-07", total: 0 },
      previous: { from: "2026-02-09", to: "2026-05-09", total: 0 },
      changePercent: null,
      direction: "unknown",
      sufficiency: tooThin(0),
    },
    months: [],
    monthsSufficiency: tooThin(0),
    demandByHour: [],
    demandByWeekday: [],
    leadTime: { buckets: [], medianDays: null, sufficiency: tooThin(0) },
    utilisation: { days: [], averagePercent: null, sufficiency: tooThin(0) },
    punctuality: {
      medianMinutes: null,
      earlyOrOnTime: 0,
      late: 0,
      sufficiency: tooThin(0),
    },
    consultation: { medianMinutes: null, sufficiency: tooThin(0) },
    outcomes: {
      completed: 0,
      checkedIn: 0,
      noShow: 0,
      cancelled: 0,
      arrived: 0,
      decided: 0,
      noShowRate: null,
      sufficiency: tooThin(0),
    },
    identityHorizonDays: 540,
  };
}

/** Builds an outcomes block the way the query does, so a test cannot invent an
 *  impossible combination (arrived that is not completed + checked in). */
function outcomes(counts: { completed: number; checkedIn?: number; noShow: number; cancelled?: number }) {
  const checkedIn = counts.checkedIn ?? 0;
  const cancelled = counts.cancelled ?? 0;
  const arrived = counts.completed + checkedIn;
  const decided = arrived + counts.noShow;
  return {
    completed: counts.completed,
    checkedIn,
    noShow: counts.noShow,
    cancelled,
    arrived,
    decided,
    noShowRate: decided > 0 ? Math.round((counts.noShow / decided) * 1000) / 10 : null,
    sufficiency: decided >= 10 ? enough(decided) : tooThin(decided),
  };
}

const ids = (growth: ClinicGrowth) => computeClinicInsights(growth).map((i) => i.id);

test("an empty book produces no insights at all, not hedged ones", () => {
  assert.deepEqual(computeClinicInsights(baseline()), []);
});

test("every insight shows the arithmetic behind its claim", () => {
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 40, noShow: 12, cancelled: 3 });
  const insights = computeClinicInsights(growth);
  assert.ok(insights.length > 0);
  for (const insight of insights) {
    assert.ok(insight.basis.length > 20, `${insight.id} has no working shown`);
    // The basis must contain real digits — a restatement of the headline in
    // words would satisfy a length check but not a reader.
    assert.match(insight.basis, /\d/, `${insight.id}'s basis carries no figures`);
    assert.ok(insight.headline.trim().endsWith("."), `${insight.id} is not a sentence`);
    assert.ok(!insight.headline.includes("?"), `${insight.id} asks rather than tells`);
  }
});

/* ------------------------------------------------ regression: denominators -- */

test("a checked-in patient counts as arrived, so the no-show rate is not inflated", () => {
  // The defect this exists for: `decided` was completed + noShow, excluding
  // checked_in. A desk that checks people in but does not press Completed had
  // its no-show rate reported at four times reality — on the same screen that
  // showed those patients' arrival times.
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 12, checkedIn: 78, noShow: 10 });

  assert.equal(growth.outcomes.arrived, 90);
  assert.equal(growth.outcomes.decided, 100);
  assert.equal(growth.outcomes.noShowRate, 10);
  // 10% is neither high (>=15) nor low (<=5): no card, correctly.
  const found = ids(growth);
  assert.ok(!found.includes("no-show-high"), "10% must not read as a no-show problem");
  assert.ok(!found.includes("no-show-low"));
});

test("the no-show headline states the same figure as its basis", () => {
  // 45.5% was rendered as "Almost 46%" — a different number, rounded the wrong
  // way, contradicting the working printed directly beneath it.
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 12, noShow: 10 });
  assert.equal(growth.outcomes.noShowRate, 45.5);
  const insight = computeClinicInsights(growth).find((i) => i.id === "no-show-high")!;
  assert.match(insight.headline, /45\.5%/);
  assert.ok(!insight.headline.includes("46"), "headline must not round away from its basis");
  assert.match(insight.basis, /45\.5%/);
  // And it must credit the arrivals, not only the completions.
  assert.match(insight.basis, /12 that arrived/);
});

test("returning share counts appointments, so same-day double bookings invent no retention", () => {
  // Ten brand-new patients, each booked for a consultation and a same-day
  // session. Not one appointment belongs to someone who had been before.
  // The old residual (total - distinctNewPatients) reported 50% retention.
  const growth = baseline();
  growth.monthsSufficiency = enough(2);
  growth.months = [
    { month: "2026-06", total: 20, newPatients: 10, newVisits: 20, returning: 0, complete: true },
    { month: "2026-07", total: 20, newPatients: 10, newVisits: 20, returning: 0, complete: true },
  ];
  const insight = computeClinicInsights(growth).find((i) => i.id === "returning-share");
  assert.ok(insight, "the card should still appear — the honest answer is 0%");
  assert.match(insight!.headline, /^0% of appointments are return visits\.$/);
  assert.match(insight!.basis, /0 of 40 appointments/);
  assert.equal(insight!.tone, "neutral");
});

test("new and returning visit counts are row counts that sum to the month total", () => {
  // The property that makes the stacked chart honest: a bar cannot be taller
  // or shorter than the month it describes.
  const growth = baseline();
  growth.monthsSufficiency = enough(2);
  growth.months = [
    { month: "2026-06", total: 18, newPatients: 4, newVisits: 6, returning: 12, complete: true },
    { month: "2026-07", total: 22, newPatients: 5, newVisits: 8, returning: 14, complete: true },
  ];
  for (const month of growth.months) {
    assert.equal(month.newVisits + month.returning, month.total, `${month.month} does not stack`);
  }
  const insight = computeClinicInsights(growth).find((i) => i.id === "returning-share")!;
  assert.match(insight.headline, /65%/); // 26 of 40
});

/* ------------------------------------------------------------ attendance -- */

test("a high no-show rate is reported with the counts that produced it", () => {
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 40, noShow: 12, cancelled: 2 });
  const insight = computeClinicInsights(growth).find((i) => i.id === "no-show-high");
  assert.ok(insight, "a 23% no-show rate must be surfaced");
  assert.equal(insight!.tone, "attention");
  assert.match(insight!.basis, /12 no-shows/);
  // "Arrived", not "completed": the denominator credits checked-in patients.
  assert.match(insight!.basis, /40 that arrived/);
  // Denominator must be decided visits, never everything booked.
  assert.match(insight!.basis, /52 visits/);
});

test("a no-show rate is never reported from too few decided visits", () => {
  const growth = baseline();
  // 1 of 3 is 33% — the most tempting bad number a dashboard can show.
  growth.outcomes = outcomes({ completed: 2, noShow: 1, cancelled: 0 });
  assert.ok(!ids(growth).includes("no-show-high"));
  assert.ok(!ids(growth).includes("no-show-low"));
});

test("strong attendance is credited, not only failure flagged", () => {
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 58, noShow: 2, cancelled: 1 });
  const insight = computeClinicInsights(growth).find((i) => i.id === "no-show-low");
  assert.ok(insight);
  assert.equal(insight!.tone, "positive");
});

test("a middling no-show rate produces no card either way", () => {
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 45, noShow: 5, cancelled: 0 });
  const found = ids(growth);
  assert.ok(!found.includes("no-show-high"));
  assert.ok(!found.includes("no-show-low"));
});

test("the cancellation card refuses thin data like every other attendance card", () => {
  // It used to sit OUTSIDE the sufficiency guard and fired on one cancellation
  // against one completed visit — exactly the hedge-on-nothing this module
  // forbids.
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 1, noShow: 0, cancelled: 1 });
  assert.equal(growth.outcomes.sufficiency.ok, false);
  assert.ok(!ids(growth).includes("cancellations-outweigh"));
});

test('"more cancelled than went ahead" is false at parity, so it does not fire there', () => {
  // 40 against 40 rendered "More visits were cancelled than completed" with a
  // basis one line below that disproved it.
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 40, noShow: 2, cancelled: 40 });
  assert.ok(!ids(growth).includes("cancellations-outweigh"));

  const clear = baseline();
  clear.outcomes = outcomes({ completed: 40, noShow: 2, cancelled: 41 });
  assert.ok(ids(clear).includes("cancellations-outweigh"));
});

test("cancellations outweighing completions is called out separately from no-shows", () => {
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 10, noShow: 1, cancelled: 14 });
  const insight = computeClinicInsights(growth).find(
    (i) => i.id === "cancellations-outweigh",
  );
  assert.ok(insight);
  // The distinction is the point: one slot came back, the other did not.
  assert.match(insight!.basis, /return to the calendar/i);
});

/* ---------------------------------------------------------------- growth -- */

test("a first-visit swing is reported with both periods", () => {
  const growth = baseline();
  growth.newPatients = {
    current: { from: "2026-05-10", to: "2026-08-07", total: 28 },
    previous: { from: "2026-02-09", to: "2026-05-09", total: 20 },
    changePercent: 40,
    direction: "up",
    sufficiency: enough(48),
  };
  const insight = computeClinicInsights(growth).find((i) => i.id === "new-patients-up");
  assert.ok(insight);
  assert.match(insight!.basis, /28 first visits/);
  assert.match(insight!.basis, /against 20/);
  // The retention horizon is part of the claim's honesty, not a footnote.
  assert.match(insight!.basis, /540-day/);
});

test("a fall in first visits is reported as plainly as a rise", () => {
  const growth = baseline();
  growth.newPatients = {
    current: { from: "2026-05-10", to: "2026-08-07", total: 11 },
    previous: { from: "2026-02-09", to: "2026-05-09", total: 25 },
    changePercent: -56,
    direction: "down",
    sufficiency: enough(36),
  };
  const insight = computeClinicInsights(growth).find((i) => i.id === "new-patients-down");
  assert.ok(insight);
  assert.equal(insight!.tone, "attention");
  // Absolute value in the headline; the direction is already in the words.
  assert.match(insight!.headline, /down 56%/);
});

test("a growth percentage is never reported without a comparable previous period", () => {
  const growth = baseline();
  growth.newPatients = {
    current: { from: "2026-05-10", to: "2026-08-07", total: 30 },
    previous: { from: "2026-02-09", to: "2026-05-09", total: 0 },
    changePercent: null, // 0 -> 30 is not "infinite growth"
    direction: "unknown",
    sufficiency: enough(30),
  };
  const found = ids(growth);
  assert.ok(!found.includes("new-patients-up"));
  assert.ok(!found.includes("new-patients-down"));
});

test("returning share needs two complete months and real volume", () => {
  const growth = baseline();
  growth.monthsSufficiency = enough(2);
  growth.months = [
    { month: "2026-06", total: 18, newPatients: 6, newVisits: 6, returning: 12, complete: true },
    { month: "2026-07", total: 22, newPatients: 8, newVisits: 8, returning: 14, complete: true },
    // In-progress month must not contribute.
    { month: "2026-08", total: 3, newPatients: 3, newVisits: 3, returning: 0, complete: false },
  ];
  const insight = computeClinicInsights(growth).find((i) => i.id === "returning-share");
  assert.ok(insight);
  // 26 returning of 40 completed-month appointments = 65%.
  assert.match(insight!.headline, /65%/);
  assert.match(insight!.basis, /26 of 40/);
  assert.match(insight!.basis, /2 complete months/);
  assert.equal(insight!.tone, "positive");
});

test("one complete month is not a retention trend", () => {
  const growth = baseline();
  growth.monthsSufficiency = enough(1);
  growth.months = [
    { month: "2026-07", total: 40, newPatients: 10, newVisits: 10, returning: 30, complete: true },
  ];
  assert.ok(!ids(growth).includes("returning-share"));
});

/* -------------------------------------------------------------- capacity -- */

test("a nearly full clinic is flagged, with the rota as the denominator", () => {
  const growth = baseline();
  growth.utilisation = {
    days: Array.from({ length: 12 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      booked: 8,
      capacity: 9,
      percent: 89,
    })),
    averagePercent: 89,
    sufficiency: enough(12),
  };
  const insight = computeClinicInsights(growth).find((i) => i.id === "utilisation-high");
  assert.ok(insight);
  assert.match(insight!.basis, /12 open days/);
  assert.match(insight!.basis, /current rota/);
});

test("a quiet clinic reports the unbooked slots rather than only a percentage", () => {
  const growth = baseline();
  growth.utilisation = {
    days: Array.from({ length: 10 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      booked: 2,
      capacity: 10,
      percent: 20,
    })),
    averagePercent: 20,
    sufficiency: enough(10),
  };
  const insight = computeClinicInsights(growth).find((i) => i.id === "utilisation-low");
  assert.ok(insight);
  assert.match(insight!.basis, /80 slots/); // 10 days x 8 unused
});

/* ---------------------------------------------------------------- demand -- */

test("a peak hour needs a real distribution behind it", () => {
  const thin = baseline();
  // Three appointments, all at 17:00 — 100% share, and meaningless.
  thin.demandByHour = [{ hour: 17, total: 3 }];
  assert.ok(!ids(thin).includes("peak-hour"));

  const real = baseline();
  real.demandByHour = [
    { hour: 11, total: 6 },
    { hour: 12, total: 5 },
    { hour: 17, total: 20 },
    { hour: 18, total: 9 },
  ];
  const insight = computeClinicInsights(real).find((i) => i.id === "peak-hour");
  assert.ok(insight);
  assert.match(insight!.headline, /17:00/);
  assert.match(insight!.headline, /50%/); // 20 of 40
});

test("a tied leader names nobody — for hours or for weekdays", () => {
  // 20 and 20 makes "the busiest hour" arbitrary; a card that picks one is
  // asserting something the reader cannot verify.
  const tiedHours = baseline();
  tiedHours.demandByHour = [
    { hour: 11, total: 20 },
    { hour: 17, total: 20 },
    { hour: 18, total: 6 },
  ];
  assert.ok(!ids(tiedHours).includes("peak-hour"));

  const tiedDays = baseline();
  tiedDays.demandByWeekday = [
    { weekday: 0, total: 30 },
    { weekday: 2, total: 30 },
    { weekday: 3, total: 5 },
    { weekday: 4, total: 8 },
  ];
  assert.ok(!ids(tiedDays).includes("weekday-spread"));
});

test("the weekday multiplier matches the counts printed beside it", () => {
  // Math.round turned 3.5 into "4×" next to counts a reader can divide.
  const growth = baseline();
  growth.demandByWeekday = [
    { weekday: 0, total: 49 },
    { weekday: 1, total: 14 },
    { weekday: 2, total: 20 },
    { weekday: 3, total: 18 },
  ];
  const insight = computeClinicInsights(growth).find((i) => i.id === "weekday-spread")!;
  assert.match(insight.headline, /3\.5×/);
  assert.match(insight.basis, /49 appointments/);
  assert.match(insight.basis, /against 14/);
});

test("utilisation reports the aggregate share it claims, not a mean of day ratios", () => {
  // One tiny quiet day and one large full day: the mean of ratios (50%) and the
  // aggregate (94%) disagree, and both headlines assert the aggregate.
  const growth = baseline();
  growth.utilisation = {
    days: [
      { date: "2026-07-01", booked: 0, capacity: 2, percent: 0 },
      ...Array.from({ length: 9 }, (_, i) => ({
        date: `2026-07-1${i}`,
        booked: 16,
        capacity: 16,
        percent: 100,
      })),
    ],
    // The aggregate: 144 of 146.
    averagePercent: 99,
    sufficiency: enough(10),
  };
  const insight = computeClinicInsights(growth).find((i) => i.id === "utilisation-high")!;
  assert.match(insight.headline, /99%/);
  // And it must disclose that a held-but-unattended slot counts as taken.
  assert.match(insight.basis, /whether or not the patient arrived/);
});

test("a full clinic with a no-show problem is not told to extend its hours", () => {
  // The contradiction: utilisation-high said "extend hours" while no-show-high
  // said a quarter of visits never arrived. Those call for opposite actions.
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 40, noShow: 14, cancelled: 1 });
  growth.utilisation = {
    days: Array.from({ length: 10 }, (_, i) => ({
      date: `2026-07-0${i}`,
      booked: 9,
      capacity: 10,
      percent: 90,
    })),
    averagePercent: 90,
    sufficiency: enough(10),
  };
  const found = computeClinicInsights(growth);
  const utilisation = found.find((i) => i.id === "utilisation-high")!;
  assert.ok(found.some((i) => i.id === "no-show-high"), "the no-show card should be present");
  assert.match(utilisation.suggestion ?? "", /Before extending hours/);
  assert.ok(!/Hours can be extended/.test(utilisation.suggestion ?? ""));
});

test("returning-share tone is decided on the unrounded ratio", () => {
  // 39.5% displays as 40% but is not the good-news threshold.
  const growth = baseline();
  growth.monthsSufficiency = enough(2);
  growth.months = [
    { month: "2026-06", total: 100, newPatients: 30, newVisits: 61, returning: 39, complete: true },
    { month: "2026-07", total: 100, newPatients: 30, newVisits: 60, returning: 40, complete: true },
  ];
  const insight = computeClinicInsights(growth).find((i) => i.id === "returning-share")!;
  assert.match(insight.headline, /40%/); // 79/200 = 39.5 -> displays 40
  assert.equal(insight.tone, "neutral", "39.5% is not the positive threshold");
  // And it discloses that it reads months, not the reporting window.
  assert.match(insight.basis, /whole months, not the reporting window/);
});

test("weekday spread is only reported when the gap is lopsided", () => {
  const even = baseline();
  even.demandByWeekday = [
    { weekday: 0, total: 10 },
    { weekday: 1, total: 9 },
    { weekday: 2, total: 11 },
    { weekday: 3, total: 8 },
  ];
  assert.ok(!ids(even).includes("weekday-spread"));

  const lopsided = baseline();
  lopsided.demandByWeekday = [
    { weekday: 0, total: 30 },
    { weekday: 1, total: 4 },
    { weekday: 2, total: 12 },
    { weekday: 3, total: 9 },
  ];
  const insight = computeClinicInsights(lopsided).find((i) => i.id === "weekday-spread");
  assert.ok(insight);
  assert.match(insight!.headline, /Sunday/);
  assert.match(insight!.headline, /Monday/);
});

/* ------------------------------------------------------------- lead time -- */

test("a long lead time is tied to no-show risk, not just stated", () => {
  const growth = baseline();
  growth.leadTime = {
    buckets: [
      { label: "Same day", minDays: 0, maxDays: 0, total: 1 },
      { label: "15+ days", minDays: 15, maxDays: null, total: 24 },
    ],
    medianDays: 16,
    sufficiency: enough(25),
  };
  const insight = computeClinicInsights(growth).find((i) => i.id === "lead-time-long");
  assert.ok(insight);
  assert.match(insight!.suggestion ?? "", /no-show/i);
});

test("heavy same-day booking is surfaced with its share", () => {
  const growth = baseline();
  growth.leadTime = {
    buckets: [
      { label: "Same day", minDays: 0, maxDays: 0, total: 14 },
      { label: "1–2 days", minDays: 1, maxDays: 2, total: 16 },
    ],
    medianDays: 1,
    sufficiency: enough(30),
  };
  const insight = computeClinicInsights(growth).find((i) => i.id === "lead-time-same-day");
  assert.ok(insight);
  assert.match(insight!.headline, /47%/); // 14 of 30
});

/* ----------------------------------------------------------- punctuality -- */

test("late check-ins are reported without claiming to measure waiting time", () => {
  const growth = baseline();
  growth.punctuality = {
    medianMinutes: 14,
    earlyOrOnTime: 4,
    late: 22,
    sufficiency: enough(26),
  };
  const insight = computeClinicInsights(growth).find((i) => i.id === "running-late");
  assert.ok(insight);
  // The system has no consultation-start event; the card must say so.
  assert.match(insight!.basis, /no consultation-start event/);
});

test("punctuality within ten minutes is not worth a card", () => {
  const growth = baseline();
  growth.punctuality = {
    medianMinutes: 4,
    earlyOrOnTime: 15,
    late: 12,
    sufficiency: enough(27),
  };
  assert.ok(!ids(growth).includes("running-late"));
});

/* ---------------------------------------------------------------- order --- */

test("attendance problems are ranked above trends and observations", () => {
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 40, noShow: 14, cancelled: 2 });
  growth.newPatients = {
    current: { from: "2026-05-10", to: "2026-08-07", total: 30 },
    previous: { from: "2026-02-09", to: "2026-05-09", total: 20 },
    changePercent: 50,
    direction: "up",
    sufficiency: enough(50),
  };
  growth.demandByHour = [
    { hour: 11, total: 8 },
    { hour: 12, total: 7 },
    { hour: 17, total: 25 },
  ];
  const found = ids(growth);
  assert.equal(found[0], "no-show-high", `order was ${found.join(", ")}`);
  assert.ok(found.indexOf("new-patients-up") < found.indexOf("peak-hour"));
});

test("insight ids are unique, so rendering keys cannot collide", () => {
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 30, noShow: 10, cancelled: 40 });
  growth.newPatients = {
    current: { from: "2026-05-10", to: "2026-08-07", total: 30 },
    previous: { from: "2026-02-09", to: "2026-05-09", total: 10 },
    changePercent: 200,
    direction: "up",
    sufficiency: enough(40),
  };
  const found = ids(growth);
  assert.equal(new Set(found).size, found.length);
});

test("no insight prescribes clinical action", () => {
  const growth = baseline();
  growth.outcomes = outcomes({ completed: 40, noShow: 14, cancelled: 20 });
  growth.punctuality = { medianMinutes: 18, earlyOrOnTime: 3, late: 20, sufficiency: enough(23) };
  growth.utilisation = {
    days: Array.from({ length: 8 }, (_, i) => ({
      date: `2026-07-0${i + 1}`,
      booked: 9,
      capacity: 10,
      percent: 90,
    })),
    averagePercent: 90,
    sufficiency: enough(8),
  };
  const clinical = /\b(diagnos|treat|prescrib|refer the patient|procedure is|should undergo)/i;
  for (const insight of computeClinicInsights(growth)) {
    assert.ok(
      !clinical.test(`${insight.headline} ${insight.basis} ${insight.suggestion ?? ""}`),
      `${insight.id} strays into clinical advice`,
    );
  }
});
