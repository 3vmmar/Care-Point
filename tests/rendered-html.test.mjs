import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the premium patient experience and production assets", async () => {
  const [experience, layout, intro, universe, journeyDesigner] = await Promise.all([
    readFile(new URL("app/components/CarePointExperience.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/ExperienceIntro.tsx", root), "utf8"),
    readFile(new URL("app/components/TreatmentUniverse.tsx", root), "utf8"),
    readFile(new URL("app/components/JourneyDesigner.tsx", root), "utf8"),
    access(new URL("public/doctor-hero.png", root)),
    access(new URL("public/og.png", root)),
  ]);

  assert.match(experience, /Aesthetic care/);
  assert.match(experience, /Ask NOOR/);
  assert.match(experience, /Lenis/);
  assert.match(experience, /portrait-footer/);
  assert.match(experience, /heroPassed/);
  assert.match(experience, /\/api\/availability/);
  assert.match(experience, /\/api\/bookings/);
  assert.match(intro, /Enter the experience/);
  assert.match(universe, /Canvas/);
  assert.match(universe, /Open consultation map/);
  assert.match(journeyDesigner, /YOUR RECOMMENDED STARTING POINT/);
  assert.match(layout, /The Future of Aesthetic Care/);
  assert.doesNotMatch(experience, /codex-preview|Building your site/);
});

test("ships durable booking APIs and the clinic command center", async () => {
  const [availability, bookings, commandCenter, hosting] = await Promise.all([
    readFile(new URL("app/api/availability/route.ts", root), "utf8"),
    readFile(new URL("db/bookings.ts", root), "utf8"),
    readFile(new URL("app/command-center/CommandCenter.tsx", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(availability, /holdAppointment/);
  assert.match(bookings, /appointments_slot_unique/);
  assert.match(bookings, /status = 'confirmed'/);
  assert.match(commandCenter, /NOOR SIGNAL/);
  assert.match(hosting, /"d1": "DB"/);
});
