import type { ClinicGrowth } from "@/db/analytics-growth";

/**
 * Computed insights for the Clinic OS overview.
 *
 * WHAT THIS IS. Deterministic rules over figures the clinic's own appointment
 * book already produced. Each insight carries the arithmetic that produced it,
 * so a doctor can check the claim instead of trusting it.
 *
 * WHAT IT IS NOT. It is not an AI, and it is deliberately not labelled as one.
 * This project already presents a keyword matcher as an "AI concierge" (NOOR)
 * and that is logged as an unresolved production risk; adding a second such
 * badge to a medical dashboard would repeat the mistake in the one place a
 * practice makes money decisions. "Computed" is both accurate and, to a
 * clinician, more credible than "AI".
 *
 * THREE RULES EVERY INSIGHT OBEYS
 *
 *  1. It shows its working. `basis` is the sum, not a restatement of the claim.
 *  2. It refuses rather than guesses. Every rule is gated on the sufficiency
 *     flag of the figure it reads; too little history produces NO card, never
 *     a hedged one. A dashboard that says "no-shows may be rising" on four
 *     appointments is worse than one that says nothing.
 *  3. It never prescribes clinical action. Suggestions are operational —
 *     hours, reminders, capacity. Nothing here interprets a diagnosis, and
 *     nothing implies an outcome.
 *
 * Pure by design: no database, no request context, no clock. That makes every
 * rule exhaustively unit-testable, which is the only way to be sure a
 * threshold cannot fire on data that does not support it.
 */

export type InsightTone = "positive" | "attention" | "neutral";

export type ClinicInsight = {
  /** Stable across renders so React keys and tests do not depend on order. */
  id: string;
  /** The finding, as a sentence. Never a question, never a hedge. */
  headline: string;
  /** The arithmetic. What was counted, over what window, to get the headline. */
  basis: string;
  /** Operational, optional, never clinical. */
  suggestion?: string;
  tone: InsightTone;
};

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Derives every insight the data supports, most decision-relevant first.
 *
 * Order is fixed rather than scored: attendance problems cost money today,
 * growth describes the trend, and capacity or timing observations are useful
 * but rarely urgent. A practice reading top-down should meet the thing that
 * needs acting on first.
 */
export function computeClinicInsights(growth: ClinicGrowth): ClinicInsight[] {
  const insights: ClinicInsight[] = [];
  const windowLabel = `the last ${growth.window.days} days`;

  /* ------------------------------------------------------ attendance ----- */
  const { outcomes } = growth;
  if (outcomes.sufficiency.ok && outcomes.noShowRate !== null) {
    const lostSlots = outcomes.noShow;
    // The headline states the SAME number as the basis. Rounding it produced a
    // card whose own working contradicted it — 45.5% became "almost 46%",
    // which is both a different figure and the wrong direction.
    if (outcomes.noShowRate >= 15) {
      insights.push({
        id: "no-show-high",
        headline: `${outcomes.noShowRate}% of visits with a known outcome did not arrive.`,
        basis: `${plural(lostSlots, "no-show")} against ${outcomes.arrived} that arrived over ${windowLabel} — ${outcomes.noShowRate}% of the ${outcomes.decided} visits whose attendance is known. Checked-in visits count as arrived even before staff mark them completed.`,
        suggestion:
          "Reminders are the usual lever here; the notification queue can send them once a provider is configured.",
        tone: "attention",
      });
    } else if (outcomes.noShowRate <= 5) {
      insights.push({
        id: "no-show-low",
        headline: `Attendance is strong — ${outcomes.noShowRate}% of visits with a known outcome were missed.`,
        basis: `${plural(lostSlots, "no-show")} against ${outcomes.arrived} that arrived over ${windowLabel}.`,
        tone: "positive",
      });
    }
  }

  // Cancellations are counted separately from no-shows on purpose: a cancelled
  // slot came back to the calendar and could be refilled, a no-show could not.
  //
  // Gated on the same sufficiency as the rest of the attendance block — it sat
  // outside it, and fired on one cancellation against one completed visit. The
  // comparison is strict, because the headline says "more": at 40 against 40 it
  // was asserting something its own basis disproved one line below.
  if (
    outcomes.sufficiency.ok &&
    outcomes.arrived > 0 &&
    outcomes.cancelled > outcomes.arrived
  ) {
    insights.push({
      id: "cancellations-outweigh",
      headline: "More visits were cancelled than went ahead.",
      basis: `${plural(outcomes.cancelled, "cancellation")} against ${outcomes.arrived} that arrived over ${windowLabel}. Cancelled slots return to the calendar; no-shows do not.`,
      suggestion:
        "Insights → Attrition breaks these down by the reason patients and staff recorded.",
      tone: "attention",
    });
  }

  /* ---------------------------------------------------------- growth ----- */
  const newPatients = growth.newPatients;
  if (newPatients.sufficiency.ok && newPatients.changePercent !== null) {
    const change = newPatients.changePercent;
    if (change >= 15) {
      insights.push({
        id: "new-patients-up",
        headline: `First-time patients are up ${change}% on the previous period.`,
        basis: `${newPatients.current.total} first visits in ${windowLabel}, against ${newPatients.previous.total} in the ${growth.window.days} days before. Matched on phone number within the ${growth.identityHorizonDays}-day retention window.`,
        tone: "positive",
      });
    } else if (change <= -15) {
      insights.push({
        id: "new-patients-down",
        headline: `First-time patients are down ${Math.abs(change)}% on the previous period.`,
        basis: `${newPatients.current.total} first visits in ${windowLabel}, against ${newPatients.previous.total} in the ${growth.window.days} days before.`,
        suggestion:
          "Insights → Booking source shows which routes brought the earlier ones.",
        tone: "attention",
      });
    }
  }

  // Returning share says something growth alone cannot: whether people come
  // back. A practice can grow on first visits while retaining nobody.
  const completedMonths = growth.months.filter((month) => month.complete && month.total > 0);
  if (growth.monthsSufficiency.ok && completedMonths.length >= 2) {
    const totals = completedMonths.reduce(
      (sum, month) => ({
        total: sum.total + month.total,
        returning: sum.returning + month.returning,
      }),
      { total: 0, returning: 0 },
    );
    if (totals.total >= 20) {
      const share = Math.round((totals.returning / totals.total) * 100);
      insights.push({
        id: "returning-share",
        headline: `${share}% of appointments are return visits.`,
        // "Appointments", not "visits", and "return visit", not "returning
        // patient": the figure counts rows, and one person booking a
        // consultation plus a same-day session is two of them.
        // States its own window: this card reads complete calendar months
        // (up to a year), not the reporting window the selector controls, so
        // it would otherwise appear to answer a question it was not asked.
        basis: `${totals.returning} of ${totals.total} appointments across ${plural(completedMonths.length, "complete month")} to ${completedMonths[completedMonths.length - 1].month} belonged to someone who had been before. This card reads whole months, not the reporting window above.`,
        // Thresholded on the unrounded ratio: a true 39.5% displayed as 40%
        // must not also be styled as good news.
        tone: totals.returning / totals.total >= 0.4 ? "positive" : "neutral",
      });
    }
  }

  /* -------------------------------------------------------- capacity ----- */
  const utilisation = growth.utilisation;
  if (utilisation.sufficiency.ok && utilisation.averagePercent !== null) {
    const days = utilisation.days;
    const unused = days.reduce((sum, day) => sum + Math.max(0, day.capacity - day.booked), 0);
    if (utilisation.averagePercent >= 85) {
      // A slot held by someone who never arrived was still unbookable by
      // anyone else, so it counts as taken here. Saying so matters: without
      // it, this card reads as "extend your hours" on the same screen where
      // the no-show card may be saying the capacity is being wasted, not
      // exhausted — and those call for opposite actions.
      const noShows = growth.outcomes.noShow;
      insights.push({
        id: "utilisation-high",
        headline: `The clinic is running at ${utilisation.averagePercent}% of published capacity.`,
        basis: `${plural(days.length, "open day")} in ${windowLabel}, against the slots the current rota offers. A booked slot counts as taken whether or not the patient arrived${noShows > 0 ? `, and ${plural(noShows, "no-show")} fall inside that` : ""}.`,
        suggestion:
          noShows > 0 && growth.outcomes.noShowRate !== null && growth.outcomes.noShowRate >= 15
            ? "Before extending hours, note the no-show figure above: some of this capacity is being held rather than used."
            : "At this level a cancellation is the only way in. Hours can be extended from Clinic OS → Hours.",
        tone: "attention",
      });
    } else if (utilisation.averagePercent <= 35 && unused > 0) {
      insights.push({
        id: "utilisation-low",
        headline: `${utilisation.averagePercent}% of published capacity is being used.`,
        basis: `${plural(unused, "slot")} went unbooked across ${plural(days.length, "open day")} in ${windowLabel}.`,
        suggestion:
          "Either demand or the published rota is the constraint — the busiest-hours chart below distinguishes them.",
        tone: "neutral",
      });
    }
  }

  /* ---------------------------------------------------------- demand ----- */
  /**
   * Demand rules gate on the appointment count itself, because that IS their
   * sufficiency: `demandByHour` has no flag of its own, and the risk here is
   * not a thin ratio but a named winner picked out of noise.
   *
   * A tie is also a winner nobody can verify — with 20 at 17:00 and 20 at
   * 18:00, naming one is arbitrary — so an unclear leader produces no card.
   */
  const hours = growth.demandByHour.filter((row) => row.total > 0);
  const totalHourly = hours.reduce((sum, row) => sum + row.total, 0);
  const hourlyTie =
    hours.length > 1 &&
    (() => {
      const sorted = [...hours].sort((a, b) => b.total - a.total);
      return sorted[0].total === sorted[1].total;
    })();
  if (hours.length >= 3 && totalHourly >= 20 && !hourlyTie) {
    const busiest = hours.reduce((best, row) => (row.total > best.total ? row : best));
    const share = Math.round((busiest.total / totalHourly) * 100);
    if (share >= 25) {
      insights.push({
        id: "peak-hour",
        headline: `${hour(busiest.hour)} is the busiest hour, taking ${share}% of bookings.`,
        basis: `${plural(busiest.total, "appointment")} at ${hour(busiest.hour)} out of ${totalHourly} across ${plural(hours.length, "hour")} in ${windowLabel}.`,
        suggestion:
          "Concentration this tight is where waiting builds up; a second practitioner in that hour spreads it.",
        tone: "neutral",
      });
    }
  }

  // Days the clinic never opened are excluded by the `total > 0` filter above
  // rather than reported as the quietest day, which would name a closure.
  const weekdays = growth.demandByWeekday.filter((row) => row.total > 0);
  const totalWeekday = weekdays.reduce((sum, row) => sum + row.total, 0);
  const weekdayTie =
    weekdays.length > 1 &&
    (() => {
      const sorted = [...weekdays].sort((a, b) => b.total - a.total);
      return sorted[0].total === sorted[1].total;
    })();
  if (weekdays.length >= 4 && totalWeekday >= 20 && !weekdayTie) {
    const quietest = weekdays.reduce((worst, row) => (row.total < worst.total ? row : worst));
    const busiest = weekdays.reduce((best, row) => (row.total > best.total ? row : best));
    // Only worth saying when the gap is genuinely lopsided.
    if (busiest.total >= quietest.total * 3) {
      insights.push({
        id: "weekday-spread",
        // One decimal, not rounded: 3.5 became "4×" beside counts of 49 and 14,
        // and a reader who divides them gets a different answer to the headline.
        headline: `${WEEKDAY[busiest.weekday]} carries ${(busiest.total / quietest.total).toFixed(1)}× the bookings of ${WEEKDAY[quietest.weekday]}.`,
        basis: `${plural(busiest.total, "appointment")} on ${WEEKDAY[busiest.weekday]} against ${quietest.total} on ${WEEKDAY[quietest.weekday]} in ${windowLabel}.`,
        tone: "neutral",
      });
    }
  }

  /* ------------------------------------------------------- lead time ----- */
  const leadTime = growth.leadTime;
  if (leadTime.sufficiency.ok && leadTime.medianDays !== null) {
    const sameDay = leadTime.buckets.find((bucket) => bucket.label === "Same day")?.total ?? 0;
    const booked = leadTime.buckets.reduce((sum, bucket) => sum + bucket.total, 0);
    const sameDayShare = booked > 0 ? Math.round((sameDay / booked) * 100) : 0;
    if (leadTime.medianDays >= 10) {
      insights.push({
        id: "lead-time-long",
        headline: `Patients book a median of ${leadTime.medianDays} days ahead.`,
        basis: `Measured from confirmation to visit across ${plural(booked, "booking")} in ${windowLabel}.`,
        suggestion:
          "A long lead time raises no-show risk; reminders matter more the further ahead people commit.",
        tone: "neutral",
      });
    } else if (sameDayShare >= 30) {
      insights.push({
        id: "lead-time-same-day",
        headline: `${sameDayShare}% of bookings are made for the same day.`,
        basis: `${plural(sameDay, "same-day booking")} out of ${booked} in ${windowLabel}; the median notice is ${leadTime.medianDays} day${leadTime.medianDays === 1 ? "" : "s"}.`,
        suggestion: "Same-day demand rewards keeping a slot or two unpublished.",
        tone: "neutral",
      });
    }
  }

  /* ----------------------------------------------------- running late ---- */
  const punctuality = growth.punctuality;
  if (punctuality.sufficiency.ok && punctuality.medianMinutes !== null) {
    if (punctuality.medianMinutes >= 10) {
      insights.push({
        id: "running-late",
        headline: `Patients are checked in a median of ${punctuality.medianMinutes} minutes after their appointed time.`,
        basis: `${plural(punctuality.late, "visit")} checked in late against ${punctuality.earlyOrOnTime} early or on time in ${windowLabel}. This measures arrival, not waiting — the system records no consultation-start event.`,
        suggestion:
          "If arrivals are late, the schedule absorbs it; if check-in is late, the desk does.",
        tone: "attention",
      });
    }
  }

  return insights;
}
