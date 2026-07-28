import { NextRequest, NextResponse } from "next/server";
import {
  countActiveHoldsForClient,
  getUnavailableSlots,
  holdAppointment,
} from "@/db/bookings";
import {
  AVAILABILITY_WINDOW_DAYS,
  BRANCH_IDS,
  HOLD_DURATION_MINUTES,
  SERVICE_IDS,
  findBranch,
  findService,
} from "@/lib/clinic";
import { formatDayLabel, openDayKeys } from "@/lib/dates";

/** Holds a single visitor may keep open at once, to stop slot-exhaustion abuse. */
const MAX_ACTIVE_HOLDS_PER_CLIENT = 3;

/**
 * A coarse, privacy-preserving client identifier used only for hold rate
 * limiting. The raw IP is never stored — only a truncated SHA-256 digest.
 */
async function clientFingerprint(request: NextRequest): Promise<string> {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip}|${agent}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET(request: NextRequest) {
  const branch = findBranch(request.nextUrl.searchParams.get("branch")) ?? findBranch(BRANCH_IDS[0])!;
  const service =
    findService(request.nextUrl.searchParams.get("service")) ?? findService(SERVICE_IDS[0])!;
  const locale = request.nextUrl.searchParams.get("locale") === "ar" ? "ar-EG" : "en-GB";
  const days = openDayKeys(AVAILABILITY_WINDOW_DAYS);

  try {
    const unavailable = await getUnavailableSlots(branch.id, days);
    return NextResponse.json({
      branch: branch.id,
      service: service.id,
      holdMinutes: HOLD_DURATION_MINUTES,
      generatedAt: new Date().toISOString(),
      dates: days.map((date) => ({
        date,
        ...formatDayLabel(date, locale),
        slots: branch.slots.filter((time) => !unavailable.has(`${date}|${time}`)),
      })),
    });
  } catch (error) {
    console.error("availability lookup failed", error);
    return NextResponse.json(
      { message: "Availability is refreshing. Please try again." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    branch?: unknown;
    service?: unknown;
    slotDate?: unknown;
    slotTime?: unknown;
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
  // so a request cannot hold a slot on a closed day, a past day, or a date far
  // outside the bookable range.
  const offeredDays = openDayKeys(AVAILABILITY_WINDOW_DAYS);

  if (
    !branch ||
    !service ||
    !offeredDays.includes(slotDate) ||
    !branch.slots.includes(slotTime)
  ) {
    return NextResponse.json(
      { message: "Please select a valid appointment." },
      { status: 400 },
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
      fingerprint,
    });
    return NextResponse.json(hold, { status: 201 });
  } catch (error) {
    // The unique index on (branch, slot_date, slot_time) is what makes holding a
    // slot atomic: a losing racer fails here rather than double-booking.
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
      return NextResponse.json(
        { message: "That time was just reserved. Choose another slot." },
        { status: 409 },
      );
    }
    console.error("hold appointment failed", error);
    return NextResponse.json(
      { message: "We could not hold that time. Please try again." },
      { status: 500 },
    );
  }
}
