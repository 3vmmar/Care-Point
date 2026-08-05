import { NextRequest, NextResponse } from "next/server";
import {
  countActiveHoldsForClient,
  getBookedIntervals,
  holdAppointment,
  releaseHold,
} from "@/db/bookings";
import { generateSlots, overlaps, type ScheduleContext } from "@/lib/schedule";
import {
  AVAILABILITY_WINDOW_DAYS,
  HOLD_DURATION_MINUTES,
  SERVICE_IDS,
  type Branch,
} from "@/lib/clinic";
import { getCatalogue, type Catalogue } from "@/db/catalogue";
import { formatDayLabel, isSlotBookable, openDayKeys } from "@/lib/dates";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";
import { turnstileSiteKey, verifyTurnstile } from "@/lib/turnstile";
import { getPilotPolicy } from "@/db/pilot";

/** Holds a single visitor may keep open at once, to stop slot-exhaustion abuse. */
const MAX_ACTIVE_HOLDS_PER_CLIENT = 3;

/** Availability changes the moment anyone holds a slot, so it is never cached. */
const LIVE_HEADERS = { "Cache-Control": "no-store" };

type ScheduledDay = {
  date: string;
  weekday: string;
  day: string;
  closure: string | null;
  candidates: ReturnType<typeof generateSlots>;
};

const scheduleDayCache = new Map<string, ScheduledDay[]>();

/** The scheduling rules this request should apply, drawn from the live rota. */
function contextOf(catalogue: Catalogue): ScheduleContext {
  return {
    services: catalogue.services,
    closures: catalogue.closures,
    turnaround: catalogue.turnaroundMinutes,
  };
}

/**
 * Session generation and locale formatting are stable for a given timetable.
 * Only occupancy and lead time are live, so a flash crowd should not repeat
 * hundreds of identical Intl and schedule calculations on one Worker isolate.
 *
 * Keyed on the catalogue revision as well as the branch and service: without
 * that, editing the rota in Clinic OS would keep serving yesterday's hours until
 * the isolate happened to be recycled.
 */
function scheduledDays(
  catalogue: Catalogue,
  branch: Branch,
  serviceId: string,
  days: string[],
  locale: string,
  arabic: boolean,
) {
  const key = `${catalogue.revision}|${branch.id}|${serviceId}|${locale}|${days.join(",")}`;
  const cached = scheduleDayCache.get(key);
  if (cached) return cached;

  const closureFor = (date: string) =>
    catalogue.closures.find((closure) => closure.date === date);
  const value = days.map((date) => {
    const closure = closureFor(date);
    return {
      date,
      ...formatDayLabel(date, locale),
      closure: closure ? (arabic ? closure.ar : closure.en) : null,
      candidates: generateSlots(branch, date, serviceId, contextOf(catalogue)),
    };
  });
  // The key changes with the booking window and with every rota edit; cap old
  // entries in a long-lived isolate instead of allowing an unbounded cache.
  if (scheduleDayCache.size >= 32) scheduleDayCache.clear();
  scheduleDayCache.set(key, value);
  return value;
}

export async function GET(request: NextRequest) {
  const now = new Date();

  try {
    // Policy, timetable and occupancy are independent, so they are fetched
    // together. Keeping these serial added D1 round trips to every availability
    // request and was visible in the burst p95.
    const [pilot, catalogue] = await Promise.all([getPilotPolicy(), getCatalogue()]);

    const findLiveBranch = (id: string | null | undefined) =>
      catalogue.branches.find((branch) => branch.id === id);
    const requestedBranch =
      findLiveBranch(request.nextUrl.searchParams.get("branch")) ?? catalogue.branches[0];
    const service =
      catalogue.services.find(
        (item) => item.id === request.nextUrl.searchParams.get("service"),
      ) ??
      catalogue.services.find((item) => item.id === SERVICE_IDS[0]) ??
      catalogue.services[0];
    const arabic = request.nextUrl.searchParams.get("locale") === "ar";
    const locale = arabic ? "ar-EG" : "en-GB";
    // Open days depend on the live closure calendar, so they are derived after
    // the catalogue rather than before it.
    const days = openDayKeys(AVAILABILITY_WINDOW_DAYS, now, catalogue.closures);

    const requestedBooked = await getBookedIntervals(requestedBranch.id, days);
    const pilotBranch = pilot.restrictsBooking ? findLiveBranch(pilot.branchId) : null;
    // During a bounded pilot, even a hand-crafted query is confined to the one
    // branch reception has agreed to operate. The returned branch lets the UI
    // correct an old selection without inventing an empty calendar.
    const branch = pilotBranch ?? requestedBranch;
    const booked = pilot.bookingPaused
      ? []
      : branch.id === requestedBranch.id
        ? requestedBooked
        : await getBookedIntervals(branch.id, days);

    const dates = scheduledDays(catalogue, branch, service.id, days, locale, arabic).map((day) => {
      const date = day.date;
      const onThisDay = booked.filter((item) => item.slotDate === date);

      // Slots are generated from the day's sessions and this service's
      // duration, then filtered against what is already booked. Overlap rather
      // than exact-time matching, because a 16:00 sixty-minute consultation
      // blocks 16:30 without ever occupying the string "16:30".
      const free = (pilot.bookingPaused ? [] : day.candidates).filter((slot) => {
        const clash = onThisDay.some(
          (taken) =>
            (!taken.practitioner || taken.practitioner === slot.practitioner) &&
            overlaps(
              { time: slot.time, durationMinutes: slot.durationMinutes },
              { time: taken.slotTime, durationMinutes: taken.durationMinutes },
            ),
        );
        // Lead time is applied per slot rather than by dropping whole days, so a
        // clinic open until 21:00 can still take a booking later the same day.
        return !clash && isSlotBookable(date, slot.time, now);
      });

      return {
        date,
        weekday: day.weekday,
        day: day.day,
        closure: day.closure,
        slots: Array.from(new Set(free.map((slot) => slot.time))),
        /** Times paired with who is consulting, for surfaces that show it. */
        slotDetail: free,
      };
    });

    return NextResponse.json(
      {
        branch: branch.id,
        service: service.id,
        holdMinutes: HOLD_DURATION_MINUTES,
        pilot: { status: pilot.status, branchId: pilot.branchId },
        availableBranchIds: pilot.restrictsBooking
          ? [branch.id]
          : catalogue.branches.map((item) => item.id),
        bookingPaused: pilot.bookingPaused,
        // Public booking surfaces consume the same active catalogue as the
        // server. This prevents a service disabled in Clinic OS from lingering
        // in the patient form, and keeps Dental labels, durations and branches
        // synchronized without a deployment.
        catalogue: {
          revision: catalogue.revision,
          branches: catalogue.branches,
          services: catalogue.services,
        },
        // Public by design; lets the form render a widget only when one is configured.
        turnstileSiteKey: turnstileSiteKey(),
        generatedAt: now.toISOString(),
        // Lets the hero surface a real "next available" instead of a hardcoded one.
        nextAvailable:
          dates.flatMap((day) =>
            day.slots.map((time) => ({ date: day.date, time, label: day.day })),
          )[0] ?? null,
        dates,
      },
      { headers: LIVE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "GET /api/availability" });
    return NextResponse.json(
      { message: "Availability is refreshing. Please try again." },
      { status: 503, headers: LIVE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    branch?: unknown;
    service?: unknown;
    slotDate?: unknown;
    slotTime?: unknown;
    turnstileToken?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const slotDate = typeof body.slotDate === "string" ? body.slotDate : "";
  const slotTime = typeof body.slotTime === "string" ? body.slotTime : "";

  let pilot: Awaited<ReturnType<typeof getPilotPolicy>>;
  let catalogue: Catalogue;
  try {
    [pilot, catalogue] = await Promise.all([getPilotPolicy(), getCatalogue()]);
  } catch (error) {
    await reportError(error, { where: "POST /api/availability pilot policy" });
    return NextResponse.json(
      { message: "Online booking is temporarily unavailable." },
      { status: 503, headers: LIVE_HEADERS },
    );
  }

  // Resolved against the live timetable, so a hold cannot be taken on a branch or
  // a consultation type the clinic has since retired.
  const branch = catalogue.branches.find(
    (item) => item.id === (typeof body.branch === "string" ? body.branch : null),
  );
  const service = catalogue.services.find(
    (item) => item.id === (typeof body.service === "string" ? body.service : null),
  );
  if (pilot.bookingPaused) {
    return NextResponse.json(
      { message: "Online booking is temporarily paused. Please call the clinic." },
      { status: 503, headers: LIVE_HEADERS },
    );
  }
  if (pilot.restrictsBooking && branch?.id !== pilot.branchId) {
    return NextResponse.json(
      { message: "That clinic is not accepting online pilot bookings." },
      { status: 409, headers: LIVE_HEADERS },
    );
  }

  // The offered window is regenerated here rather than trusted from the client,
  // so a request cannot hold a slot on a closed day, a past day, a day far
  // outside the bookable range, or one that no longer meets the lead time.
  const now = new Date();
  const offeredDays = openDayKeys(AVAILABILITY_WINDOW_DAYS, now, catalogue.closures);

  // The offer is regenerated from the schedule rather than trusted, so a
  // request cannot hold a time the clinic does not actually run.
  const offered =
    branch && service
      ? generateSlots(branch, slotDate, service.id, contextOf(catalogue)).find(
          (slot) => slot.time === slotTime,
        )
      : undefined;

  if (
    !branch ||
    !service ||
    !offeredDays.includes(slotDate) ||
    !offered ||
    !isSlotBookable(slotDate, slotTime, now)
  ) {
    return NextResponse.json(
      { message: "Please select a valid appointment." },
      { status: 400 },
    );
  }

  // Checked before any database work: an automated caller should not be able to
  // make us do anything at all, let alone take a slot off the calendar.
  const bot = await verifyTurnstile(
    typeof body.turnstileToken === "string" ? body.turnstileToken : null,
    request.headers.get("cf-connecting-ip"),
  );
  if (!bot.ok) {
    return NextResponse.json(
      { message: "Please complete the verification and try again.", code: bot.reason },
      { status: 403, headers: LIVE_HEADERS },
    );
  }

  try {
    const fingerprint = await clientFingerprint(request);
    if ((await countActiveHoldsForClient(fingerprint)) >= MAX_ACTIVE_HOLDS_PER_CLIENT) {
      return NextResponse.json(
        {
          message:
            "You already have appointments on hold. Complete one before reserving another.",
        },
        { status: 429 },
      );
    }

    const hold = await holdAppointment({
      branch: branch.id,
      service: service.id,
      slotDate,
      slotTime,
      practitioner: offered.practitioner,
      fingerprint,
    });
    return NextResponse.json(hold, { status: 201, headers: LIVE_HEADERS });
  } catch (error) {
    // The occupancy cells written in the same batch as the appointment are what
    // make holding atomic: a losing racer collides on a cell primary key and the
    // whole batch rolls back, rather than double-booking.
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
      return NextResponse.json(
        { message: "That time was just reserved. Choose another slot." },
        { status: 409, headers: LIVE_HEADERS },
      );
    }
    await reportError(error, { where: "POST /api/availability" });
    return NextResponse.json(
      { message: "We could not hold that time. Please try again." },
      { status: 500 },
    );
  }
}

/** Release a hold when the visitor closes or backs out of the details step. */
export async function DELETE(request: NextRequest) {
  let body: { holdToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const holdToken = typeof body.holdToken === "string" ? body.holdToken.trim() : "";
  if (!holdToken) {
    return NextResponse.json({ message: "A hold token is required." }, { status: 400 });
  }

  try {
    const released = await releaseHold(holdToken, await clientFingerprint(request));
    return NextResponse.json({ released }, { headers: LIVE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "DELETE /api/availability" });
    return NextResponse.json(
      { message: "We could not release that time. It will expire automatically." },
      { status: 500, headers: LIVE_HEADERS },
    );
  }
}
