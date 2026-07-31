import assert from "node:assert/strict";
import test from "node:test";
import {
  copyFor,
  dictionary,
  directionFor,
  isLanguage,
  LANGUAGES,
  LOCALE_PATH,
  otherLanguage,
} from "../lib/i18n.ts";

/**
 * The dictionary replaced ~115 inline ternaries. Its whole value is that a
 * missing or accidentally-English translation is caught here rather than
 * discovered by an Arabic-speaking patient.
 */

const ARABIC = /[؀-ۿ]/;

/** Strings that are legitimately identical or Latin in both languages. */
const SHARED_KEYS = new Set([
  "intlLocale",
  "brandName",
  "brandRole",
  "languageShort",
  "replay",
]);

test("both languages expose exactly the same keys", () => {
  const en = Object.keys(dictionary.en).sort();
  const ar = Object.keys(dictionary.ar).sort();
  assert.deepEqual(ar, en);
});

test("no entry is empty in either language", () => {
  for (const language of ["en", "ar"] as const) {
    for (const [key, value] of Object.entries(dictionary[language])) {
      if (typeof value === "string") {
        assert.ok(value.trim().length > 0, `${language}.${key} is empty`);
      } else if (Array.isArray(value)) {
        assert.ok(value.length > 0, `${language}.${key} is an empty list`);
        for (const item of value) {
          assert.ok(String(item).trim().length > 0, `${language}.${key} has a blank item`);
        }
      }
    }
  }
});

test("Arabic copy is actually written in Arabic", () => {
  for (const [key, value] of Object.entries(dictionary.ar)) {
    if (SHARED_KEYS.has(key) || typeof value !== "string") continue;
    assert.ok(ARABIC.test(value), `ar.${key} does not contain Arabic script: "${value}"`);
  }
});

test("the Arabic prompt list is translated, not copied", () => {
  assert.equal(dictionary.ar.noorPrompts.length, dictionary.en.noorPrompts.length);
  for (const [index, prompt] of dictionary.ar.noorPrompts.entries()) {
    assert.ok(ARABIC.test(prompt));
    assert.notEqual(prompt, dictionary.en.noorPrompts[index]);
  }
});

test("navigation labels line up with the sections they point at", () => {
  // The header renders four anchors against these labels; a short list would
  // silently render `undefined`.
  assert.equal(dictionary.en.nav.length, 4);
  assert.equal(dictionary.ar.nav.length, 4);
});

test("NOOR answer sets cover the same topics in both languages", () => {
  const en = Object.keys(dictionary.en.noorAnswers).sort();
  const ar = Object.keys(dictionary.ar.noorAnswers).sort();
  assert.deepEqual(ar, en);
  for (const answer of Object.values(dictionary.ar.noorAnswers)) {
    assert.ok(ARABIC.test(answer));
  }
});

test("interpolated strings substitute their argument", () => {
  assert.match(copyFor("en").heldFor("4:30"), /4:30/);
  assert.match(copyFor("ar").heldFor("4:30"), /4:30/);
  assert.match(copyFor("en").bookingSuccessBody("Maadi"), /Maadi/);
  assert.match(copyFor("ar").bookingSuccessBody("المعادي"), /المعادي/);
});

test("language guards and direction are correct", () => {
  assert.ok(isLanguage("en"));
  assert.ok(isLanguage("ar"));
  assert.ok(!isLanguage("fr"));
  assert.ok(!isLanguage(null));
  assert.equal(directionFor("ar"), "rtl");
  assert.equal(directionFor("en"), "ltr");
});

/**
 * Routing invariants. The layouts, the language switch, the canonical tag and
 * the sitemap all read `LOCALE_PATH`; if any of these drift apart Google reads
 * `/` and `/ar` as duplicates instead of as one page in two languages.
 */

test("every language has a distinct, absolute canonical path", () => {
  const paths = LANGUAGES.map((language) => LOCALE_PATH[language]);
  assert.equal(new Set(paths).size, paths.length, "two languages share a URL");
  for (const path of paths) {
    assert.ok(path.startsWith("/"), `${path} is not root-relative`);
    assert.ok(!path.endsWith("/") || path === "/", `${path} has a trailing slash`);
  }
});

test("English is the site root so the most-linked URL never redirects", () => {
  assert.equal(LOCALE_PATH.en, "/");
  assert.equal(LOCALE_PATH.ar, "/ar");
});

test("LANGUAGES covers exactly the dictionary", () => {
  assert.deepEqual([...LANGUAGES].sort(), Object.keys(dictionary).sort());
});

test("the language switch always points at the other language", () => {
  for (const language of LANGUAGES) {
    const other = otherLanguage(language);
    assert.notEqual(other, language);
    assert.ok(LANGUAGES.includes(other));
    // Switching twice must return to where you started.
    assert.equal(otherLanguage(other), language);
  }
});
