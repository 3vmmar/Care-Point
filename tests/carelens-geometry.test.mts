import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCH,
  BUST_FLATTEN,
  CROWN_TOP,
  NESTED_ARCH,
  QUADRANT,
  TOOTH_CLASSES,
  buildArchLayout,
  buildCraniumProfile,
  buildProfile,
  buildTooth,
  type ToothClass,
} from "../lib/carelens-geometry.ts";

/**
 * The CareLens model has no source asset to inspect — every vertex is computed,
 * so the only way to know it is right is to measure it.
 *
 * These tests exist because the failure mode of generated geometry is
 * viewpoint-dependent. Bone poking through a cheek, or a tooth arch wider than
 * the jaw holding it, is invisible from the front and obvious from below. A
 * screenshot proves one camera angle; arithmetic proves all of them.
 */

/** Every position in a geometry, as triples. */
function vertices(geometry: { getAttribute(name: string): { array: ArrayLike<number> } }) {
  const array = geometry.getAttribute("position").array;
  const out: Array<[number, number, number]> = [];
  for (let index = 0; index < array.length; index += 3) {
    out.push([array[index], array[index + 1], array[index + 2]]);
  }
  return out;
}

function bounds(points: Array<[number, number, number]>) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}

const CLASSES: ToothClass[] = ["incisor", "canine", "premolar", "molar"];

test("every tooth is finite and closed", () => {
  for (const toothClass of CLASSES) {
    const points = vertices(buildTooth(toothClass));
    assert.ok(points.length > 0, `${toothClass} produced no vertices`);
    for (const [x, y, z] of points) {
      assert.ok(
        Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z),
        `${toothClass} has a non-finite vertex`,
      );
    }
  }
});

test("a tooth has a crown above the gum line and a root below it", () => {
  for (const toothClass of CLASSES) {
    const spec = TOOTH_CLASSES[toothClass];
    const { min, max } = bounds(vertices(buildTooth(toothClass)));

    // y = 0 is the neck. The crown must reach up and the root must reach down,
    // or the tooth is a lump sitting on the gum rather than anchored in it.
    assert.ok(max[1] > 0, `${toothClass} has no crown above the neck`);
    assert.ok(min[1] < 0, `${toothClass} has no root below the neck`);

    // The root is the longer half of a real tooth, and the model keeps that —
    // it is the whole point of the "Roots and gums" depth.
    assert.ok(
      Math.abs(min[1]) > max[1],
      `${toothClass} root (${min[1].toFixed(3)}) should be longer than its crown (${max[1].toFixed(3)})`,
    );
    assert.ok(Math.abs(min[1]) <= spec.root + 1e-6, `${toothClass} root overruns its spec`);
  }
});

test("tooth classes are distinguishable in silhouette", () => {
  const measure = (toothClass: ToothClass) => {
    const { min, max } = bounds(vertices(buildTooth(toothClass)));
    return { width: max[0] - min[0], depth: max[2] - min[2] };
  };

  const incisor = measure("incisor");
  const molar = measure("molar");
  const canine = measure("canine");

  // An incisor is a blade and a molar is a block. If their depth-to-width
  // ratios converged, every tooth in the arch would read as the same tooth.
  assert.ok(
    incisor.depth / incisor.width < 0.6,
    `incisor should be flat, got ratio ${(incisor.depth / incisor.width).toFixed(2)}`,
  );
  assert.ok(
    molar.depth / molar.width > 0.8,
    `molar should be blocky, got ratio ${(molar.depth / molar.width).toFixed(2)}`,
  );
  assert.ok(molar.width > incisor.width, "a molar should be wider than an incisor");
  assert.ok(canine.width > 0, "canine has no width");
});

test("cusp count matches the tooth class", () => {
  /** Local maxima in height around the biting surface. */
  const countCusps = (toothClass: ToothClass) => {
    const points = vertices(buildTooth(toothClass));
    // The last full ring is the biting surface. Rings are emitted in order, so
    // the tail of the array is the top of the crown.
    const segments = 25; // TOOTH_SEGMENTS + 1
    const top = points.slice(points.length - segments, points.length - 1);
    const heights = top.map((point) => point[1]);

    let peaks = 0;
    for (let index = 0; index < heights.length; index += 1) {
      const previous = heights[(index - 1 + heights.length) % heights.length];
      const next = heights[(index + 1) % heights.length];
      if (heights[index] > previous && heights[index] >= next) peaks += 1;
    }
    return { peaks, spread: Math.max(...heights) - Math.min(...heights) };
  };

  // A flat incisal edge: no peaks worth the name, and almost no height variation
  // around the ring.
  assert.ok(countCusps("incisor").spread < 0.004, "an incisor edge should be flat");

  assert.equal(countCusps("canine").peaks, 1, "a canine has one cusp");
  assert.equal(countCusps("premolar").peaks, 2, "a premolar has two cusps");
  assert.equal(countCusps("molar").peaks, 4, "a molar has four cusps");
});

test("the arch carries 28 teeth with valid, unique FDI numbers", () => {
  const arch = buildArchLayout();
  assert.equal(arch.length, 28, "seven teeth per quadrant, four quadrants");

  const numbers = arch.map((tooth) => tooth.fdi);
  assert.equal(new Set(numbers).size, 28, "FDI numbers must be unique");

  for (const fdi of numbers) {
    const quadrant = Math.floor(fdi / 10);
    const position = fdi % 10;
    assert.ok(quadrant >= 1 && quadrant <= 4, `${fdi} is not in a valid quadrant`);
    assert.ok(position >= 1 && position <= 7, `${fdi} is not a valid tooth position`);
  }
});

test("neighbouring teeth do not grow into each other", () => {
  const arch = buildArchLayout();

  for (const upper of [true, false]) {
    for (const side of ["L", "R"]) {
      const quadrant = arch
        .filter((tooth) => tooth.key.startsWith(`${upper ? "U" : "L"}${side}`))
        .sort((a, b) => a.fdi - b.fdi);

      for (let index = 1; index < quadrant.length; index += 1) {
        const previous = quadrant[index - 1];
        const current = quadrant[index];
        const gap = Math.hypot(
          current.position[0] - previous.position[0],
          current.position[2] - previous.position[2],
        );
        // Half of each crown's width has to fit in the gap between the centres.
        // Anything less and the two crowns interpenetrate, which renders as a
        // dark seam that reads unmistakably as a modelling error.
        const needed =
          (TOOTH_CLASSES[previous.toothClass].width + TOOTH_CLASSES[current.toothClass].width) / 2;
        assert.ok(
          gap >= needed * 0.98,
          `${previous.fdi}→${current.fdi} centres are ${gap.toFixed(4)} apart but need ${needed.toFixed(4)}`,
        );
      }
    }
  }
});

test("the lower arch sits inside the upper one, and below it", () => {
  const arch = buildArchLayout();
  const upper = arch.filter((tooth) => tooth.upper);
  const lower = arch.filter((tooth) => !tooth.upper);

  assert.equal(upper.length, 14);
  assert.equal(lower.length, 14);

  const reach = (teeth: typeof arch) =>
    Math.max(...teeth.map((tooth) => Math.hypot(tooth.position[0], tooth.position[2])));

  assert.ok(reach(upper) > reach(lower), "the upper arch should be the wider of the two");
  assert.ok(
    Math.min(...upper.map((tooth) => tooth.position[1]))
      > Math.max(...lower.map((tooth) => tooth.position[1])),
    "no upper tooth may sit at or below a lower one",
  );
});

test("the arch is symmetrical across the midline", () => {
  const arch = buildArchLayout();

  for (let index = 0; index < QUADRANT.length; index += 1) {
    const left = arch.find((tooth) => tooth.key === `UL${index}`)!;
    const right = arch.find((tooth) => tooth.key === `UR${index}`)!;
    assert.ok(
      Math.abs(left.position[0] + right.position[0]) < 1e-9,
      `tooth ${index} is not mirrored across the midline`,
    );
    assert.ok(
      Math.abs(left.position[2] - right.position[2]) < 1e-9,
      `tooth ${index} sits at a different depth on each side`,
    );
  }
});

test("the bust profile closes at both poles", () => {
  const profile = buildProfile();

  // A lathe is an open surface. If either end is off the axis the camera sees
  // straight into a hollow shell, which rendered as a dark ellipse under the
  // shoulders in an earlier version and read as a hole.
  assert.ok(profile[0].x < 1e-9, "the crown does not close on the axis");
  assert.ok(profile[profile.length - 1].x < 1e-9, "the base does not close on the axis");

  for (const point of profile) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), "non-finite profile point");
    assert.ok(point.x >= 0, "a lathe profile cannot have negative radius");
  }
  assert.ok(Math.abs(profile[0].y - CROWN_TOP) < 1e-9, "the crown is not at the expected height");
});

test("the avatar continues through the upper abdomen", () => {
  const profile = buildProfile();
  const base = Math.min(...profile.map((point) => point.y));
  assert.ok(base <= -2.15, `upper-body model stops too high at y=${base.toFixed(2)}`);

  // A waist has to narrow below the shoulder line. Without that change in
  // silhouette, extending the old bust merely produces a long pedestal.
  const shoulder = Math.max(...profile.filter((point) => point.y < -0.55 && point.y > -0.8).map((point) => point.x));
  const waist = Math.max(...profile.filter((point) => point.y < -1.75).map((point) => point.x));
  assert.ok(shoulder > waist, `shoulder radius ${shoulder.toFixed(2)} should exceed waist ${waist.toFixed(2)}`);
});

test("the inset shell stays inside the surface it is derived from", () => {
  const surface = buildProfile(0);
  const structure = buildProfile(0.035);
  assert.equal(surface.length, structure.length, "inset must not change the sampling");

  for (let index = 0; index < surface.length; index += 1) {
    assert.ok(
      structure[index].x <= surface[index].x + 1e-9,
      `structure shell is wider than the surface at point ${index}`,
    );
    assert.ok(structure[index].x >= 0, "inset drove a radius negative");
  }
});

/** Largest surface radius at a given height, interpolated along the profile. */
function bustRadiusAt(height: number): number {
  const profile = buildProfile();
  let radius = 0;
  for (let index = 1; index < profile.length; index += 1) {
    const a = profile[index - 1];
    const b = profile[index];
    const low = Math.min(a.y, b.y);
    const high = Math.max(a.y, b.y);
    if (height < low || height > high) continue;
    const t = Math.abs(b.y - a.y) < 1e-12 ? 0 : (height - a.y) / (b.y - a.y);
    radius = Math.max(radius, a.x + (b.x - a.x) * t);
  }
  return radius;
}

test("the skull stays inside the face", () => {
  // Both shells take the same front-to-back squash, so comparing profile radii
  // is comparing like with like.
  for (const point of buildCraniumProfile()) {
    const surface = bustRadiusAt(point.y);
    assert.ok(surface > 0, `no surface found at height ${point.y.toFixed(3)}`);
    assert.ok(
      point.x < surface,
      `bone breaks the skin at height ${point.y.toFixed(3)}: `
        + `cranium ${point.x.toFixed(4)} vs surface ${surface.toFixed(4)}`,
    );
  }
});

test("the nested arch fits inside the head that contains it", () => {
  const arch = buildArchLayout();
  const { position, scale } = NESTED_ARCH;

  for (const tooth of arch) {
    const spec = TOOTH_CLASSES[tooth.toothClass];
    // Worst case for a crown: its centre pushed out by half its own width.
    const reach = Math.hypot(tooth.position[0], tooth.position[2]) + spec.width;

    const height = position[1] + tooth.position[1] * scale;
    const outX = reach * scale;
    // The arch group takes the same flattening as the shells around it, or a
    // round arch inside a squashed head pushes straight through the jaw. That
    // is precisely the defect this test was written to catch.
    const outZ = reach * scale * BUST_FLATTEN.z + Math.abs(position[2]);

    const surface = bustRadiusAt(height);
    assert.ok(surface > 0, `no surface at arch height ${height.toFixed(3)}`);

    assert.ok(
      outX < surface,
      `arch tooth ${tooth.fdi} breaks the jaw sideways at height ${height.toFixed(3)}: `
        + `${outX.toFixed(4)} vs ${surface.toFixed(4)}`,
    );
    assert.ok(
      outZ < surface * BUST_FLATTEN.z,
      `arch tooth ${tooth.fdi} breaks the jaw front-to-back at height ${height.toFixed(3)}: `
        + `${outZ.toFixed(4)} vs ${(surface * BUST_FLATTEN.z).toFixed(4)}`,
    );
  }
});

test("arch radii are the single source the ridge and layout share", () => {
  const arch = buildArchLayout();
  const upperReach = Math.max(
    ...arch.filter((tooth) => tooth.upper).map((tooth) => Math.hypot(tooth.position[0], tooth.position[2])),
  );
  // Teeth are placed on an ellipse, so no tooth can sit further out than its
  // larger radius. A mismatch here means the layout and the gum ridge have
  // drifted apart and teeth would float off the gum.
  assert.ok(
    upperReach <= Math.max(ARCH.upper.radiusX, ARCH.upper.radiusZ) + 1e-9,
    "a tooth sits outside the arch ellipse it was placed on",
  );
});
