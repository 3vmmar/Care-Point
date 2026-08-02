import assert from "node:assert/strict";
import test from "node:test";
import { AREAS, LAYERS, findArea, layerHint, layersFor, regionsVisibleAt } from "../lib/anatomy.ts";
import { SERVICES } from "../lib/clinic.ts";

/**
 * CareLens content.
 *
 * Two classes of defect this guards against, both of which render as something
 * plausible rather than as an error:
 *
 *  1. **A missing Arabic string.** Half the audience reads the Arabic site. An
 *     empty `ar*` field shows a blank panel, not a fallback, and nothing in the
 *     type system objects because `""` is a valid string.
 *  2. **A procedure the clinic cannot take.** Every name under "bookable" has
 *     to exist on the booking form. Advertising a treatment that has no service
 *     behind it is a dead end for the patient and, in a market where the Medical
 *     Syndicate governs medical advertising, a problem for the practice.
 */

const bookable = new Set(SERVICES.map((service) => service.en));
const bookableAr = new Set(SERVICES.map((service) => service.ar));

test("every area is complete in both languages", () => {
  assert.equal(AREAS.length, 5, "four original areas plus Dental");

  const ids = AREAS.map((area) => area.id);
  assert.equal(new Set(ids).size, ids.length, "area ids must be unique");
  assert.deepEqual(ids, ["face", "nose", "body", "breast", "dental"]);

  AREAS.forEach((area, index) => {
    assert.equal(area.number, `0${index + 1}`, `${area.id} is numbered out of order`);
    for (const [field, value] of Object.entries({
      en: area.en, ar: area.ar,
      feeling: area.feeling, arFeeling: area.arFeeling,
      description: area.description, arDescription: area.arDescription,
    })) {
      assert.ok(value.trim().length > 0, `${area.id}.${field} is empty`);
    }
  });
});

test("every region carries its full content in both languages", () => {
  for (const area of AREAS) {
    assert.ok(area.regions.length >= 3, `${area.id} has too few regions to explore`);

    const ids = area.regions.map((region) => region.id);
    assert.equal(new Set(ids).size, ids.length, `${area.id} has duplicate region ids`);

    for (const region of area.regions) {
      const where = `${area.id}/${region.id}`;

      for (const [field, value] of Object.entries({
        en: region.en, ar: region.ar,
        overview: region.overview, arOverview: region.arOverview,
        recovery: region.recovery, arRecovery: region.arRecovery,
      })) {
        assert.ok(value.trim().length > 0, `${where}.${field} is empty`);
      }

      // A list that is translated to a different length means one language is
      // showing a tag the other is not.
      assert.equal(
        region.structures.length, region.arStructures.length,
        `${where} structures differ in length between languages`,
      );
      assert.equal(
        region.procedures.length, region.arProcedures.length,
        `${where} procedures differ in length between languages`,
      );
      assert.equal(
        (region.discussed ?? []).length, (region.arDiscussed ?? []).length,
        `${where} discussed items differ in length between languages`,
      );

      for (const item of [...region.structures, ...region.arStructures]) {
        assert.ok(item.trim().length > 0, `${where} has an empty structure`);
      }

      assert.ok(region.structures.length >= 3, `${where} lists too few structures to be useful`);
      assert.ok(
        Number.isFinite(region.at[0]) && Number.isFinite(region.at[1]) && Number.isFinite(region.at[2]),
        `${where} has a non-finite hotspot position`,
      );
    }
  }
});

test("every bookable procedure is a service the clinic can actually take", () => {
  for (const area of AREAS) {
    for (const region of area.regions) {
      for (const procedure of region.procedures) {
        assert.ok(
          bookable.has(procedure),
          `${area.id}/${region.id} offers "${procedure}", which is not in lib/clinic.ts SERVICES`,
        );
      }
      for (const procedure of region.arProcedures) {
        assert.ok(
          bookableAr.has(procedure),
          `${area.id}/${region.id} offers Arabic "${procedure}", which is not a known service`,
        );
      }
    }
  }
});

test("the Dental area offers only dental services", () => {
  const dental = findArea("dental");
  const dentalNames = new Set(
    SERVICES.filter((service) => service.category === "dental").map((service) => service.en),
  );

  const offered = dental.regions.flatMap((region) => region.procedures);
  assert.ok(offered.length > 0, "Dental offers nothing bookable");

  for (const procedure of offered) {
    assert.ok(dentalNames.has(procedure), `Dental offers "${procedure}", which is not a dental service`);
  }

  // Every dental service the clinic sells should be reachable from the area, or
  // the booking form can take something the site never explains.
  for (const name of dentalNames) {
    assert.ok(offered.includes(name), `no Dental region mentions the bookable service "${name}"`);
  }
});

test("depth only offers layers that have something to show", () => {
  for (const area of AREAS) {
    const available = layersFor(area);
    assert.ok(available.length >= 1, `${area.id} offers no depth at all`);

    for (const layer of available) {
      assert.ok(
        area.regions.some((region) => region.layer === layer),
        `${area.id} offers the ${layer} depth but has no region at it`,
      );
    }

    // Depth is ordered outside-in. An area that jumped from surface to skeleton
    // would put the buttons in an order that does not match the model.
    const order = LAYERS.map((entry) => entry.id).filter((id) => available.includes(id));
    assert.deepEqual(available, order, `${area.id} lists its depths out of order`);
  }
});

test("cutting deeper adds regions and never removes one", () => {
  for (const area of AREAS) {
    let previous = 0;
    for (const layer of layersFor(area)) {
      const visible = regionsVisibleAt(area, layer);
      assert.ok(
        visible.length >= previous,
        `${area.id} shows fewer regions at ${layer} than at the depth above it`,
      );
      assert.ok(visible.length > 0, `${area.id} shows nothing at ${layer}`);
      previous = visible.length;
    }

    // The deepest available depth has to reach every region, or some content is
    // unreachable no matter what the viewer does.
    const deepest = layersFor(area).at(-1)!;
    assert.equal(
      regionsVisibleAt(area, deepest).length, area.regions.length,
      `${area.id} has regions no depth reveals`,
    );
  }
});

test("every hotspot sits on the model it annotates", () => {
  /**
   * Markers were first placed by eye against the camera, which put every dental
   * one up to 0.6 units in front of the teeth — reading as beads floating in
   * space rather than as labels on anatomy. The arch is small and its extents
   * are known, so the fit is checkable.
   */
  const dental = findArea("dental");
  /**
   * The arch's furthest surface is the front of the upper incisors, at 0.86 on
   * the ellipse plus about 0.02 of crown. A marker is meant to stand slightly
   * proud of that — it is a label on the anatomy, not a pin buried in it — so
   * the bound allows roughly a marker's width beyond the surface and no more.
   */
  const ARCH_REACH = 1.05;
  const ARCH_TOP = 0.62;
  const ARCH_BOTTOM = -0.62;

  for (const region of dental.regions) {
    const [x, y, z] = region.at;
    const reach = Math.hypot(x, z);
    assert.ok(
      reach <= ARCH_REACH,
      `dental/${region.id} floats ${reach.toFixed(2)} from the axis; the arch reaches ${ARCH_REACH}`,
    );
    assert.ok(
      y <= ARCH_TOP && y >= ARCH_BOTTOM,
      `dental/${region.id} sits at y=${y}, outside the arch's ${ARCH_BOTTOM}..${ARCH_TOP}`,
    );
  }

  // The bust areas share one silhouette that reaches y = 1.62 at the crown and
  // -0.85 at the base, and never exceeds 1.11 in radius.
  for (const area of AREAS.filter((candidate) => candidate.model === "bust")) {
    for (const region of area.regions) {
      const [x, y, z] = region.at;
      assert.ok(
        Math.hypot(x, z) <= 1.2,
        `${area.id}/${region.id} sits outside the bust's widest point`,
      );
      assert.ok(y <= 1.7 && y >= -0.9, `${area.id}/${region.id} sits above or below the bust`);
    }
  }
});

test("depth hints read correctly for the area they describe", () => {
  for (const area of AREAS) {
    for (const layer of layersFor(area)) {
      for (const rtl of [false, true]) {
        const hint = layerHint(area, layer, rtl);
        assert.ok(hint.trim().length > 0, `${area.id}/${layer} has no hint (rtl=${rtl})`);
      }
    }
  }

  // Teeth are not "the shape you see in a mirror". The override exists because
  // the general wording was actively wrong here, so assert it is still in force.
  const dental = findArea("dental");
  assert.match(layerHint(dental, "surface", false), /enamel/i);
  assert.doesNotMatch(layerHint(dental, "surface", false), /mirror/i);
  assert.doesNotMatch(layerHint(dental, "structure", false), /skin/i);

  // And that the areas without an override still get the general wording.
  assert.match(layerHint(findArea("face"), "surface", false), /mirror/i);
});
