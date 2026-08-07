import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Replaces colour literals with the token that already holds that exact value.
 *
 * Deterministic on purpose. Hand-editing ~600 colour occurrences across 10,000
 * lines of CSS is how a wrong hex slips in somewhere nobody looks, and the
 * whole point of this refactor is that it changes nothing.
 *
 * The token file is the only source of the mapping: a literal is replaced if
 * and only if app/tokens.css already names that value. That gives the
 * tokenisation boundary for free — values that earned a name get one, and a
 * one-off gradient stop on a decorative orb stays a literal instead of
 * becoming a token nobody will ever reuse.
 *
 * NEVER snaps a near value to a token. #eeece7 and #f2eee6 are 1.9 ΔE apart
 * and both keep their own token, because merging them is a design decision
 * with a visual consequence, not a refactor.
 *
 *   node scripts/apply-design-tokens.mjs --dry     report only
 *   node scripts/apply-design-tokens.mjs           write
 */

const DRY = process.argv.includes("--dry");

const DASHBOARD_FILES = [
  "app/(site)/command-center/command-center.css",
  "app/(site)/command-center/security.css",
  "app/(site)/command-center/pilot-control.css",
  "app/(site)/command-center/clinic-hours.css",
];
const TARGETS = ["app/globals.css", ...DASHBOARD_FILES];

/**
 * Colour tokens only. Spacing, type and radius substitution is a separate
 * pass: a bare `12px` is ambiguous (padding? font-size? border?) and needs
 * property context, which colour does not.
 *
 * `scope` matters. Tokens declared in command-center.css exist only in the
 * dashboard chunk — substituting one into globals.css would emit a var() that
 * resolves to nothing on the patient site, which fails silently and removes
 * the colour rather than changing it.
 */
const TOKEN_SOURCES = [
  {
    file: "app/tokens.css",
    scope: "all",
    tokens: [
      "ivory", "ivory-dim", "paper", "paper-dim", "sand-100", "sand-150",
      "sand-200", "white",
      "charcoal", "black-880", "black-900", "black-950", "ink", "black-800",
      "muted", "warm-grey-500", "warm-grey-300", "warm-grey-300-alt",
      "warm-grey-400", "warm-grey-450", "warm-grey-600", "warm-grey-700",
      "burgundy", "burgundy-dark", "burgundy-300", "burgundy-400",
      "burgundy-500", "burgundy-600", "burgundy-700",
      "rose", "rose-300", "champagne", "champagne-400", "crimson-500",
      "sage", "green-600", "amber-600",
      "line", "line-dim", "line-soft",
      "notice-bg", "notice-border", "notice-fg",
    ],
  },
  {
    file: "app/(site)/command-center/command-center.css",
    scope: "dashboard",
    tokens: [
      "status-confirmed-bg", "status-completed-bg", "status-completed-fg",
      "status-missed-bg", "status-missed-fg", "status-stop-bg",
      "feedback-warning-bg", "feedback-warning-fg", "feedback-caution-fg",
      "feedback-success-fg", "feedback-danger-border",
    ],
  },
];

/** Aliases that hold the same value as a canonical token. Substituting to the
 *  alias would be correct but noisy — prefer the name the codebase already
 *  uses everywhere. */
const PREFER = new Map([
  ["burgundy-500", "burgundy"],
  ["burgundy-700", "burgundy-dark"],
]);

const normaliseHex = (hex) => {
  const body = hex.slice(1).toLowerCase();
  // Expand shorthand, but keep 8-digit (alpha) distinct from 6-digit.
  if (body.length === 3) return "#" + body.split("").map((c) => c + c).join("");
  if (body.length === 4) return "#" + body.split("").map((c) => c + c).join("");
  return "#" + body;
};
const normaliseFunc = (value) => value.replace(/\s+/g, "").toLowerCase().replace(/(\D)0\./g, "$1.");
const normalise = (value) =>
  value.startsWith("#") ? normaliseHex(value) : normaliseFunc(value);

// ---------------------------------------------------------------- build map
/** value -> { token, scope } */
const valueToToken = new Map();
for (const source of TOKEN_SOURCES) {
  const text = readFileSync(resolve(source.file), "utf8");
  for (const name of source.tokens) {
    const match = text.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m"));
    if (!match) {
      console.error(`Token --${name} is not defined in ${source.file}. Aborting.`);
      process.exit(2);
    }
    const raw = match[1].trim();
    if (raw.startsWith("var(")) continue; // an alias pointing at another token
    const key = normalise(raw);
    const preferred = PREFER.get(name) ?? name;
    // First writer wins, and PREFER decides ties, so #7b263c maps to
    // --burgundy rather than --burgundy-500.
    if (!valueToToken.has(key) || preferred !== name) {
      valueToToken.set(key, { token: preferred, scope: source.scope });
    }
  }
}

// --------------------------------------------------------------- substitute
/** Spans that must never be touched: comments, url()/data-URIs (a hex inside
 *  an inline SVG is markup, not a CSS colour), and custom-property
 *  DEFINITIONS (a token must keep its literal or the system is circular). */
function protectedSpans(source) {
  const spans = [];
  const push = (re) => {
    for (const m of source.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  };
  push(/\/\*[\s\S]*?\*\//g);
  push(/url\((?:[^()]|\([^()]*\))*\)/gi);
  // `--token: <literal>;` — the definition side only.
  push(/--[a-z0-9-]+\s*:\s*[^;{}]*;/gi);
  return spans;
}

const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)/g;

let grandTotal = 0;
const report = [];

for (const file of TARGETS) {
  const path = resolve(file);
  const source = readFileSync(path, "utf8");
  const skip = protectedSpans(source);
  const inSkip = (index) => skip.some(([a, b]) => index >= a && index < b);
  const isDashboard = DASHBOARD_FILES.includes(file);

  const counts = new Map();
  let replaced = 0;
  let outOfScope = 0;

  const output = source.replace(LITERAL, (literal, index) => {
    if (inSkip(index)) return literal;
    const entry = valueToToken.get(normalise(literal));
    if (!entry) return literal;
    // A dashboard-scoped token does not exist on the patient site; emitting it
    // there would resolve to nothing and silently drop the colour.
    if (entry.scope === "dashboard" && !isDashboard) {
      outOfScope += 1;
      return literal;
    }
    counts.set(entry.token, (counts.get(entry.token) ?? 0) + 1);
    replaced += 1;
    return `var(--${entry.token})`;
  });

  grandTotal += replaced;
  report.push({ file, replaced, counts, outOfScope });
  if (!DRY && replaced > 0) writeFileSync(path, output);
}

// ------------------------------------------------------------------- output
console.log(`\n${DRY ? "DRY RUN — nothing written" : "Applied"}\n`);
for (const entry of report) {
  console.log(`${entry.file}  —  ${entry.replaced} replaced`);
  const top = [...entry.counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [token, count] of top) {
    console.log(`     ${String(count).padStart(4)}  --${token}`);
  }
  if (top.length === 0) console.log("      (no literal matched a named token)");
  if (entry.outOfScope > 0) {
    console.log(`     ${String(entry.outOfScope).padStart(4)}  left literal — matched a dashboard-only token, out of scope here`);
  }
  console.log("");
}
console.log(`Total: ${grandTotal} literal(s) replaced by an exactly-equal token.`);
console.log(
  DRY
    ? "\nRun without --dry to write, then prove it:  npm run tokens:after && npm run tokens:diff"
    : "\nNow prove it changed nothing:  npm run tokens:after && npm run tokens:diff",
);
