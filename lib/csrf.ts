/**
 * Cross-site request forgery defence for state-changing endpoints.
 *
 * Staff identity arrives as a header injected by the platform proxy. If that
 * proxy derives the header from a session cookie — which is how such proxies
 * normally work — then a staff member merely *visiting* a hostile page is
 * enough for their browser to issue an authenticated request:
 *
 *     <form method="POST" action="https://clinic.example/api/clinic/data-requests"
 *           enctype="text/plain">
 *       <input name='{"id":"...","action":"fulfil","confirmed":true,"x":"' value='"}'>
 *     </form>
 *     <script>document.forms[0].submit()</script>
 *
 * The cookie rides along, the proxy adds the identity header, and a patient's
 * records are erased. Nothing in the request looks unusual to the application.
 *
 * Two independent checks close it, both relying on values a page cannot forge:
 *
 *   1. `Origin` / `Sec-Fetch-Site` — set by the browser, unsettable by script.
 *   2. `Content-Type: application/json` — an HTML form can only send
 *      urlencoded, multipart or text/plain. Anything else needs `fetch()`,
 *      which triggers a CORS preflight that a cross-origin attacker fails.
 *
 * Neither depends on a token round-trip, so there is no session state to keep
 * and nothing for the client to get wrong.
 */

/** Methods that cannot change state, so are never blocked. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type OriginDecision =
  | { ok: true; reason: "safe-method" | "same-origin" | "no-browser-signals" }
  | { ok: false; reason: "cross-site" | "foreign-origin" | "bad-content-type" };

export type OriginInput = {
  method: string;
  /** The request's own URL, used to derive the expected origin. */
  url: string;
  origin: string | null;
  secFetchSite: string | null;
  contentType: string | null;
};

export function checkSameOrigin(input: OriginInput): OriginDecision {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return { ok: true, reason: "safe-method" };
  }

  /**
   * `Sec-Fetch-Site` is the strongest signal because it is set by the browser
   * and cannot be altered by script. `same-origin` is the only acceptable
   * value: `cross-site` and `same-site` are both forgeable positions for an
   * attacker who controls a subdomain, and `none` means the request did not
   * come from a page at all, which no legitimate mutation here does.
   */
  if (input.secFetchSite && input.secFetchSite !== "same-origin") {
    return { ok: false, reason: "cross-site" };
  }

  if (input.origin) {
    let expected: string;
    try {
      expected = new URL(input.url).origin;
    } catch {
      return { ok: false, reason: "foreign-origin" };
    }
    if (input.origin !== expected) {
      return { ok: false, reason: "foreign-origin" };
    }
  }

  /**
   * Content type is checked last and applies even when the browser sent no
   * origin signals at all, because it is what stops a plain HTML form — the
   * one CSRF vector that needs no JavaScript on the attacker's page.
   */
  const type = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return { ok: false, reason: "bad-content-type" };
  }

  if (!input.origin && !input.secFetchSite) {
    // A non-browser client: no cookies, so no ambient authority to abuse.
    return { ok: true, reason: "no-browser-signals" };
  }
  return { ok: true, reason: "same-origin" };
}

/** True when this path must be protected. Mutations all live under `/api`. */
export function isProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * Edge guard. Returns a rejection Response, or `null` to continue.
 *
 * Applied centrally in the worker rather than per route, so a new endpoint
 * cannot forget to opt in.
 */
export function rejectCrossSite(request: Request): Response | null {
  const url = new URL(request.url);
  if (!isProtectedPath(url.pathname)) return null;

  const decision = checkSameOrigin({
    method: request.method,
    url: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    contentType: request.headers.get("content-type"),
  });

  if (decision.ok) return null;

  const message =
    decision.reason === "bad-content-type"
      ? "Requests that change data must be sent as application/json."
      : "This request was blocked because it did not originate from this site.";

  return new Response(JSON.stringify({ message, code: decision.reason }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // No `Access-Control-Allow-Origin`: there is no cross-origin consumer of
      // this API, and advertising one would undo the check above.
      Vary: "Origin",
    },
  });
}
