import assert from "node:assert/strict";
import test from "node:test";
import {
  ANATOMY_ANCHORS,
  AREAS,
  LAYERS,
  findArea,
  layerHint,
  layersFor,
  regionWorldPosition,
  regionsVisibleAt,
} from "../lib/anatomy.ts";
import {
  AVATAR_LANDMARKS,
  BODY_RINGS,
  FIGURE,
  ringAt,
  sculptedFrontAt,
  sculptedSideAt,
} from "../lib/carelens-geometry.ts";
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
      assert.ok(region.anchor in ANATOMY_ANCHORS, `${where} has no model-space landmark`);
      assert.ok(
        regionWorldPosition(region).every(Number.isFinite),
        `${where} does not resolve to a finite model-space point`,
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

test("no area or region offers a line of care the clinic has withdrawn", () => {
  /**
   * Hair & scalp was removed from the catalogue before it launched. The failure
   * mode of a withdrawn service is not a crash — it is a region that keeps
   * advertising a consultation the booking form can no longer take, which is a
   * dead end for the patient and an advertising problem for the practice.
   */
  const withdrawn = [/hair/i, /scalp/i, /hairline/i];
  const offending = (value: string) => withdrawn.some((pattern) => pattern.test(value));

  for (const area of AREAS) {
    assert.ok(!offending(area.id), `area ${area.id} is a withdrawn line of care`);
    assert.ok(!offending(area.en), `area ${area.en} is a withdrawn line of care`);

    for (const region of area.regions) {
      assert.ok(!offending(region.id), `${area.id}/${region.id} is a withdrawn region`);
      assert.ok(!offending(region.en), `${area.id}/${region.en} is a withdrawn region`);
      for (const procedure of [...region.procedures, ...region.arProcedures]) {
        assert.ok(
          !offending(procedure),
          `${area.id}/${region.id} still offers "${procedure}"`,
        );
      }
    }
  }

  for (const service of SERVICES) {
    assert.ok(!offending(service.id), `the catalogue still sells "${service.id}"`);
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
    const [x, y, z] = regionWorldPosition(region);
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

  // The figure areas share one body, six units tall, standing on y = -3.
  for (const area of AREAS.filter((candidate) => candidate.model === "figure")) {
    for (const region of area.regions) {
      const [x, y, z] = regionWorldPosition(region);
      const ring = ringAt(BODY_RINGS, y);
      assert.ok(ring, `${area.id}/${region.id} sits at y=${y}, off the trunk`);
      assert.ok(
        Math.hypot(x, z) <= 0.75,
        `${area.id}/${region.id} sits outside the figure's widest point`,
      );
      assert.ok(
        y <= FIGURE.crown && y >= FIGURE.sole,
        `${area.id}/${region.id} sits above the crown or below the sole`,
      );
    }
  }
});

test("head and face hotspots stay attached to the faceless surface", () => {
  /**
   * The head carries no features, so a marker here names the anatomy the
   * consultation covers and points at where it sits on the cranial form. That
   * makes the surface it has to touch the head itself — there is no relief mesh
   * for it to stand on, and no exception for the ear or the nose tip, both of
   * which needed one when those were separate glued-on shapes.
   */
  for (const areaId of ["face", "nose"] as const) {
    for (const region of findArea(areaId).regions) {
      const [x, y, z] = regionWorldPosition(region);
      const ring = ringAt(BODY_RINGS, y);
      assert.ok(ring, `${areaId}/${region.id} has no head beneath it`);

      /**
       * Measured against the sculpted surface, not the base loft.
       *
       * Once the brow, nose and lips are displacement rather than rings, the base
       * form is no longer where the skin is — a nose marker sits 0.04 outside it.
       * Checking against the rings would demand that every facial marker be buried
       * inside the feature it names.
       */
      // Lateral markers such as the ears sit on the side of the skull, where the
      // anterior surface is meaningless; measure those across instead.
      const lateral = Math.abs(x) > ring!.rx * 0.85;
      const surface = lateral ? sculptedSideAt(x, y) : sculptedFrontAt(x, y);
      assert.ok(Number.isFinite(surface), `${areaId}/${region.id} has no surface beneath it`);

      const clearance = (lateral ? Math.abs(x) : z) - surface;
      assert.ok(
        clearance >= -0.012 && clearance <= 0.03,
        `${areaId}/${region.id} is ${clearance.toFixed(3)} from its rendered surface`,
      );
    }
  }
});

test("every torso marker sits on the sculpted surface too", () => {
  /**
   * The breast is the case this guards. Its markers used to sit on a chest wall;
   * they now have to sit on the form that rises out of it, and the difference is
   * about 0.09 — far more than the tolerance. A marker left at the old depth would
   * be buried inside the breast rather than annotating it.
   */
  for (const areaId of ["body", "breast"] as const) {
    for (const region of findArea(areaId).regions) {
      const [x, y, z] = regionWorldPosition(region);
      const surface = sculptedFrontAt(x, y);
      assert.ok(
        Number.isFinite(surface),
        `${areaId}/${region.id} has no sculpted surface beneath it`,
      );
      const clearance = z - surface;
      assert.ok(
        clearance >= -0.014 && clearance <= 0.032,
        `${areaId}/${region.id} is ${clearance.toFixed(3)} from the sculpted surface`,
      );
    }
  }
});

test("required landmarks are present and anatomically ordered", () => {
  const required = new Set([
    "brow", "eyelid", "lips", "jawline", "chin", "ears", "neck",
    "dorsum", "abdomen", "position", "volume", "smile-line",
  ]);
  const present = new Set(AREAS.flatMap((area) => area.regions.map((region) => region.id)));
  for (const id of required) assert.ok(present.has(id), `missing required treatment landmark ${id}`);

  const breast = findArea("breast");
  const position = regionWorldPosition(breast.regions.find((region) => region.id === "position")!);
  const scar = regionWorldPosition(breast.regions.find((region) => region.id === "scar")!);
  const neck = regionWorldPosition(findArea("face").regions.find((region) => region.id === "neck")!);
  const abdomen = regionWorldPosition(findArea("body").regions.find((region) => region.id === "abdomen")!);
  const brow = regionWorldPosition(findArea("face").regions.find((region) => region.id === "brow")!);
  const chin = regionWorldPosition(findArea("face").regions.find((region) => region.id === "chin")!);

  // Head, top down.
  assert.ok(brow[1] > chin[1], "the brow must sit above the chin");
  assert.ok(chin[1] > neck[1], "the chin must sit above the neck");

  // Trunk, top down.
  assert.ok(neck[1] > position[1], "the neck must sit above the chest");
  assert.ok(position[1] < neck[1] - 0.3, "breast centre must sit well below the neck");
  assert.ok(position[2] > 0.2, "breast marker must sit on the anterior chest");
  assert.ok(scar[1] < position[1], "inframammary scar must sit below the breast centre");
  assert.ok(abdomen[1] < position[1], "abdomen must sit below the chest");

  // And the whole set lands between the crown and the pubis, where the figure's
  // annotated anatomy lives.
  assert.ok(brow[1] < FIGURE.crown, "the brow cannot sit above the crown");
  assert.ok(abdomen[1] > FIGURE.crotch, "the abdomen cannot sit below the pubis");
  assert.ok(
    Math.abs(AVATAR_LANDMARKS.navel[1] - abdomen[1]) < 0.2,
    "the abdomen marker and the navel landmark have drifted apart",
  );

  assert.ok(
    breast.regions.filter((region) => region.id === "position" || region.id === "volume")
      .every((region) => region.mirrorX),
    "breast surface regions must remain bilateral",
  );
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
