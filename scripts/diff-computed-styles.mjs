import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Diffs two computed-style snapshots taken by tests/tokens/computed-styles.spec.ts.
 *
 * The design-token refactor claims to be visually neutral. This is what turns
 * that from an assertion into a measurement: every property the browser
 * resolved, before and after, compared value by value.
 *
 * Exits non-zero on any unexplained difference, so it can gate a commit.
 * Differences that ARE intended (the enumerated WCAG fixes) are declared in
 * ALLOWED below, with the reason — anything not declared is a regression.
 *
 *   node scripts/diff-computed-styles.mjs [baselineLabel] [afterLabel]
 */

const [, , baselineLabel = "baseline", afterLabel = "after"] = process.argv;
const dir = resolve("test-results/tokens");

/**
 * Intended changes. Each entry needs a property, the exact before and after
 * values, and why — so an intentional accessibility fix is distinguishable
 * from an accidental repoint. Empty until the WCAG pass lands in its own
 * commit, which keeps the neutrality diff of the retokenisation exactly empty
 * rather than "empty except for the parts we expected".
 */
/**
 * `color` is inherited by border-color, outline-color and
 * text-decoration-color wherever they are not set explicitly — they compute to
 * currentColor. So changing one `color` legitimately moves several properties
 * on the same element. They are listed rather than globbed, so a border that
 * changed for some OTHER reason still fails the diff.
 */
const CURRENT_COLOR_DERIVED = [
  "color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
];

const ALLOWED = [
  {
    properties: CURRENT_COLOR_DERIVED,
    from: "rgb(79, 128, 95)",
    to: "rgb(71, 115, 86)",
    reason:
      "status-pill--confirmed #4f805f -> #477356 on #e2ede5. 3.81:1 -> 4.53:1. " +
      "11px/600 is not large text, so SC 1.4.3 requires 4.5:1. Minimum " +
      "darkening along the existing hue.",
  },
  {
    properties: CURRENT_COLOR_DERIVED,
    from: "rgb(119, 114, 108)",
    to: "rgb(107, 103, 97)",
    reason:
      "status-pill--cancelled #77726c -> #6b6761 on #e8e6e2. 3.82:1 -> 4.51:1. " +
      "Same threshold and the same minimum-darkening rule.",
  },
  {
    properties: ["outline-color"],
    from: "rgb(123, 38, 60)",
    to: "rgb(180, 105, 120)",
    reason:
      "Clinic OS sidebar focus ring --burgundy -> --rose. Measured 1.53-1.79:1 " +
      "across the four near-black sidebar surfaces against the 3:1 SC 1.4.11 " +
      "requires of a focus indicator; --rose clears all four (worst 3.67:1 on " +
      "the nav hover state). Scoped to focusable elements, not the container.",
  },
];

const load = (label) => {
  const path = resolve(dir, `${label}.json`);
  if (!existsSync(path)) {
    console.error(`Snapshot "${label}" not found at ${path}.`);
    console.error(`Capture it with:  SNAPSHOT_LABEL=${label} npm run tokens:capture`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, "utf8"));
};

const before = load(baselineLabel);
const after = load(afterLabel);

const isAllowed = (property, from, to) =>
  ALLOWED.some(
    (rule) => rule.properties.includes(property) && rule.from === from && rule.to === to,
  );

const differences = [];
const structural = [];
let compared = 0;

const pages = new Set([
  ...Object.keys(before.snapshot ?? {}),
  ...Object.keys(after.snapshot ?? {}),
]);

for (const page of [...pages].sort()) {
  const a = before.snapshot?.[page];
  const b = after.snapshot?.[page];

  if (!a || !b) {
    structural.push(`${page}: captured only in ${a ? baselineLabel : afterLabel}`);
    continue;
  }

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const beforeRecord = a[key];
    const afterRecord = b[key];
    if (!beforeRecord || !afterRecord) {
      // A missing element is a DOM difference, not a style difference. Reported
      // separately because live data (today's appointments) legitimately moves
      // between captures and would otherwise drown the real signal.
      structural.push(`${page} :: ${key.split("|")[1] || key} — present only in ${beforeRecord ? baselineLabel : afterLabel}`);
      continue;
    }
    for (const property of Object.keys(beforeRecord)) {
      compared += 1;
      const from = beforeRecord[property];
      const to = afterRecord[property];
      if (from === to) continue;
      if (isAllowed(property, from, to)) continue;
      differences.push({ page, element: key, property, from, to });
    }
  }
}

const format = (n) => n.toLocaleString("en-GB");

console.log(`\nComputed-style diff: ${baselineLabel} -> ${afterLabel}`);
console.log(`  route/viewport pairs : ${pages.size}`);
console.log(`  properties compared  : ${format(compared)}`);
console.log(`  structural (DOM)     : ${structural.length}`);
console.log(`  style differences    : ${differences.length}`);

if (structural.length > 0) {
  console.log(`\nDOM differences (not style regressions — inspect if unexpected):`);
  for (const entry of structural.slice(0, 15)) console.log(`  - ${entry}`);
  if (structural.length > 15) console.log(`  …and ${structural.length - 15} more`);
}

if (differences.length === 0) {
  if (compared === 0) {
    console.error(
      `\nFAIL: compared zero properties. Both snapshots are empty, so this is a false pass.`,
    );
    process.exit(2);
  }
  console.log(`\nPASS: ${format(compared)} resolved properties identical. The refactor is visually neutral.`);
  process.exit(0);
}

// Group by property then by the value transition, because a token repointed
// wrongly shows up as one transition repeated across hundreds of elements —
// far more diagnostic than a flat list.
const grouped = new Map();
for (const d of differences) {
  const bucket = `${d.property}: ${d.from}  ->  ${d.to}`;
  if (!grouped.has(bucket)) grouped.set(bucket, []);
  grouped.get(bucket).push(d);
}

console.log(`\nUNDECLARED DIFFERENCES — ${grouped.size} distinct transitions:\n`);
for (const [bucket, entries] of [...grouped.entries()].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`  ${bucket}`);
  console.log(`     ${entries.length} element(s), e.g. ${entries[0].page} :: ${(entries[0].element.split("|")[1] || "").slice(0, 60)}`);
}

console.log(
  `\nFAIL: ${format(differences.length)} property values changed and were not declared in ALLOWED.`,
);
console.log(
  `If a change is intended, add it to ALLOWED in this file with its reason, so the record says why.`,
);
process.exit(1);
