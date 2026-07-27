import { NextRequest, NextResponse } from "next/server";
import { getUnavailableSlots, holdAppointment } from "@/db/bookings";

const branchSchedules: Record<string, string[]> = {
  Maadi: ["11:00", "13:00", "16:30", "19:00"],
  Mohandessin: ["10:30", "14:00", "17:30", "20:00"],
  "Fifth Settlement": ["12:00", "15:30", "18:00", "20:30"],
};

function availableDates(count = 6) {
  const dates: Date[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  while (dates.length < count) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() !== 5) dates.push(new Date(cursor));
  }
  return dates;
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export async function GET(request: NextRequest) {
  const branch = request.nextUrl.searchParams.get("branch") || "Maadi";
  const service =
    request.nextUrl.searchParams.get("service") || "Aesthetic consultation";
  const schedule = branchSchedules[branch] ?? branchSchedules.Maadi;
  const days = availableDates();
  const keys = days.map(dateKey);

  try {
    const unavailable = await getUnavailableSlots(branch, keys);
    return NextResponse.json({
      branch,
      service,
      generatedAt: new Date().toISOString(),
      dates: days.map((date) => {
        const key = dateKey(date);
        return {
          date: key,
          weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date),
          day: new Intl.DateTimeFormat("en-US", {
            day: "2-digit",
            month: "short",
          }).format(date),
          slots: schedule.filter((time) => !unavailable.has(`${key}|${time}`)),
        };
      }),
    });
  } catch (error) {
    console.error("availability", error);
    return NextResponse.json(
      { message: "Availability is refreshing. Please try again." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    branch?: string;
    service?: string;
    slotDate?: string;
    slotTime?: string;
  };
  if (
    !body.branch ||
    !body.service ||
    !body.slotDate ||
    !body.slotTime ||
    !branchSchedules[body.branch]?.includes(body.slotTime)
  ) {
    return NextResponse.json(
      { message: "Please select a valid appointment." },
      { status: 400 },
    );
  }

  try {
    const hold = await holdAppointment({
      branch: body.branch,
      service: body.service,
      slotDate: body.slotDate,
      slotTime: body.slotTime,
    });
    return NextResponse.json(hold, { status: 201 });
  } catch (error) {
    console.error("hold appointment", error);
    return NextResponse.json(
      { message: "That time was just reserved. Choose another slot." },
      { status: 409 },
    );
  }
}
