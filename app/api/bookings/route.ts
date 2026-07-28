import { NextRequest, NextResponse } from "next/server";
import {
  confirmAppointment,
  getBookingSummary,
  listConfirmedAppointments,
} from "@/db/bookings";
import { getClinicStaff } from "@/lib/auth";

const NAME_MAX = 120;
const EMAIL_MAX = 200;
/** Deliberately permissive: international formats vary, we only reject nonsense. */
const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/;

/**
 * Staff-only: this response contains patient names, phone numbers and email
 * addresses. It must never be reachable unauthenticated.
 */
export async function GET() {
  const staff = await getClinicStaff();
  if (!staff) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  try {
    const [bookings, summary] = await Promise.all([
      listConfirmedAppointments(),
      getBookingSummary(),
    ]);
    return NextResponse.json({ bookings, summary });
  } catch (error) {
    console.error("list bookings failed", error);
    return NextResponse.json(
      { message: "The appointment database is unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    holdToken?: unknown;
    patientName?: unknown;
    patientPhone?: unknown;
    patientEmail?: unknown;
    language?: unknown;
    consent?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const holdToken = typeof body.holdToken === "string" ? body.holdToken.trim() : "";
  const patientName =
    typeof body.patientName === "string" ? body.patientName.trim() : "";
  const patientPhone =
    typeof body.patientPhone === "string" ? body.patientPhone.trim() : "";
  const patientEmail =
    typeof body.patientEmail === "string" ? body.patientEmail.trim() : "";
  const language = body.language === "ar" ? "ar" : "en";

  if (!holdToken || !patientName || !patientPhone) {
    return NextResponse.json(
      { message: "Name and phone number are required." },
      { status: 400 },
    );
  }
  if (patientName.length > NAME_MAX || patientEmail.length > EMAIL_MAX) {
    return NextResponse.json({ message: "Those details look too long." }, { status: 400 });
  }
  if (!PHONE_PATTERN.test(patientPhone)) {
    return NextResponse.json(
      { message: "Please enter a valid phone number." },
      { status: 400 },
    );
  }
  // Consent to be contacted is a condition of booking and is recorded against
  // the appointment, so it has to be verified server-side rather than trusted
  // to a `required` checkbox in the browser.
  if (body.consent !== true) {
    return NextResponse.json(
      { message: "Please agree to be contacted so the clinic can confirm your visit." },
      { status: 400 },
    );
  }

  try {
    const booking = await confirmAppointment({
      holdToken,
      patientName,
      patientPhone,
      patientEmail: patientEmail || undefined,
      language,
    });
    if (!booking) {
      return NextResponse.json(
        { message: "This hold expired. Please choose a new time." },
        { status: 410 },
      );
    }
    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    console.error("confirm booking failed", error);
    return NextResponse.json(
      { message: "We could not confirm the appointment." },
      { status: 500 },
    );
  }
}
