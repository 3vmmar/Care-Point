import { SITE_URL } from "@/lib/site";

/**
 * Written as a route handler rather than Next's `robots.ts` convention, for the
 * same reason as the sitemap: vinext does not emit metadata files.
 */
export function GET() {
  const body = `User-agent: *
Allow: /

# Staff and patient-specific surfaces. Both also send noindex headers, but a
# crawler should not be following the links in the first place.
Disallow: /command-center
Disallow: /appointment/
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
