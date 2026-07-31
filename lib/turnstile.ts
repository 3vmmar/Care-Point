/**
 * Bot protection for the hold endpoint.
 *
 * Holding a slot is the one unauthenticated action that takes something away
 * from other people: every hold removes a real appointment time from the
 * calendar for five minutes. A trivial script can therefore empty the clinic's
 * entire book and keep it empty, and the IP-plus-user-agent limiter in the
 * route is a speed bump rather than a defence — rotating the user agent walks
 * straight past it, while Cairo's carrier-grade NAT means tightening it would
 * punish real patients who share an address.
 *
 * Cloudflare Turnstile is the right tool: no puzzles for the patient in the
 * common case, and a real signal for us.
 *
 * Configured with TURNSTILE_SITE_KEY (public, sent to the browser) and
 * TURNSTILE_SECRET_KEY (private). With neither set the checks are skipped
 * entirely, so development and the current demo are unaffected.
 */

const VERIFY_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * The public site key, safe to embed in the page.
 *
 * Served through the availability response rather than inlined at build time,
 * because the key is deployment-specific and the build should not need to be
 * repeated to rotate it.
 */
export function turnstileSiteKey(): string | null {
  return env("TURNSTILE_SITE_KEY") ?? null;
}

/**
 * Whether verification is enforced.
 *
 * Both halves are required. A site key without a secret would render a widget
 * whose answer is never checked — security theatre that costs the patient a
 * round trip and buys nothing.
 */
export function turnstileConfigured(): boolean {
  return Boolean(env("TURNSTILE_SITE_KEY") && env("TURNSTILE_SECRET_KEY"));
}

export type TurnstileResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; reason: string };

type SiteVerifyResponse = {
  success: boolean;
  "error-codes"?: string[];
};

/**
 * Verifies a Turnstile token with Cloudflare.
 *
 * Fails **closed** when configured: if the token is missing, invalid, or the
 * verification call itself errors, the hold is refused. The alternative —
 * letting requests through when the check cannot be completed — means an
 * attacker only has to break the verifier to disable the protection.
 *
 * The patient-facing cost of a false refusal is one retry; the cost of a false
 * pass is an emptied calendar.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  const secret = env("TURNSTILE_SECRET_KEY");
  if (!secret || !env("TURNSTILE_SITE_KEY")) {
    return { ok: true, skipped: true };
  }
  if (!token) return { ok: false, reason: "missing-token" };

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);

  try {
    const response = await fetch(VERIFY_ENDPOINT, { method: "POST", body: form });
    if (!response.ok) return { ok: false, reason: `verify-http-${response.status}` };

    const result = (await response.json()) as SiteVerifyResponse;
    if (result.success) return { ok: true };
    return { ok: false, reason: result["error-codes"]?.join(",") || "rejected" };
  } catch {
    return { ok: false, reason: "verify-unreachable" };
  }
}
