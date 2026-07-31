import { NextRequest, NextResponse } from "next/server";
import {
  countActiveHoldsForClient,
  getBookedIntervals,
  holdAppointment,
} from "@/db/bookings";
import { generateSlots, overlaps } from "@/lib/schedule";
import {
  AVAILABILITY_WINDOW_DAYS,
  BRANCH_IDS,
  HOLD_DURATION_MINUTES,
  SERVICE_IDS,
  findBranch,
  findClosure,
  findService,
} from "@/lib/clinic";
import { formatDayLabel, isSlotBookable, openDayKeys } from "@/lib/dates";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";
import { turnstileSiteKey, verifyTurnstile } from "@/lib/turnstile";

/** Holds a single visitor may keep open at once, to stop slot-exhaustion abuse. */
const MAX_ACTIVE_HOLDS_PER_CLIENT = 3;

/** Availability changes the moment anyone holds a slot, so it is never cached. */
const LIVE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const branch =
    findBranch(request.nextUrl.searchParams.get("branch")) ?? findBranch(BRANCH_IDS[0])!;
  const service =
    findService(request.nextUrl.searchParams.get("service")) ?? findService(SERVICE_IDS[0])!;
  const arabic = request.nextUrl.searchParams.get("locale") === "ar";
  const locale = arabic ? "ar-EG" : "en-GB";
  const now = new Date();
  const days = openDayKeys(AVAILABILITY_WINDOW_DAYS, now);

  try {
    const booked = await getBookedIntervals(branch.id, days);

    const dates = days.map((date) => {
      const onThisDay = booked.filter((item) => item.slotDate === date);

      // Slots are generated from the day's sessions and this service's
      // duration, then filtered against what is already booked. Overlap rather
      // than exact-time matching, because a 16:00 sixty-minute consultation
      // blocks 16:30 without ever occupying the string "16:30".
      const free = generateSlots(branch, date, service.id).filter((slot) => {
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
        ...formatDayLabel(date, locale),
        closure: findClosure(date) ? (arabic ? findClosure(date)!.ar : findClosure(date)!.en) : null,
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

  const branch = findBranch(typeof body.branch === "string" ? body.branch : null);
  const service = findService(typeof body.service === "string" ? body.service : null);
  const slotDate = typeof body.slotDate === "string" ? body.slotDate : "";
  const slotTime = typeof body.slotTime === "string" ? body.slotTime : "";

  // The offered window is regenerated here rather than trusted from the client,
  // so a request cannot hold a slot on a closed day, a past day, a day far
  // outside the bookable range, or one that no longer meets the lead time.
  const now = new Date();
  const offeredDays = openDayKeys(AVAILABILITY_WINDOW_DAYS, now);

  // The offer is regenerated from the schedule rather than trusted, so a
  // request cannot hold a time the clinic does not actually run.
  const offered =
    branch && service
      ? generateSlots(branch, slotDate, service.id).find((slot) => slot.time === slotTime)
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
