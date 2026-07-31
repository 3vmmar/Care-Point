/** Cloudflare Worker entry point. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  appointmentsNeedingReminder,
  purgeExpiredContactDetails,
  releaseExpiredHolds,
} from "../db/bookings";
import { sanitiseRequest } from "../lib/trusted-proxy";
import { rejectCrossSite } from "../lib/csrf";
import { reportError } from "../lib/observability";
import { purgeExpiredAuditLog } from "../db/audit";
import { enforceSurfaceBoundary } from "../lib/surface";
import { purgeNotificationHistory, queueReminder } from "../db/notifications";
import { processNotificationQueue } from "../lib/notification-worker";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** `patient` and `clinic` are deployed independently; local dev uses `combined`. */
  APP_SURFACE?: string;
  PUBLIC_SITE_URL?: string;
  CLINIC_DASHBOARD_URL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

/**
 * Response headers applied to every document.
 *
 * The site renders patient-identifying pages (`/command-center`,
 * `/appointment/*`), so clickjacking and referrer leakage are not theoretical:
 * a framed dashboard or a manage-token leaked through `Referer` both expose
 * real patient data.
 *
 * The CSP allows inline styles and scripts because the framework emits both;
 * it still removes the classes of attack that matter most here by pinning every
 * other source to this origin and forbidding framing outright.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://challenges.cloudflare.com",
    // Turnstile renders its challenge in a frame served from Cloudflare.
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** The trigger that carries the once-a-day jobs. Must match `vite.config.ts`. */
const DAILY_CRON = "0 3 * * *";

/**
 * Tomorrow's reminders are written to the same durable outbox as every other
 * booking event. Queueing and delivery have separate timestamps, so a provider
 * outage cannot make an unsent reminder look successful.
 */
async function sendDueReminders(): Promise<void> {
  let due: Awaited<ReturnType<typeof appointmentsNeedingReminder>>;
  try {
    due = await appointmentsNeedingReminder();
  } catch (error) {
    await reportError(error, { where: "cron: read due reminders" });
    return;
  }
  if (due.length === 0) return;

  let queued = 0;
  for (const appointment of due) {
    try {
      await queueReminder({
        appointmentId: appointment.id,
        branch: appointment.branch,
        service: appointment.service,
        slotDate: appointment.slotDate,
        slotTime: appointment.slotTime,
      });
      queued += 1;
    } catch (error) {
      await reportError(error, {
        where: "cron: queue reminder",
        extra: { appointmentId: appointment.id },
      });
    }
  }
  console.log(`[cron] queued ${queued} of ${due.length} reminders`);
}

function withSecurityHeaders(response: Response): Response {
  // A body-less response (304, 204) must not be given one, and immutable
  // asset responses are cheaper to leave untouched.
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const boundaryResponse = enforceSurfaceBoundary(request, {
      surface: env.APP_SURFACE,
      publicSiteUrl: env.PUBLIC_SITE_URL,
      clinicDashboardUrl: env.CLINIC_DASHBOARD_URL,
    });
    if (boundaryResponse) return withSecurityHeaders(boundaryResponse);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    /**
     * The trust boundary.
     *
     * Staff identity arrives as `oai-authenticated-user-*` headers injected by
     * the platform's authenticating proxy — but this Worker is on the open
     * internet, so any caller can send those headers too. Stripping them here,
     * unless the request proves it came through the proxy, is what stops
     * `curl -H "oai-authenticated-user-email: <any staff address>"` from
     * returning the entire patient list.
     *
     * Done at the edge, before a single line of application code reads
     * identity, so no route can forget to check.
     */
    const { request: safeRequest, decision } = await sanitiseRequest(request);
    if (!decision.trusted && decision.reason === "no-secret-configured") {
      console.error(
        "[security] AUTH_PROXY_SECRET is not set; staff identity headers are being ignored. " +
          "The Clinic OS dashboard will refuse every sign-in until it is configured.",
      );
    }

    /**
     * Cross-site request forgery.
     *
     * Staff identity is injected by the proxy from a session, so a hostile
     * page could otherwise have a signed-in staff browser cancel appointments
     * or erase a patient. Checked here, centrally, so a new endpoint cannot
     * forget to opt in.
     */
    const blocked = rejectCrossSite(safeRequest);
    if (blocked) return withSecurityHeaders(blocked);

    return withSecurityHeaders(await handler.fetch(safeRequest, env, ctx));
  },

  /**
   * Scheduled maintenance, configured in `vite.config.ts`.
   *
   * Releasing expired holds used to run as a DELETE on every availability read,
   * which meant a database write on every page view of the booking modal. Reads
   * already ignore expired holds, so this is housekeeping and belongs here.
   */
  async scheduled(event: ScheduledEvent, _env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const released = await releaseExpiredHolds();
          if (released > 0) console.log(`[cron] released ${released} expired holds`);
        } catch (error) {
          await reportError(error, { where: "cron: release expired holds" });
        }

        // The daily trigger carries the jobs that must not run every ten minutes.
        if (event.cron === DAILY_CRON) {
          try {
            const purged = await purgeExpiredContactDetails();
            if (purged > 0) console.log(`[cron] purged contact details on ${purged} rows`);
          } catch (error) {
            await reportError(error, { where: "cron: retention purge" });
          }

          try {
            const trimmed = await purgeExpiredAuditLog();
            if (trimmed > 0) console.log(`[cron] trimmed ${trimmed} audit entries`);
          } catch (error) {
            await reportError(error, { where: "cron: audit retention" });
          }

          try {
            const trimmed = await purgeNotificationHistory();
            if (trimmed > 0) console.log(`[cron] trimmed ${trimmed} notification jobs`);
          } catch (error) {
            await reportError(error, { where: "cron: notification retention" });
          }

          await sendDueReminders();
        }

        try {
          const delivered = await processNotificationQueue();
          if (delivered.claimed > 0) {
            console.log(
              `[cron] notification queue: ${delivered.delivered} delivered, ` +
                `${delivered.retrying} retrying, ${delivered.blocked} blocked, ` +
                `${delivered.dead} dead`,
            );
          }
        } catch (error) {
          await reportError(error, { where: "cron: process notification queue" });
        }
      })(),
    );
  },
};

export default worker;
