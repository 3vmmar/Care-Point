import { NextRequest, NextResponse } from "next/server";
import {
  listNotificationJobs,
  notificationQueueSummary,
  retryNotificationJob,
  type NotificationStatus,
} from "@/db/notifications";
import { recordAccess } from "@/db/audit";
import { getClinicStaff } from "@/lib/auth";
import { notificationConfiguration } from "@/lib/notify";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";
import { processNotificationQueue } from "@/lib/notification-worker";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };
const FILTER_STATUSES: NotificationStatus[] = [
  "pending",
  "processing",
  "retrying",
  "blocked",
  "delivered",
  "skipped",
  "dead",
];

export async function GET(request: NextRequest) {
  const staff = await getClinicStaff();
  if (!staff) {
    return NextResponse.json(
      { message: "Authentication required." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  const rawStatus = request.nextUrl.searchParams.get("status");
  const status = FILTER_STATUSES.includes(rawStatus as NotificationStatus)
    ? (rawStatus as NotificationStatus)
    : undefined;
  try {
    const [jobs, summary] = await Promise.all([
      listNotificationJobs(status, Number(request.nextUrl.searchParams.get("limit")) || 100),
      notificationQueueSummary(),
    ]);
    await recordAccess({
      actor: staff.email,
      action: "list",
      subjectCount: jobs.length,
      clientHash: await clientFingerprint(request),
      detail: `notification jobs${status ? ` status=${status}` : ""}`,
    });
    return NextResponse.json(
      { jobs, summary, providers: notificationConfiguration() },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/notifications" });
    return NextResponse.json(
      { message: "The notification queue is unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const staff = await getClinicStaff();
  if (!staff) {
    return NextResponse.json(
      { message: "Authentication required." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  let body: { id?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }
  if (body.action === "process") {
    try {
      const outcome = await processNotificationQueue(25);
      await recordAccess({
        actor: staff.email,
        action: "update",
        subjectCount: outcome.claimed,
        clientHash: await clientFingerprint(request),
        detail: "notification queue manual run",
      });
      return NextResponse.json({ ok: true, outcome }, { headers: PRIVATE_HEADERS });
    } catch (error) {
      await reportError(error, { where: "POST /api/clinic/notifications process" });
      return NextResponse.json(
        { message: "The queue could not be processed." },
        { status: 500, headers: PRIVATE_HEADERS },
      );
    }
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id || body.action !== "retry") {
    return NextResponse.json({ message: "Unknown notification action." }, { status: 400 });
  }
  try {
    const retried = await retryNotificationJob(id);
    if (!retried) {
      return NextResponse.json(
        { message: "That delivery cannot be retried." },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    await recordAccess({
      actor: staff.email,
      action: "update",
      subjectId: id,
      clientHash: await clientFingerprint(request),
      detail: "notification retry",
    });
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "POST /api/clinic/notifications" });
    return NextResponse.json(
      { message: "The delivery could not be retried." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
