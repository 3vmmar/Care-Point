import { NextRequest, NextResponse } from "next/server";
import { listAccessLog, recordAccess } from "@/db/audit";
import { listSecurityEvents } from "@/db/staff";
import { requireStaffPermission } from "@/lib/auth";
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
 *
 * Returns two trails. `entries` is patient access — who opened whose record.
 * `security` is authentication and authorisation — who signed in, who was
 * refused, whose permissions changed. Both are needed to investigate an
 * incident, and the second is the only one that has anything to say when the
 * attacker never got as far as a patient record.
 */
export async function GET(request: NextRequest) {
  const gate = await requireStaffPermission("audit:read", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;
  const staff = gate.staff;

  const params = request.nextUrl.searchParams;

  try {
    const limit = Number(params.get("limit")) || 100;
    const [entries, security] = await Promise.all([
      listAccessLog({
        limit,
        actor: params.get("actor") ?? undefined,
        subjectId: params.get("subjectId") ?? undefined,
      }),
      listSecurityEvents({ limit, actor: params.get("actor") ?? undefined }),
    ]);

    await recordAccess({
      actor: staff.email,
      action: "export",
      subjectCount: entries.length,
      clientHash: await clientFingerprint(request),
      detail: "read access log",
    });

    return NextResponse.json({ entries, security }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/audit" });
    return NextResponse.json(
      { message: "Could not load the access log." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
