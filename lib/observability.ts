/**
 * Error reporting.
 *
 * Until now a failure went to `console.error` inside a Worker log nobody reads,
 * which meant the clinic was the monitoring system: the first anyone knew about
 * a broken booking flow was a patient phoning to complain.
 *
 * Two deliberate constraints shape this module:
 *
 * 1. **It never breaks the request.** Every path is wrapped, delivery is
 *    fire-and-forget, and an unconfigured deployment simply logs — so adding
 *    monitoring cannot itself take the site down.
 *
 * 2. **It never ships patient data.** This is a medical system. Names, phone
 *    numbers, emails and manage tokens must not leave the estate inside a
 *    stack trace or a URL, so everything is scrubbed on the way out. That is
 *    not a nicety: sending them to a third-party tracker would be a disclosure
 *    the patient never consented to.
 *
 * Configure with SENTRY_DSN (any Sentry-compatible endpoint). ERROR_WEBHOOK_URL
 * is an alternative for clinics that would rather keep reports in-house.
 */

/** Keys whose values are replaced wholesale, whatever they contain. */
const SENSITIVE_KEYS = [
  "patientname",
  "patientphone",
  "patientemail",
  "patientnote",
  "staffnote",
  "name",
  "phone",
  "email",
  "token",
  "holdtoken",
  "managetoken",
  "authorization",
  "cookie",
  "password",
  "secret",
  "apikey",
  "fingerprint",
];

const REDACTED = "[redacted]";

/** Anything with an @ and a dot around it. */
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** Seven or more digits with optional separators — a phone number, near enough. */
const PHONE_PATTERN = /(?:\+?\d[\d\s()-]{6,}\d)/g;
/** UUIDs: manage tokens and hold tokens both look like this. */
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Strips identifying values out of free text.
 *
 * Deliberately aggressive. A slightly over-redacted stack trace is still
 * debuggable; a patient's mobile number sitting in a third-party dashboard is
 * not recoverable.
 */
export function scrubText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(UUID_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, (match) =>
      // Leave short digit runs (durations, ports, dates) alone.
      match.replace(/\D/g, "").length >= 7 ? REDACTED : match,
    );
}

/** Recursively scrubs an object destined for an error report. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (value == null) return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1));

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEYS.includes(key.toLowerCase())
        ? REDACTED
        : scrub(entry, depth + 1);
    }
    return output;
  }
  return REDACTED;
}

/** A manage token in a path would identify one patient's booking. */
export function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return `${parsed.origin}${scrubText(parsed.pathname)}`;
  } catch {
    return scrubText(url);
  }
}

export type ErrorContext = {
  /** Where it happened, e.g. "POST /api/bookings". */
  where: string;
  /** Anything that helps, minus anything identifying. */
  extra?: Record<string, unknown>;
  level?: "error" | "warning";
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

type Dsn = { endpoint: string; key: string };

/** `https://<key>@<host>/<project>` → the store endpoint and auth key. */
export function parseDsn(dsn: string): Dsn | null {
  try {
    const parsed = new URL(dsn);
    const project = parsed.pathname.replace(/^\//, "");
    if (!parsed.username || !project) return null;
    return {
      endpoint: `${parsed.protocol}//${parsed.host}/api/${project}/store/`,
      key: parsed.username,
    };
  } catch {
    return null;
  }
}

function buildPayload(error: unknown, context: ErrorContext) {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: context.level ?? "error",
    logger: "care-point",
    environment: env("ENVIRONMENT") ?? env("NODE_ENV") ?? "development",
    release: env("RELEASE") ?? undefined,
    transaction: context.where,
    exception: {
      values: [
        {
          type: err.name,
          value: scrubText(err.message),
          stacktrace: err.stack
            ? { frames: [{ filename: "worker", function: scrubText(err.stack).slice(0, 4000) }] }
            : undefined,
        },
      ],
    },
    extra: scrub(context.extra ?? {}) as Record<string, unknown>,
  };
}

/**
 * Reports an error. Returns a promise that never rejects — pass it to
 * `ctx.waitUntil` where one is available, or ignore it.
 */
export async function reportError(
  error: unknown,
  context: ErrorContext,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  // Always leave a local trace: worker logs are the fallback when the tracker
  // is unconfigured, unreachable, or itself the thing that is broken.
  console.error(`[${context.where}] ${scrubText(message)}`, context.extra ?? "");

  const payload = buildPayload(error, context);
  const attempts: Promise<unknown>[] = [];

  const dsn = env("SENTRY_DSN");
  const parsed = dsn ? parseDsn(dsn) : null;
  if (parsed) {
    attempts.push(
      fetch(parsed.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=care-point/1.0, sentry_key=${parsed.key}`,
        },
        body: JSON.stringify(payload),
      }),
    );
  }

  const webhook = env("ERROR_WEBHOOK_URL");
  if (webhook) {
    attempts.push(
      fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  }

  if (attempts.length === 0) return;

  try {
    await Promise.allSettled(attempts);
  } catch {
    // Reporting a failure must never become a second failure.
  }
}

/** True when a tracker is configured — surfaced on the health endpoint. */
export function errorReportingConfigured(): boolean {
  return Boolean(env("SENTRY_DSN") || env("ERROR_WEBHOOK_URL"));
}
