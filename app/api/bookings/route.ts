import { NextRequest, NextResponse } from "next/server";
import { confirmAppointment, listConfirmedAppointments } from "@/db/bookings";

export async function GET() {
  try {
    const result = await listConfirmedAppointments();
    return NextResponse.json({ bookings: result.results ?? [] });
  } catch (error) {
    console.error("list bookings", error);
    return NextResponse.json({ bookings: [], demoMode: true });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    holdToken?: string;
    patientName?: string;
    patientPhone?: string;
    patientEmail?: string;
    language?: "en" | "ar";
  };
  if (!body.holdToken || !body.patientName || !body.patientPhone) {
    return NextResponse.json(
      { message: "Name and phone number are required." },
      { status: 400 },
    );
  }

  try {
    const booking = await confirmAppointment({
      holdToken: body.holdToken,
      patientName: body.patientName,
      patientPhone: body.patientPhone,
      patientEmail: body.patientEmail,
      language: body.language,
    });
    if (!booking) {
      return NextResponse.json(
        { message: "This hold expired. Please choose a new time." },
        { status: 410 },
      );
    }
    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    console.error("confirm booking", error);
    return NextResponse.json(
      { message: "We could not confirm the appointment." },
      { status: 500 },
    );
  }
}
