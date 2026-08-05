import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_WINDOWS,
  getClinicAnalytics,
  type AnalyticsWindowDays,
} from "@/db/analytics";
import { getCatalogue } from "@/db/catalogue";
import { requireStaffPermission } from "@/lib/auth";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/** Historical, aggregate-only reporting for Clinic OS. */
export async function GET(request: NextRequest) {
  const gate = await requireStaffPermission("patient:read", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;

  const daysParam = Number(request.nextUrl.searchParams.get("days") ?? "30");
  if (!ANALYTICS_WINDOWS.includes(daysParam as AnalyticsWindowDays)) {
    return NextResponse.json(
      { message: "Choose a 30, 90, or 180 day reporting window." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const catalogue = await getCatalogue();
    const requestedBranch = request.nextUrl.searchParams.get("branch")?.trim() || "";
    if (
      requestedBranch &&
      !catalogue.branches.some((branch) => branch.id === requestedBranch)
    ) {
      return NextResponse.json(
        { message: "That clinic is not in the live catalogue." },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }

    const analytics = await getClinicAnalytics({
      days: daysParam as AnalyticsWindowDays,
      branch: requestedBranch || undefined,
    });

    return NextResponse.json({ analytics }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/analytics" });
    return NextResponse.json(
      { message: "Clinic analytics are temporarily unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
