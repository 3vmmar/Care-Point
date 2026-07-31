import { NextResponse } from "next/server";
import { checkDatabase } from "@/db/bookings";
import { errorReportingConfigured } from "@/lib/observability";
import { staffAllowlistConfigured } from "@/lib/auth";
import { notificationsConfigured } from "@/lib/notify";
import { turnstileConfigured } from "@/lib/turnstile";
import { clinicTimeNow, clinicToday } from "@/lib/dates";

/**
 * Liveness and readiness, for an external uptime monitor.
 *
 * Deliberately public and deliberately thin: it must be reachable without
 * credentials to be useful, so it exposes no version numbers, no configuration
 * values and no patient data — only whether each dependency answers.
 *
 * A 200 means the booking flow can serve requests. Anything else should page
 * someone. `degraded` covers the case where the site is up but a deployment
 * step was missed, which is worth an alert but not an emergency.
 */
export async function GET() {
  const started = Date.now();
  const database = await checkDatabase();

  // Configuration gaps that would silently break the clinic rather than the
  // site: bookings nobody is told about, errors nobody sees, a dashboard
  // nobody can open.
  const configuration = {
    notifications: notificationsConfigured(),
    errorReporting: errorReportingConfigured(),
    staffAllowlist: staffAllowlistConfigured(),
    botProtection: turnstileConfigured(),
  };

  const misconfigured = Object.values(configuration).filter((ok) => !ok).length;
  const status = !database.ok ? "unhealthy" : misconfigured > 0 ? "degraded" : "ok";

  return NextResponse.json(
    {
      status,
      database: database.ok ? "ok" : "unreachable",
      configuration,
      clinicDate: clinicToday(),
      clinicTime: clinicTimeNow(),
      latencyMs: Date.now() - started,
    },
    {
      // 503 is what an uptime monitor understands as "page someone"; a degraded
      // deployment still serves patients, so it stays a 200 with a flag.
      status: database.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
