import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the token system, and reports what is left to consolidate.
 *
 * Two jobs, because they answer two different questions:
 *
 *   FAIL  A colour literal that a token already names. There is no reason to
 *         write #7b263c when --burgundy holds it; every one of these is drift
 *         being reintroduced, and it is the mechanism by which this codebase
 *         accumulated twenty-six greys for one role.
 *
 *   REPORT  One-off literals that no token names, clustered by the role they
 *         appear to serve, with the perceptual distance to the nearest named
 *         token. This is the costed worklist for consolidation — collapsing
 *         any of them changes a rendered value, so it is a design decision
 *         with a before/after proof, not a refactor.
 *
 * ΔE is CIE76 in Lab. Under ~1.0 is invisible; under ~2.3 is at the threshold
 * where a person can tell two swatches apart side by side.
 *
 *   node scripts/check-design-tokens.mjs            fail on reintroduced drift
 *   node scripts/check-design-tokens.mjs --report   also print the worklist
 */

const REPORT = process.argv.includes("--report");

const TOKEN_SOURCES = [
  { file: "app/tokens.css", scope: "all" },
  { file: "app/(site)/command-center/command-center.css", scope: "dashboard" },
];
const DASHBOARD_FILES = [
  "app/(site)/command-center/command-center.css",
  "app/(site)/command-center/security.css",
  "app/(site)/command-center/pilot-control.css",
  "app/(site)/command-center/clinic-hours.css",
];
const TARGETS = ["app/globals.css", ...DASHBOARD_FILES];

// ------------------------------------------------------------------ colour
const parseHex = (hex) => {
  let body = hex.slice(1).toLowerCase();
  if (body.length === 3 || body.length === 4) body = body.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(body.slice(i, i + 2), 16));
};
const parseFunc = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
const toRgb = (value) => (value.startsWith("#") ? parseHex(value) : parseFunc(value));
const alphaOf = (value) => {
  if (!value.startsWith("rgba")) return value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1;
  const parts = value.match(/[\d.]+/g);
  return parts.length > 3 ? Number(parts[3]) : 1;
};

const toLab = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * 100;
  });
  const [x, y, z] = [
    (r * 0.4124 + g * 0.3576 + b * 0.1805) / 95.047,
    (r * 0.2126 + g * 0.7152 + b * 0.0722) / 100,
    (r * 0.0193 + g * 0.1192 + b * 0.9505) / 108.883,
  ].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const deltaE = (a, b) => {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
};

const normaliseHex = (hex) => {
  let body = hex.slice(1).toLowerCase();
  if (body.length === 3 || body.length === 4) body = body.split("").map((c) => c + c).join("");
  return `#${body}`;
};
const normalise = (value) =>
  value.startsWith("#")
    ? normaliseHex(value)
    : value.replace(/\s+/g, "").toLowerCase().replace(/(\D)0\./g, "$1.");

// ------------------------------------------------------------- known tokens
const known = new Map(); // normalised value -> { token, scope }
const tokenList = [];    // { token, value, rgb, alpha, scope }
for (const source of TOKEN_SOURCES) {
  const text = readFileSync(resolve(source.file), "utf8");
  for (const match of text.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gim)) {
    const [, token, raw] = match;
    const value = raw.trim();
    if (value.startsWith("var(") || !/^(#[0-9a-f]{3,8}|rgba?\()/i.test(value)) continue;
    const key = normalise(value);
    if (!known.has(key)) known.set(key, { token, scope: source.scope });
    tokenList.push({ token, value, rgb: toRgb(value), alpha: alphaOf(value), scope: source.scope });
  }
}

// ------------------------------------------------------------------- scan
function protectedSpans(source) {
  const spans = [];
  const push = (re) => {
    for (const m of source.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  };
  push(/\/\*[\s\S]*?\*\//g);
  push(/url\((?:[^()]|\([^()]*\))*\)/gi);
  push(/--[a-z0-9-]+\s*:\s*[^;{}]*;/gi);
  return spans;
}
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)/g;

const violations = [];
const oneOffs = new Map();

for (const file of TARGETS) {
  const source = readFileSync(resolve(file), "utf8");
  const skip = protectedSpans(source);
  const inSkip = (index) => skip.some(([a, b]) => index >= a && index < b);
  const isDashboard = DASHBOARD_FILES.includes(file);

  for (const match of source.matchAll(LITERAL)) {
    if (inSkip(match.index)) continue;
    const literal = match[0];
    const key = normalise(literal);
    const line = source.slice(0, match.index).split("\n").length;
    const entry = known.get(key);

    if (entry && (entry.scope === "all" || isDashboard)) {
      violations.push({ file, line, literal, token: entry.token });
      continue;
    }
    if (!oneOffs.has(key)) oneOffs.set(key, { value: literal, count: 0, sites: [] });
    const record = oneOffs.get(key);
    record.count += 1;
    if (record.sites.length < 3) record.sites.push(`${file.split("/").pop()}:${line}`);
  }
}

// ------------------------------------------------------------------ report
if (REPORT) {
  const rows = [...oneOffs.values()]
    .filter((r) => /^#|^rgb/.test(r.value))
    .map((r) => {
      const rgb = toRgb(r.value);
      const alpha = alphaOf(r.value);
      let nearest = null;
      for (const candidate of tokenList) {
        // Opacity must match almost exactly. ΔE compares hue only, so a
        // 0.028-alpha hairline would otherwise report as "ΔE 0.00" from a
        // 0.06-alpha one and read as a free collapse when it is a doubling of
        // the opacity.
        if (Math.abs(candidate.alpha - alpha) > 0.015) continue;
        const distance = deltaE(rgb, candidate.rgb);
        if (!nearest || distance < nearest.distance) nearest = { ...candidate, distance };
      }
      return { ...r, nearest };
    })
    .sort((a, b) => (a.nearest?.distance ?? 999) - (b.nearest?.distance ?? 999));

  const invisible = rows.filter((r) => r.nearest && r.nearest.distance < 1);
  const threshold = rows.filter((r) => r.nearest && r.nearest.distance >= 1 && r.nearest.distance < 2.3);

  console.log(`\nCONSOLIDATION WORKLIST — ${rows.length} unnamed colour value(s) remain\n`);
  console.log(`  ${invisible.length} are within ΔE 1.0 of a named token — collapsing them is imperceptible`);
  console.log(`  ${threshold.length} are ΔE 1.0–2.3 — at the threshold of visibility`);
  console.log(`  ${rows.length - invisible.length - threshold.length} are genuinely distinct colours\n`);

  const show = (label, list) => {
    if (list.length === 0) return;
    console.log(`${label}`);
    for (const row of list) {
      const near = row.nearest;
      console.log(
        `  ${row.value.padEnd(24)} x${String(row.count).padEnd(3)} ΔE ${near.distance.toFixed(2).padStart(5)} from --${near.token.padEnd(20)} ${row.sites[0]}`,
      );
    }
    console.log("");
  };
  show("IMPERCEPTIBLE (ΔE < 1.0) — safe to collapse, still needs a declared diff:", invisible);
  show("THRESHOLD (ΔE 1.0–2.3) — a careful eye may notice:", threshold.slice(0, 25));
  console.log(
    `Every collapse changes a rendered value. Declare each in scripts/diff-computed-styles.mjs\nALLOWED with its reason, then prove it: npm run tokens:after && npm run tokens:diff\n`,
  );
}

// ----------------------------------------------------------------- verdict
if (violations.length > 0) {
  console.error(`\nFAIL: ${violations.length} colour literal(s) written raw where a token already holds that value.\n`);
  for (const v of violations.slice(0, 30)) {
    console.error(`  ${v.file}:${v.line}  ${v.literal}  ->  var(--${v.token})`);
  }
  if (violations.length > 30) console.error(`  …and ${violations.length - 30} more`);
  console.error(`\nRun: node scripts/apply-design-tokens.mjs`);
  process.exit(1);
}

console.log(
  `\nPASS: no colour literal duplicates a named token across ${TARGETS.length} stylesheet(s).` +
    (REPORT ? "" : "  (--report for the consolidation worklist)"),
);
