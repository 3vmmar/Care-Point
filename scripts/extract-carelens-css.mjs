import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Moves CareLens-only CSS out of the shared stylesheet and into a stylesheet
 * owned by the lazy-loaded chunk that renders those elements.
 *
 * WHY. `app/globals.css` ships to every visitor on first paint, and roughly a
 * third of it styles an explorer that sits behind two dynamic-import
 * boundaries and a viewport gate. That is the entire reason the shared
 * stylesheet is over its CI budget — and it is the same mistake this repo has
 * already fixed twice for Clinic OS ("import a stylesheet from the component
 * that uses it, never from the page").
 *
 * HOW IT DECIDES. Ownership, not name-matching. A rule moves only when every
 * selector in its selector list targets a class rendered by the chunk
 * (TreatmentUniverse.tsx, TreatmentCanvas.tsx, app/components/carelens/*) and
 * none rendered by the pre-chunk shell in CarePointExperience.tsx — the shell,
 * the watermark, the section heading, the loading placeholder and the footer
 * links all paint BEFORE the chunk arrives and must stay in globals.css.
 * Anything ambiguous stays put: a false keep costs bytes, a false move costs a
 * visitor an unstyled section.
 *
 * ORDER IS PRESERVED. Extracted rules keep their relative order, and the
 * extracted sheet loads after globals.css (chunk CSS always does), which only
 * matters for rules that were fighting ACROSS the boundary — the audit is the
 * grep in --verify, and the proof is the computed-style diff.
 *
 *   node scripts/extract-carelens-css.mjs --dry      classify and report only
 *   node scripts/extract-carelens-css.mjs            write both files
 *   node scripts/extract-carelens-css.mjs --verify   post-extraction audits
 */

const DRY = process.argv.includes("--dry");
const VERIFY = process.argv.includes("--verify");

const GLOBALS = resolve("app/globals.css");
const TARGET = resolve("app/components/carelens.css");

/* ----------------------------------------------------------- class ownership */

function classesIn(files) {
  const found = new Set();
  const attr = /className=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/g;
  for (const file of files) {
    const source = readFileSync(resolve(file), "utf8");
    for (const match of source.matchAll(attr)) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      for (const token of value.split(/\s+/)) {
        // Template holes contribute their static prefixes too (`a ${x}` -> a).
        const cleaned = token.replace(/\$\{[^}]*\}/g, "").trim();
        if (/^[a-z][a-z0-9-]*$/i.test(cleaned)) found.add(cleaned);
      }
    }
  }
  return found;
}

/** Every .tsx under a directory, recursively. */
function tsxUnder(dir) {
  const out = [];
  for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...tsxUnder(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const chunkFiles = [
  "app/components/TreatmentUniverse.tsx",
  "app/components/TreatmentCanvas.tsx",
  ...readdirSync(resolve("app/components/carelens")).map(
    (file) => `app/components/carelens/${file}`,
  ),
];
const chunkSet = new Set(chunkFiles.map((f) => resolve(f)));
const outsideFiles = tsxUnder("app").filter((f) => !chunkSet.has(resolve(f)));

const chunkClasses = classesIn(chunkFiles);
// "Outside" is every component that is NOT the chunk — not just the landing
// page. Treatment pages, modals, the journey designer and Clinic OS all take
// classes from globals.css too, and a shell-only definition would classify
// their rules as movable the moment a name collided.
const shellClasses = classesIn(outsideFiles);

// Rendered by both — the loading placeholder shares .treatment-universe with
// the chunk's root, and the house buttons appear everywhere. Shared stays.
const contested = [...chunkClasses].filter((name) => shellClasses.has(name));
for (const name of contested) chunkClasses.delete(name);

/**
 * Ancestor-context classes. `.site-shell[dir="rtl"] .universe-detail` is a
 * CareLens rule that happens to anchor on the page root for direction — the
 * root does not "own" it. Ignored during classification so RTL variants
 * travel with the rules they override.
 */
const CONTEXT = new Set(["site-shell"]);

/**
 * The CareLens naming family, used ONLY to recognise dead rules. Ownership is
 * decided by components; this regex just stops us deleting an unknown class
 * from some other feature that simply is not rendered in the current build.
 */
const CARELENS_FAMILY =
  /^(universe-|carelens|anatomy-|layer-dock|model-loading|treatment-universe)/;

/* -------------------------------------------------------------- css parsing */

/** Splits a stylesheet into comments, at-rules and style rules, recursively
 *  for grouping at-rules (@media, @supports). Positions preserved. */
function parseBlocks(source) {
  const blocks = [];
  let index = 0;
  const length = source.length;

  const readBalanced = (from) => {
    let depth = 0;
    for (let i = from; i < length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return length - 1;
  };

  while (index < length) {
    // Preserve whitespace runs with the following block.
    const start = index;
    while (index < length && /\s/.test(source[index])) index += 1;
    if (index >= length) break;

    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      const close = end === -1 ? length : end + 2;
      blocks.push({ kind: "comment", text: source.slice(start, close) });
      index = close;
      continue;
    }

    const braceAt = source.indexOf("{", index);
    const semiAt = source.indexOf(";", index);
    if (braceAt === -1 || (semiAt !== -1 && semiAt < braceAt)) {
      // A statement at-rule (@import, @charset) or trailing junk.
      const close = semiAt === -1 ? length : semiAt + 1;
      blocks.push({ kind: "statement", text: source.slice(start, close) });
      index = close;
      continue;
    }

    const prelude = source.slice(index, braceAt).trim();
    const close = readBalanced(braceAt);
    const body = source.slice(braceAt + 1, close);
    const text = source.slice(start, close + 1);

    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
      blocks.push({ kind: "group", prelude, children: parseBlocks(body), text });
    } else if (prelude.startsWith("@")) {
      // @keyframes, @property, @font-face — atomic.
      blocks.push({ kind: "atrule", prelude, text });
    } else {
      blocks.push({ kind: "rule", prelude, text });
    }
    index = close + 1;
  }
  return blocks;
}

/* ---------------------------------------------------------- classification */

const classRe = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;

function classify(prelude) {
  const selectors = prelude.split(",").map((s) => s.trim());
  let sawChunk = false;
  let allDead = true;
  for (const selector of selectors) {
    const classes = [...selector.matchAll(classRe)]
      .map((m) => m[1])
      .filter((name) => !CONTEXT.has(name));
    if (classes.length === 0) return "keep"; // element/attr-only: not ours to move
    if (classes.some((name) => shellClasses.has(name))) {
      return "keep"; // touches something that paints before the chunk
    }
    const anyChunk = classes.some((name) => chunkClasses.has(name));
    const everyUnrendered = classes.every(
      (name) => !chunkClasses.has(name) && !shellClasses.has(name),
    );
    if (anyChunk) {
      sawChunk = true;
      allDead = false;
    } else if (everyUnrendered && classes.every((name) => CARELENS_FAMILY.test(name))) {
      // Candidate for deletion — decided at rule level below.
    } else {
      return "keep"; // unknown non-CareLens class: not ours to judge
    }
  }
  if (sawChunk) return "move";
  return allDead ? "dead" : "keep";
}

/** Keyframe names referenced by a css text. */
const animRe = /animation(?:-name)?\s*:\s*([^;]+);/g;
function animationNames(text) {
  const names = new Set();
  for (const match of text.matchAll(animRe)) {
    for (const part of match[1].split(",")) {
      const word = part.trim().split(/\s+/).find(
        (token) =>
          /^[a-zA-Z][\w-]*$/.test(token) &&
          !/^(none|infinite|linear|ease|ease-in|ease-out|ease-in-out|both|forwards|backwards|alternate|normal|reverse|alternate-reverse|running|paused|var)$/.test(
            token,
          ) &&
          !/^[\d.]/.test(token),
      );
      if (word) names.add(word);
    }
  }
  return names;
}

/* ------------------------------------------------------------------- main */

const source = readFileSync(GLOBALS, "utf8");
const blocks = parseBlocks(source);

const kept = [];
const moved = [];
let movedRules = 0;
let keptCarelensish = [];
const deadRules = [];

function walk(list, keepOut, moveOut, mediaPrelude) {
  for (const block of list) {
    if (block.kind === "rule") {
      const verdict = classify(block.prelude);
      if (verdict === "move") {
        moveOut.push(block.text);
        movedRules += 1;
      } else if (verdict === "dead") {
        // CareLens-family selectors matching no rendered element in any
        // component — leftovers of the pre-redesign explorer. Dropped, and
        // listed so the deletion is reviewable rather than silent.
        deadRules.push((mediaPrelude ? mediaPrelude + " :: " : "") + block.prelude);
      } else {
        keepOut.push(block.text);
        if (/universe-|carelens|layer-dock|anatomy-|model-loading/.test(block.prelude)) {
          keptCarelensish.push((mediaPrelude ? mediaPrelude + " :: " : "") + block.prelude);
        }
      }
    } else if (block.kind === "group") {
      const innerKeep = [];
      const innerMove = [];
      walk(block.children, innerKeep, innerMove, block.prelude);
      const open = `${block.prelude} {`;
      if (innerKeep.some((t) => t.trim())) {
        keepOut.push(`${open}${innerKeep.join("")}\n}`);
      }
      if (innerMove.some((t) => t.trim())) {
        moveOut.push(`${open}${innerMove.join("")}\n}`);
      }
    } else {
      // Comments, statements and atomic at-rules stay with globals for now;
      // keyframes used only by moved rules are relocated in the second pass.
      keepOut.push(block.text);
    }
  }
}

walk(blocks, kept, moved, "");

// Second pass: keyframes referenced ONLY by moved rules travel with them.
const movedText = moved.join("\n");
const keptText = kept.join("");
const usedByMoved = animationNames(movedText);
const usedByKept = animationNames(keptText);
const exclusive = [...usedByMoved].filter((name) => !usedByKept.has(name));

let finalKept = keptText;
const relocatedKeyframes = [];
for (const name of exclusive) {
  const re = new RegExp(`\\n?@keyframes ${name}\\s*\\{`, "g");
  const match = re.exec(finalKept);
  if (!match) continue;
  const bodyStart = finalKept.indexOf("{", match.index);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < finalKept.length; i += 1) {
    if (finalKept[i] === "{") depth += 1;
    if (finalKept[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  relocatedKeyframes.push(finalKept.slice(match.index, end + 1));
  finalKept = finalKept.slice(0, match.index) + finalKept.slice(end + 1);
}

/* ----------------------------------------------------------------- verify */

if (VERIFY) {
  const extracted = readFileSync(TARGET, "utf8");
  const remaining = readFileSync(GLOBALS, "utf8");
  const problems = [];

  // Every keyframe the extracted sheet animates must be defined somewhere.
  for (const name of animationNames(extracted)) {
    if (!extracted.includes(`@keyframes ${name}`) && !remaining.includes(`@keyframes ${name}`)) {
      problems.push(`keyframes "${name}" is referenced by the chunk sheet but defined nowhere`);
    }
  }
  // No chunk-owned class may still have a rule in globals.css unless it also
  // appears pre-chunk (contested) — those are listed, deliberate keeps.
  const remainingBlocks = parseBlocks(remaining);
  const flagged = [];
  const sweep = (list, media) => {
    for (const b of list) {
      if (b.kind === "rule") {
        const classes = [...b.prelude.matchAll(classRe)].map((m) => m[1]);
        if (
          classes.length > 0 &&
          classes.every((c) => chunkClasses.has(c)) &&
          classes.some((c) => chunkClasses.has(c))
        ) {
          flagged.push((media ? media + " :: " : "") + b.prelude);
        }
      } else if (b.kind === "group") sweep(b.children, b.prelude);
    }
  };
  sweep(remainingBlocks, "");
  for (const f of flagged) problems.push(`still in globals.css but chunk-owned: ${f}`);

  // The chunk sheet must never declare a focus-ring COLOUR. Ring colour is
  // owned by the interaction layer in globals.css, and which sheet wins a
  // specificity tie depends on stylesheet load order — a property of the
  // bundler, not of this code, and one no reader of either file can see.
  // The E2E focus test catches this in a browser; this check catches it in
  // CI without one, and does not care what order any future bundler picks.
  const focusRules = [...extracted.matchAll(/[^{}]*:focus-visible[^{}]*\{[^}]*\}/g)];
  for (const rule of focusRules) {
    if (/outline(-color)?\s*:[^;]*(#|rgb|hsl|var\()/.test(rule[0])) {
      problems.push(
        `focus-visible rule in carelens.css declares an outline colour — ring colour belongs to globals.css:\n      ${rule[0].split("{")[0].trim()}`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(`VERIFY FAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(
    "VERIFY PASS — keyframes resolvable, no chunk-owned rules left behind, no focus colours in the chunk sheet.",
  );
  process.exit(0);
}

/* ----------------------------------------------------------------- report */

console.log(`chunk-owned classes : ${chunkClasses.size}`);
console.log(`outside classes     : ${shellClasses.size}`);
console.log(`contested (stay)    : ${contested.join(", ") || "none"}`);
console.log(`rules moved         : ${movedRules}`);
console.log(`rules DELETED as dead (${deadRules.length}):`);
for (const d of [...new Set(deadRules)]) console.log("  × " + d);
console.log(`keyframes moved     : ${exclusive.join(", ") || "none"}`);
console.log(`carelens-ish KEPT in globals (deliberate, pre-chunk):`);
for (const k of [...new Set(keptCarelensish)]) console.log("  · " + k);

if (!DRY) {
  const header = `/* ==========================================================================
   CareLens — chunk-owned styling
   --------------------------------------------------------------------------
   Imported by TreatmentUniverse.tsx, never by a page. These rules style
   elements that exist only after the CareLens chunk mounts, so shipping them
   in the shared stylesheet made every visitor pay for an explorer most never
   scroll to — and pushed the shared sheet 28% past its CI budget.

   Extracted mechanically by scripts/extract-carelens-css.mjs; ownership is
   decided by which component renders the class, not by how the class is
   named. The shell (.carelens, .carelens-word, .section-heading,
   .treatment-links, the loading placeholder) stays in globals.css because it
   paints before this chunk arrives.
   ========================================================================== */
`;
  writeFileSync(TARGET, header + moved.join("\n") + "\n" + relocatedKeyframes.join("\n") + "\n");
  writeFileSync(GLOBALS, finalKept);
  console.log(`\nwrote ${TARGET}`);
  console.log(`rewrote ${GLOBALS}`);
}
