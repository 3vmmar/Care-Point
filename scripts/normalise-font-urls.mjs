/**
 * Rewrites absolute filesystem font URLs left behind by the build.
 *
 * `next/font/google` downloads the typefaces at build time into `.vinext/fonts`
 * and emits `@font-face` rules pointing at them. On Windows the plugin fails to
 * map that cache path onto the public asset path, so the shipped CSS contains:
 *
 *     src: url(C:/Care Point/.vinext/fonts/manrope-.../manrope-....woff2)
 *
 * The font files themselves are copied correctly into
 * `dist/client/assets/_vinext_fonts/`, so nothing is missing — every URL is
 * simply unreachable. The result is 37 dead requests and a site rendered
 * entirely in fallback system fonts.
 *
 * That failure is invisible on the machine that produced the build, because the
 * absolute path resolves there. For a practice whose identity is largely
 * typographic — Cormorant Garamond over Manrope, with IBM Plex Sans Arabic
 * carrying half the audience — shipping it would quietly discard the design.
 *
 * This runs after every build and is idempotent. It exits non-zero if it finds
 * an absolute path it cannot map, so a new variant of the bug fails the build
 * rather than shipping.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DIST = "dist";
const CLIENT_ROOT = join(DIST, "client");
/** Where the build actually puts the downloaded typefaces. */
const FONT_DIR = join(CLIENT_ROOT, "assets", "_vinext_fonts");

/** Any `url(<drive-letter>:/... )` or `url(/abs/unix/path...)` inside a bundle. */
const ABSOLUTE_URL = /url\(\s*(['"]?)((?:[A-Za-z]:[\\/]|\/)[^)'"]*?\.(?:woff2?|ttf|otf|eot))\1\s*\)/g;

function walk(directory) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

/** Every shipped font file, indexed by basename, so a URL can be re-pointed. */
function shippedFonts() {
  const index = new Map();
  for (const path of walk(FONT_DIR)) {
    if (!/\.(woff2?|ttf|otf|eot)$/i.test(path)) continue;
    const served = `/${relative(CLIENT_ROOT, path).split(sep).join("/")}`;
    index.set(path.split(sep).pop(), served);
  }
  return index;
}

const fonts = shippedFonts();
if (fonts.size === 0) {
  // No self-hosted fonts in this build. Nothing to normalise, and nothing wrong.
  console.log("[fonts] no bundled font files found; nothing to normalise.");
  process.exit(0);
}

const targets = walk(DIST).filter((path) => /\.(css|js|mjs)$/i.test(path));
let rewritten = 0;
let touched = 0;
const unmapped = [];

for (const path of targets) {
  const before = readFileSync(path, "utf8");
  if (!ABSOLUTE_URL.test(before)) continue;
  ABSOLUTE_URL.lastIndex = 0;

  const after = before.replace(ABSOLUTE_URL, (match, _quote, url) => {
    const name = url.split(/[\\/]/).pop();
    const served = fonts.get(name);
    if (!served) {
      unmapped.push({ path, url });
      return match;
    }
    rewritten += 1;
    return `url(${served})`;
  });

  if (after !== before) {
    writeFileSync(path, after);
    touched += 1;
  }
}

if (unmapped.length > 0) {
  console.error(
    `[fonts] ${unmapped.length} absolute font URL(s) could not be mapped to a shipped file:`,
  );
  for (const entry of unmapped.slice(0, 10)) {
    console.error(`  ${entry.path}\n    ${entry.url}`);
  }
  console.error("[fonts] Refusing to ship a build whose fonts will 404.");
  process.exit(1);
}

console.log(
  rewritten > 0
    ? `[fonts] rewrote ${rewritten} absolute font URL(s) across ${touched} file(s) to /assets/_vinext_fonts/…`
    : "[fonts] all font URLs already relative.",
);
