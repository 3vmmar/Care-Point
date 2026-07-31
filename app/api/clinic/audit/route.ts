import { NextRequest, NextResponse } from "next/server";
import { listAccessLog, recordAccess } from "@/db/audit";
import { getClinicStaff } from "@/lib/auth";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/**
 * The access trail, for the clinic to read.
 *
 * An audit log nobody can inspect is bookkeeping, not accountability — the
 * point is that the practice can answer "who opened this patient's record?"
 * without a developer and a database console.
 *
 * Reading the log is itself recorded. That is deliberate: the trail must show
 * who has been reviewing it, or it becomes the one blind spot in the system.
 */
export async function GET(request: NextRequest) {
  const staff = await getClinicStaff();
  if (!staff) {
    return NextResponse.json(
      { message: "Authentication required." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const params = request.nextUrl.searchParams;

  try {
    const entries = await listAccessLog({
      limit: Number(params.get("limit")) || 100,
      actor: params.get("actor") ?? undefined,
      subjectId: params.get("subjectId") ?? undefined,
    });

    await recordAccess({
      actor: staff.email,
      action: "export",
      subjectCount: entries.length,
      clientHash: await clientFingerprint(request),
      detail: "read access log",
    });

    return NextResponse.json({ entries }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/audit" });
    return NextResponse.json(
      { message: "Could not load the access log." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
