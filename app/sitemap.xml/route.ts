import { SITE_URL } from "@/lib/site";
import { TREATMENTS } from "@/lib/treatments";

/**
 * Written as a route handler rather than Next's `sitemap.ts` convention: the
 * vinext build does not emit metadata files, so the convention silently
 * produced no sitemap at all.
 *
 * Every entry declares the full alternate set — including itself, which is what
 * the hreflang spec requires. Without it Google reads the English and Arabic
 * versions as competing duplicates rather than one page in two languages.
 *
 * Only the public surface appears here. `/command-center` and `/appointment/*`
 * render patient data and are excluded, as they are in robots.txt.
 */

type Entry = { en: string; ar: string; priority: string };

const ENTRIES: Entry[] = [
  { en: "/", ar: "/ar", priority: "1.0" },
  ...TREATMENTS.map((treatment) => ({
    en: `/treatments/${treatment.slug}`,
    ar: `/ar/treatments/${treatment.slug}`,
    priority: "0.8",
  })),
];

function urlBlock(entry: Entry, lastModified: string) {
  const alternates = [
    `    <xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}${entry.en}" />`,
    `    <xhtml:link rel="alternate" hreflang="ar" href="${SITE_URL}${entry.ar}" />`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${entry.en}" />`,
  ].join("\n");

  return [entry.en, entry.ar]
    .map(
      (path) => `  <url>
    <loc>${SITE_URL}${path}</loc>
    <lastmod>${lastModified}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${entry.priority}</priority>
${alternates}
  </url>`,
    )
    .join("\n");
}

export function GET() {
  const lastModified = new Date().toISOString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${ENTRIES.map((entry) => urlBlock(entry, lastModified)).join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
