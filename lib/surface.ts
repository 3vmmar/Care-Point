/**
 * Deployment boundary between the public patient experience and Clinic OS.
 *
 * Both Workers may be built from the same reviewed source and bind the same D1
 * database, but their request surfaces are deliberately disjoint. The public
 * Worker never serves staff pages or staff APIs; the clinic Worker never serves
 * booking or marketing pages.
 */

export type AppSurface = "combined" | "patient" | "clinic";

export type SurfaceConfig = {
  surface?: string | null;
  publicSiteUrl?: string | null;
  clinicDashboardUrl?: string | null;
};

export function appSurface(value: string | null | undefined): AppSurface {
  // Missing or misspelled production configuration must never expose Clinic OS
  // on the public origin. Local Vite explicitly sets `combined`.
  return value === "combined" || value === "clinic" ? value : "patient";
}

function isAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vinext/") ||
    pathname.startsWith("/assets/") ||
    /\.(?:avif|css|gif|ico|jpe?g|js|json|png|svg|webp|woff2?)$/i.test(pathname)
  );
}

function isAuthPath(pathname: string): boolean {
  return [
    "/signin-with-chatgpt",
    "/signout-with-chatgpt",
    "/callback",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Requests containing patient data or staff mutations. */
export function isStaffRequest(method: string, pathname: string): boolean {
  if (pathname === "/command-center" || pathname.startsWith("/command-center/")) {
    return true;
  }
  if (pathname === "/api/clinic" || pathname.startsWith("/api/clinic/")) return true;
  if (pathname.startsWith("/api/bookings/")) return true;
  return pathname === "/api/bookings" && method.toUpperCase() === "GET";
}

/** Routes the private dashboard needs in order to operate. */
export function isClinicRequest(method: string, pathname: string): boolean {
  if (isAsset(pathname) || isAuthPath(pathname)) return true;
  if (pathname === "/api/health" || pathname === "/robots.txt") return true;
  if (pathname === "/api/availability") return method.toUpperCase() === "GET";
  return isStaffRequest(method, pathname);
}

function absoluteUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function redirect(destination: URL | string, status = 307): Response {
  return new Response(null, {
    status,
    headers: {
      Location: destination.toString(),
      "Cache-Control": "no-store, private",
    },
  });
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/**
 * Returns a response when the deployment must stop the request at the edge.
 * `null` means the request belongs to this surface and may reach the app router.
 */
export function enforceSurfaceBoundary(
  request: Request,
  config: SurfaceConfig,
): Response | null {
  const surface = appSurface(config.surface);
  if (surface === "combined") return null;

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (surface === "patient") {
    if (!isStaffRequest(method, url.pathname)) return null;

    // Never reveal whether a private API exists on the public origin.
    if (url.pathname.startsWith("/api/")) return notFound();

    const clinic = absoluteUrl(config.clinicDashboardUrl);
    return clinic ? redirect(clinic) : notFound();
  }

  // Clinic OS lives at the root of its own hostname.
  if (url.pathname === "/") {
    return redirect(new URL("/command-center", url));
  }
  if (isClinicRequest(method, url.pathname)) return null;

  const publicSite = absoluteUrl(config.publicSiteUrl);
  if (method === "GET" && publicSite) {
    const destination = new URL(url.pathname + url.search, publicSite);
    return redirect(destination);
  }
  return notFound();
}
