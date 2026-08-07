import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

const clientRoot = resolve("dist/client");
const manifest = JSON.parse(
  readFileSync(resolve(clientRoot, ".vite/manifest.json"), "utf8"),
);

const entries = {
  experience: "app/components/CarePointExperience.tsx",
  careLens: "app/components/TreatmentUniverse.tsx",
  canvas: "app/components/TreatmentCanvas.tsx",
};

for (const [label, key] of Object.entries(entries)) {
  if (!manifest[key]) throw new Error(`Performance budget cannot find ${label} manifest entry: ${key}`);
}

const failures = [];
const rows = [];

function fileMetrics(relativePath) {
  const source = readFileSync(resolve(clientRoot, relativePath));
  return { raw: source.byteLength, gzip: gzipSync(source).byteLength };
}

function budget(label, relativePath, limits) {
  const metrics = fileMetrics(relativePath);
  rows.push({
    label,
    file: relativePath,
    ...metrics,
    rawLimit: limits.raw,
    gzipLimit: limits.gzip,
  });
  for (const format of ["raw", "gzip"]) {
    const limit = limits[format];
    if (limit && metrics[format] > limit) {
      failures.push(`${label} ${format} is ${metrics[format]} bytes; budget is ${limit}.`);
    }
  }
}

function collectStaticGraph(startKey, seen = new Set()) {
  if (seen.has(startKey)) return seen;
  const entry = manifest[startKey];
  if (!entry) throw new Error(`Static import ${startKey} is missing from the client manifest.`);
  seen.add(startKey);
  for (const imported of entry.imports ?? []) collectStaticGraph(imported, seen);
  return seen;
}

function assertDynamic(parentKey, childKey) {
  if (!(manifest[parentKey].dynamicImports ?? []).includes(childKey)) {
    failures.push(`${childKey} must stay dynamically imported by ${parentKey}.`);
  }
  if ((manifest[parentKey].imports ?? []).includes(childKey)) {
    failures.push(`${childKey} leaked into the static imports of ${parentKey}.`);
  }
}

assertDynamic(entries.experience, entries.careLens);
assertDynamic(entries.careLens, entries.canvas);

budget("Patient experience", manifest[entries.experience].file, {
  raw: 250 * 1024,
  gzip: 85 * 1024,
});
budget("CareLens interface", manifest[entries.careLens].file, {
  raw: 50 * 1024,
  gzip: 18 * 1024,
});
budget("Deferred 3D engine", manifest[entries.canvas].file, {
  raw: 920 * 1024,
  gzip: 260 * 1024,
});

const css = readdirSync(resolve(clientRoot, "assets"))
  .filter((file) => file.endsWith(".css"))
  .map((file) => `assets/${file}`);
/**
 * Per-file: no single stylesheet may dominate a first paint.
 *
 * 26KB gzip, raised from 22KB on 2026-08-07 with its reasoning on the record:
 * the shared sheet gained a three-layer design-token foundation, a per-section
 * scroll-motion system and the treatment-page reveal roles — deliberate,
 * reviewed additions, not drift. The same change EXTRACTED CareLens (~1,500
 * lines) into its own lazy chunk and deleted 37 dead rule-sets, taking the
 * sheet from 29.3KB (where it had sat, red, since the dental redesign landed)
 * to 24.8KB. The old number predates the token system; this one holds it to
 * roughly a kilobyte of headroom.
 */
for (const file of css) budget("Stylesheet", file, { raw: 125 * 1024, gzip: 26 * 1024 });

/**
 * Total: the loophole the per-file check leaves open.
 *
 * Splitting a stylesheet in two makes both files smaller while the visitor
 * downloads exactly as much — a per-file gate alone would print "passed" for
 * that. The total is what a visitor can actually be asked to pay across every
 * chunk, lazy ones included.
 */
const cssTotal = css.reduce(
  (total, file) => {
    const metrics = fileMetrics(file);
    return { raw: total.raw + metrics.raw, gzip: total.gzip + metrics.gzip };
  },
  { raw: 0, gzip: 0 },
);
rows.push({
  label: "All stylesheets combined",
  file: `${css.length} files`,
  ...cssTotal,
  rawLimit: 260 * 1024,
  gzipLimit: 52 * 1024,
});
if (cssTotal.raw > 260 * 1024) {
  failures.push(`Total CSS raw is ${cssTotal.raw} bytes; budget is ${260 * 1024}.`);
}
if (cssTotal.gzip > 52 * 1024) {
  failures.push(`Total CSS gzip is ${cssTotal.gzip} bytes; budget is ${52 * 1024}.`);
}

budget("Hero portrait", "doctor-hero.webp", { raw: 100 * 1024, gzip: 100 * 1024 });
budget("Social image", "og.jpg", { raw: 100 * 1024, gzip: 100 * 1024 });

const initialFiles = [...collectStaticGraph(entries.experience)]
  .map((key) => manifest[key].file)
  .filter(Boolean)
  .filter((file, index, files) => files.indexOf(file) === index);
const initial = initialFiles.reduce(
  (total, file) => {
    const metrics = fileMetrics(file);
    return { raw: total.raw + metrics.raw, gzip: total.gzip + metrics.gzip };
  },
  { raw: 0, gzip: 0 },
);
rows.push({
  label: "Initial patient JS graph",
  file: `${initialFiles.length} static chunks`,
  ...initial,
  raw: initial.raw,
  gzip: initial.gzip,
  rawLimit: 600 * 1024,
  gzipLimit: 190 * 1024,
});
if (initial.raw > 600 * 1024) failures.push(`Initial patient JS is ${initial.raw} bytes; budget is ${600 * 1024}.`);
if (initial.gzip > 190 * 1024) failures.push(`Initial patient JS gzip is ${initial.gzip} bytes; budget is ${190 * 1024}.`);

const format = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
console.table(
  rows.map((row) => ({
    asset: row.label,
    file: row.file,
    raw: format(row.raw),
    gzip: format(row.gzip),
  })),
);

if (failures.length > 0) {
  throw new Error(`Performance budget failed:\n- ${failures.join("\n- ")}`);
}

console.log("Performance budget passed. CareLens and its 3D engine remain behind two dynamic boundaries.");
