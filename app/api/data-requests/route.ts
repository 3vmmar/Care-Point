import { NextRequest, NextResponse } from "next/server";
import { recentRequestCount, submitDataRequest, type DataRequestKind } from "@/db/dsr";
import { notify } from "@/lib/notify";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";
import { verifyTurnstile } from "@/lib/turnstile";

const NAME_MAX = 120;
const EMAIL_MAX = 200;
const NOTE_MAX = 1000;
const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/;
const KINDS: DataRequestKind[] = ["access", "erase", "correct"];

/** Enough for a genuine mistake, not enough to be a nuisance channel. */
const MAX_REQUESTS_PER_DAY = 3;

/**
 * A patient asking for a copy of their data, a correction, or its erasure.
 *
 * This endpoint **records the request and does nothing else**. It never reads
 * back, exports or erases anything — acting on a submitted phone number would
 * mean anyone who knows a patient's number could pull their history or destroy
 * it, which would make the privacy feature the worst hole in the system.
 * The clinic verifies identity out of band, then fulfils it from the dashboard.
 *
 * Because of that, the response is deliberately identical whether or not the
 * clinic holds any records for the number given: confirming existence would
 * itself leak.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const text = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string).trim() : "";

  const kind = text("kind") as DataRequestKind;
  const requesterName = text("requesterName");
  const requesterPhone = text("requesterPhone");
  const requesterEmail = text("requesterEmail");
  const note = text("note");
  const language = text("language") === "ar" ? "ar" : "en";

  if (!KINDS.includes(kind)) {
    return NextResponse.json({ message: "Choose a request type." }, { status: 400 });
  }
  if (!requesterName || requesterName.length > NAME_MAX) {
    return NextResponse.json({ message: "Please enter your name." }, { status: 400 });
  }
  if (!PHONE_PATTERN.test(requesterPhone)) {
    return NextResponse.json(
      { message: "Please enter the phone number used to book." },
      { status: 400 },
    );
  }
  if (requesterEmail.length > EMAIL_MAX || note.length > NOTE_MAX) {
    return NextResponse.json({ message: "Those details look too long." }, { status: 400 });
  }

  const bot = await verifyTurnstile(
    typeof body.turnstileToken === "string" ? body.turnstileToken : null,
    request.headers.get("cf-connecting-ip"),
  );
  if (!bot.ok) {
    return NextResponse.json(
      { message: "Please complete the verification and try again." },
      { status: 403 },
    );
  }

  try {
    const clientHash = await clientFingerprint(request);
    if ((await recentRequestCount(clientHash)) >= MAX_REQUESTS_PER_DAY) {
      return NextResponse.json(
        { message: "We already have your request. The clinic will be in touch." },
        { status: 429 },
      );
    }

    const { id } = await submitDataRequest({
      kind,
      requesterName,
      requesterPhone,
      requesterEmail: requesterEmail || undefined,
      note: note || undefined,
      language,
      clientHash,
    });

    // A request nobody notices is a legal obligation quietly going unmet, so it
    // is announced on the same channel as a booking.
    await notify({
      kind: "data.request",
      appointment: {
        id,
        branch: "—",
        service: `data request: ${kind}`,
        slotDate: new Date().toISOString().slice(0, 10),
        slotTime: "00:00",
        patientName: requesterName,
        patientPhone: requesterPhone,
        patientEmail: requesterEmail || null,
        patientNote: note || null,
        language,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        reference: id.slice(0, 8).toUpperCase(),
        // Same wording regardless of whether any records exist.
        message:
          language === "ar"
            ? "تم استلام طلبك. سيتواصل معك فريق العيادة للتحقق من هويتك قبل تنفيذه."
            : "Your request has been received. The clinic will contact you to verify your identity before acting on it.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    await reportError(error, { where: "POST /api/data-requests" });
    return NextResponse.json(
      { message: "We could not record that request. Please call the clinic." },
      { status: 500 },
    );
  }
}
