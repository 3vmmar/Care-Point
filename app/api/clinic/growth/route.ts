import { NextRequest, NextResponse } from "next/server";
import { getClinicGrowth } from "@/db/analytics-growth";
import { getCatalogue } from "@/db/catalogue";
import { requireStaffPermission } from "@/lib/auth";
import { reportError } from "@/lib/observability";
import { clientFingerprint } from "@/lib/request";
import { capacityServiceIds } from "@/lib/schedule";

const PRIVATE_HEADERS = { "Cache-Control": "no-store, private" };

/** Reporting windows this endpoint will compute. Each is compared against the
 *  immediately preceding window of the same length, so a 30-day request reads
 *  60 days of history. */
const GROWTH_WINDOWS = [30, 90, 180, 365] as const;

/**
 * Growth, demand and operational analytics for the Clinic OS overview.
 *
 * Aggregate-only and PII-free by construction — the queries group and count,
 * and the patient join is on a truncated phone digest that is never returned.
 * Guarded by `patient:read` all the same: knowing when a named clinic is busy
 * and how many first-time patients it saw is commercially sensitive even when
 * no individual is identifiable.
 */
export async function GET(request: NextRequest) {
  const gate = await requireStaffPermission("patient:read", {
    clientHash: await clientFingerprint(request),
  });
  if (!gate.ok) return gate.response;

  const daysParam = Number(request.nextUrl.searchParams.get("days") ?? "30");
  if (!GROWTH_WINDOWS.includes(daysParam as (typeof GROWTH_WINDOWS)[number])) {
    return NextResponse.json(
      { message: "Choose a 30, 90, 180 or 365 day reporting window." },
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

    // The schedule is passed in rather than read inside the db module: a db
    // module that reaches for request context cannot load in the Workers test
    // pool, and that mistake once made the integration suite silently run zero
    // tests. Utilisation is therefore measured against the LIVE rota, so an
    // hours change in Clinic OS moves the denominator immediately.
    const growth = await getClinicGrowth({
      days: daysParam,
      branch: requestedBranch || undefined,
      schedule: {
        services: catalogue.services,
        closures: catalogue.closures,
        turnaround: catalogue.turnaroundMinutes,
      },
      capacityServices: capacityServiceIds(catalogue.services),
    });

    return NextResponse.json({ growth }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await reportError(error, { where: "GET /api/clinic/growth" });
    return NextResponse.json(
      { message: "Clinic growth analytics are temporarily unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
