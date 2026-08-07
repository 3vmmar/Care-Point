import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Computed-style snapshot harness for the design-token refactor.
 *
 * Stage 0 replaces hundreds of CSS literals with `var()` references and claims
 * the rendered result is unchanged. That claim is not provable by the existing
 * suite: across twelve spec files there is exactly one computed-style assertion
 * (`touch-action` on the CareLens canvas), so a refactor that repointed every
 * token at the wrong value would pass everything and ship.
 *
 * This captures what the browser actually resolved — after the cascade, after
 * `var()` substitution, after media queries — for every classed element on the
 * surfaces the tokens touch. Run it once on the untouched tree, once after, and
 * diff. A token pointed at the wrong value shows up as a changed pixel value
 * rather than as a silent pass.
 *
 *   SNAPSHOT_LABEL=baseline npm run tokens:capture
 *   …make the change…
 *   SNAPSHOT_LABEL=after    npm run tokens:capture
 *   npm run tokens:diff
 *
 * Deliberately NOT a pixel screenshot: font rasterisation differs per machine,
 * so pixel diffs produce failures that are about this laptop rather than about
 * the change. Computed styles are environment-independent.
 */

/** Only properties a token can move. Layout geometry is captured to catch a
 *  spacing scale that silently rounds, not to police the layout itself. */
const PROPERTIES = [
  "color",
  "background-color",
  "background-image",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-width",
  "border-bottom-width",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "box-shadow",
  "outline-color",
  "outline-width",
  "outline-offset",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-decoration-color",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-bottom",
  "row-gap",
  "column-gap",
  "opacity",
  "fill",
  "stroke",
  "backdrop-filter",
  "transition-duration",
  "transition-timing-function",
  "transition-property",
] as const;

/** The surfaces the token system reaches. `/login` is included deliberately:
 *  it is a patient-site route that imports a dashboard stylesheet, which is
 *  exactly the kind of cross-surface coupling a rescope can break silently. */
const ROUTES = [
  { path: "/", name: "home-en" },
  { path: "/ar", name: "home-ar" },
  { path: "/treatments/rhinoplasty", name: "treatment-en" },
  { path: "/ar/treatments/rhinoplasty", name: "treatment-ar" },
  { path: "/login", name: "login" },
  { path: "/command-center", name: "command-center" },
];

/** The user's own window is 1920x748 — short and wide, and the viewport where a
 *  previous pass shipped a clipped dock nobody had looked at. */
const VIEWPORTS = [
  { width: 1920, height: 748, name: "desktop-short" },
  { width: 1024, height: 768, name: "tablet" },
  { width: 390, height: 844, name: "mobile" },
];

const MAX_ELEMENTS = 900;

type Snapshot = Record<string, Record<string, string>>;

const label = process.env.SNAPSHOT_LABEL ?? "baseline";
const outDir = resolve("test-results/tokens");

test.describe.configure({ mode: "serial" });

test("capture computed styles across surfaces and viewports", async ({ page }) => {
  test.setTimeout(600_000);

  const snapshot: Record<string, Snapshot> = {};
  const skipped: string[] = [];

  // Set once, before the first navigation. Applying it after load would let the
  // entrance choreography run first and leave GSAP's matchMedia on the wrong
  // branch, so the capture would measure a frame of a transition rather than
  // the resting design.
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of ROUTES) {
      const key = `${viewport.name}::${route.name}`;
      try {
        const response = await page.goto(route.path, {
          waitUntil: "networkidle",
          timeout: 45_000,
        });
        if (!response || response.status() >= 400) {
          skipped.push(`${key} (HTTP ${response?.status() ?? "no response"})`);
          continue;
        }
      } catch (error) {
        skipped.push(`${key} (${(error as Error).message.split("\n")[0]})`);
        continue;
      }

      // Let fonts settle. A capture taken mid-swap records the fallback stack
      // and would diff against itself on the next run.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);

      // Clinic OS renders status pills only when the appointment table has
      // rows. The local database has none, so a capture — and the axe scan in
      // CI, for the same reason — measures a dashboard with no pills in it.
      // That blind spot is how 62 contrast violations shipped under a green
      // 84/84. Injecting one of every variant makes the design-system surface
      // observable regardless of what is in D1.
      if (route.name === "command-center") {
        await page.evaluate(() => {
          const host = document.createElement("div");
          host.className = "token-proof-sheet";
          host.setAttribute("data-token-fixture", "");
          for (const variant of [
            "confirmed", "checked", "completed", "missed", "cancelled",
          ]) {
            const pill = document.createElement("span");
            pill.className = `status-pill status-pill--${variant}`;
            pill.textContent = variant;
            host.appendChild(pill);
          }
          const mount = document.querySelector(".command-main") ?? document.body;
          mount.appendChild(host);
        });
        await page.waitForTimeout(120);

        // The focus ring is the one token you cannot read from a resting page:
        // :focus-visible only matches after real keyboard interaction, so
        // element.focus() does not reproduce it. Tab until focus lands in the
        // dark sidebar and record the ring a keyboard user actually gets.
        // axe has no rule for SC 1.4.11, so nothing else in this repo checks it.
        const rings: Record<string, Record<string, string>> = {};
        for (let step = 0; step < 18; step += 1) {
          await page.keyboard.press("Tab");
          const ring = await page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            if (!active || !active.closest(".command-sidebar")) return null;
            if (!active.matches(":focus-visible")) return null;
            const styles = window.getComputedStyle(active);
            let backdrop = "";
            for (let node: HTMLElement | null = active; node; node = node.parentElement) {
              const background = window.getComputedStyle(node).backgroundColor;
              if (background && background !== "rgba(0, 0, 0, 0)") {
                backdrop = background;
                break;
              }
            }
            return {
              tag: active.tagName.toLowerCase(),
              classes: (active.className || "").toString().slice(0, 60),
              "outline-color": styles.outlineColor,
              "outline-width": styles.outlineWidth,
              "outline-offset": styles.outlineOffset,
              "resolved-backdrop": backdrop,
            };
          });
          if (ring) rings[`sidebar-focus-${step}|${ring.classes}`] = ring;
          if (Object.keys(rings).length >= 4) break;
        }
        if (Object.keys(rings).length > 0) {
          snapshot[`${viewport.name}::focus-rings`] = rings;
        }
      }

      snapshot[key] = await page.evaluate(
        ({ properties, cap }) => {
          /** A stable identity for an element that survives between runs: its
           *  structural path, not its text, since text carries live data. */
          const pathOf = (element: Element): string => {
            const parts: string[] = [];
            let node: Element | null = element;
            while (node && node !== document.documentElement) {
              const parent: Element | null = node.parentElement;
              if (!parent) break;
              const index = Array.prototype.indexOf.call(parent.children, node);
              parts.unshift(`${node.tagName.toLowerCase()}:${index}`);
              node = parent;
            }
            return parts.join(">");
          };

          const result: Record<string, Record<string, string>> = {};
          const elements = Array.from(document.querySelectorAll<HTMLElement>("*"))
            .filter((element) => {
              const tag = element.tagName.toLowerCase();
              if (tag === "script" || tag === "style" || tag === "meta" || tag === "link") {
                return false;
              }
              // Classed elements are the ones a stylesheet actually targets.
              return typeof element.className === "string"
                ? element.className.trim().length > 0
                : true;
            })
            .slice(0, cap);

          for (const element of elements) {
            const styles = window.getComputedStyle(element);
            const record: Record<string, string> = {};
            for (const property of properties) {
              record[property] = styles.getPropertyValue(property).trim();
            }
            const classes =
              typeof element.className === "string" ? element.className.trim() : "";
            result[`${pathOf(element)}|${classes.slice(0, 90)}`] = record;
          }
          return result;
        },
        { properties: PROPERTIES as unknown as string[], cap: MAX_ELEMENTS },
      );
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, `${label}.json`),
    JSON.stringify({ label, capturedRoutes: Object.keys(snapshot), skipped, snapshot }, null, 0),
  );

  const captured = Object.keys(snapshot).length;
  const elements = Object.values(snapshot).reduce(
    (total, page) => total + Object.keys(page).length,
    0,
  );
  console.log(
    `\n[${label}] captured ${elements} elements across ${captured} route/viewport pairs.`,
  );
  if (skipped.length > 0) console.log(`[${label}] skipped: ${skipped.join(", ")}`);

  // A capture that silently collected nothing would make the diff trivially
  // green, which is the exact false pass this harness exists to prevent.
  expect(captured, "no route/viewport pair captured").toBeGreaterThan(0);
  expect(elements, "captured no elements").toBeGreaterThan(500);
});
