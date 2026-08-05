import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCH,
  ARM_RINGS,
  AVATAR_LANDMARKS,
  BODY_RINGS,
  BODY_SCULPT,
  FACE_SCULPT,
  FIGURE,
  FOOT_MOUNT,
  FOOT_RINGS,
  FOOT_TOES,
  HAND_MOUNT,
  HAND_PALM,
  HEAD_HEIGHT,
  HEAD_RINGS,
  LEG_RINGS,
  NESTED_ARCH,
  QUADRANT,
  SKULL_RINGS,
  TOOTH_CLASSES,
  applySculpt,
  buildArchLayout,
  buildFoot,
  buildHand,
  buildHeadContours,
  buildLoft,
  buildTooth,
  insetRings,
  mirrorRings,
  resampleRings,
  ringAt,
  type Ring,
  type ToothClass,
} from "../lib/carelens-geometry.ts";
import { AREAS, findArea, regionWorldPosition } from "../lib/anatomy.ts";

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

/* ══ The standing figure ═══════════════════════════════════════════════════ */

/** Ring lists are authored crown-down; `buildLoft` derives winding from that. */
function assertDescending(name: string, rings: Ring[]) {
  for (let index = 1; index < rings.length; index += 1) {
    assert.ok(
      rings[index].y < rings[index - 1].y,
      `${name} ring ${index} is at or above the one before it, which flips the winding`,
    );
  }
}

/**
 * How far a point sits from a ring's surface, as a multiple of the surface.
 *
 * 1 is exactly on the skin, below 1 is inside the body and above 1 is off it.
 * Working in this normalised space is what lets one assertion cover a marker on
 * the front of a sternum and one on the side of a skull — a plain z comparison
 * only ever describes anterior anatomy, which is why the ear marker on the old
 * model needed a hand-written exception.
 */
function surfaceDistance(rings: Ring[], point: [number, number, number]): number {
  const ring = ringAt(rings, point[1]);
  if (!ring) return Number.NaN;
  const exponent = ring.n ?? 2;
  const dx = Math.abs(point[0] - (ring.x ?? 0)) / ring.rx;
  const dz = Math.abs(point[2] - (ring.z ?? 0)) / ring.rz;
  return Math.pow(
    Math.pow(dx, exponent) + Math.pow(dz, exponent),
    1 / exponent,
  );
}

test("the figure is a whole body at canonical proportions", () => {
  const height = FIGURE.crown - FIGURE.sole;
  assert.ok(Math.abs(height - 6) < 1e-9, `the figure should be six units tall, got ${height}`);

  // 7.5 heads is the canonical standing figure. Getting this wrong is the single
  // most visible proportion error available: at 6 heads an adult reads as a
  // child, at 8 as a fashion illustration.
  const heads = height / HEAD_HEIGHT;
  assert.ok(Math.abs(heads - 7.5) < 1e-9, `expected a 7.5-head figure, got ${heads}`);
  assert.ok(
    Math.abs((FIGURE.crown - FIGURE.chin) - HEAD_HEIGHT) < 1e-9,
    "crown to chin must be exactly one head height",
  );

  // Mid-height of a standing figure falls at the pubis, which is why that is the
  // origin of model space.
  assert.equal(FIGURE.crotch, 0, "the origin should sit at the figure's mid-height");
  assert.ok(
    Math.abs(FIGURE.crotch - (FIGURE.crown + FIGURE.sole) / 2) < 1e-9,
    "the pubis is not at the figure's mid-height",
  );

  // Landmarks in anatomical order, head to toe.
  const order = [
    FIGURE.crown, FIGURE.cranium, FIGURE.brow, FIGURE.chin, FIGURE.shoulder,
    FIGURE.chest, FIGURE.waist, FIGURE.hip, FIGURE.crotch, FIGURE.knee,
    FIGURE.ankle, FIGURE.sole,
  ];
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(
      order[index] < order[index - 1],
      `figure landmark ${index} (${order[index]}) is not below the one above it`,
    );
  }
});

test("every ring stack descends and closes where it has to", () => {
  assertDescending("BODY_RINGS", BODY_RINGS);
  assertDescending("ARM_RINGS", ARM_RINGS);
  assertDescending("LEG_RINGS", LEG_RINGS);
  assertDescending("FOOT_RINGS", FOOT_RINGS);
  assertDescending("SKULL_RINGS", SKULL_RINGS);

  // A loft is an open surface. Where a stack ends without another form covering
  // it, the last ring has to collapse onto its own axis or the camera looks
  // straight into a hollow shell.
  const closes = (name: string, ring: Ring) => {
    assert.equal(ring.rx, 0, `${name} does not close on x`);
    assert.equal(ring.rz, 0, `${name} does not close on z`);
  };
  closes("the crown", BODY_RINGS[0]);
  closes("the pelvic cap", BODY_RINGS[BODY_RINGS.length - 1]);
  closes("the heel", FOOT_RINGS[FOOT_RINGS.length - 1]);
  closes("the skull vault", SKULL_RINGS[0]);
  closes("the maxilla", SKULL_RINGS[SKULL_RINGS.length - 1]);

  /**
   * The arm deliberately does not close: it ends at the wrist and the hand takes
   * over. So the requirement is that the hand is mounted where the arm stops —
   * an open end with nothing covering it is a hole straight into the forearm.
   */
  const wrist = ARM_RINGS[ARM_RINGS.length - 1];
  assert.ok(wrist.rx > 0, "the arm should end open at the wrist, not closed");
  assert.ok(
    Math.abs(HAND_MOUNT.y - wrist.y) < 0.02,
    `the hand is mounted at y=${HAND_MOUNT.y} but the wrist is at ${wrist.y}`,
  );
  assert.ok(
    Math.abs(HAND_MOUNT.x - (wrist.x ?? 0)) < 0.02,
    "the hand is not mounted in line with the wrist",
  );
  // The palm is open at the wrist for the same reason and closed nowhere else,
  // because each digit closes itself.
  assert.ok(HAND_PALM[0].rx > 0, "the palm should meet the wrist open");

  for (const [name, rings] of Object.entries({ BODY_RINGS, ARM_RINGS, LEG_RINGS, FOOT_RINGS })) {
    for (const ring of rings) {
      assert.ok(ring.rx >= 0 && ring.rz >= 0, `${name} has a negative radius`);
      assert.ok(
        Number.isFinite(ring.y) && Number.isFinite(ring.rx) && Number.isFinite(ring.rz),
        `${name} has a non-finite ring`,
      );
    }
  }
});

test("the lofted body is finite and faces outward", () => {
  const geometry = buildLoft(BODY_RINGS, 48);
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");

  for (let index = 0; index < positions.count; index += 1) {
    assert.ok(
      Number.isFinite(positions.getX(index))
        && Number.isFinite(positions.getY(index))
        && Number.isFinite(positions.getZ(index)),
      "the body loft produced a non-finite vertex",
    );
    assert.ok(
      Number.isFinite(normals.getX(index))
        && Number.isFinite(normals.getY(index))
        && Number.isFinite(normals.getZ(index)),
      "the body loft produced a non-finite normal, which shades as a black hole",
    );
  }

  // The vertex nearest the front of the chest must have a normal pointing out of
  // the chest. Reversed winding is invisible in a wireframe and renders as the
  // inside of the far wall seen through the body.
  let frontVertex = -1;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < positions.count; index += 1) {
    const distance = Math.abs(positions.getX(index))
      + Math.abs(positions.getY(index) - FIGURE.chest)
      + Math.abs(positions.getZ(index) - 0.345);
    if (distance < nearest) {
      nearest = distance;
      frontVertex = index;
    }
  }
  assert.ok(frontVertex >= 0);
  assert.ok(positions.getZ(frontVertex) > 0.3, "test vertex is not on the anterior chest");
  assert.ok(normals.getZ(frontVertex) > 0.85, "anterior normal points into the body");
  geometry.dispose();
});

test("the figure carries no face and no hair", () => {
  /**
   * The guard on the whole design.
   *
   * The avatar this replaced had eyes, eyelids, brows, a nose with nostrils,
   * lips, ears and a hair cap, each as its own landmark. A faceless clinical
   * figure has none of them, and the failure mode of "faceless" is that someone
   * reintroduces one feature at a time until it has a face again — so the
   * absence is asserted rather than assumed.
   */
  const forbidden = [
    "eye", "eyes", "eyelid", "brow", "nose", "nostril", "lips", "lip",
    "mouth", "ear", "ears", "hair", "hairCap", "hairline", "scalp", "iris",
    "pupil", "eyebrow", "eyelash", "beard",
  ];
  const present = Object.keys(AVATAR_LANDMARKS);
  for (const key of forbidden) {
    assert.ok(
      !present.includes(key),
      `AVATAR_LANDMARKS.${key} reintroduces a facial or hair feature`,
    );
  }

  // Nothing in the head may project forward of the cranial envelope either: a
  // nose or a brow ridge added as loose geometry would still read as a face.
  for (const ring of HEAD_RINGS) {
    assert.ok(
      ring.rz <= 0.32,
      `a head ring at y=${ring.y} projects ${ring.rz} — deeper than a smooth cranium`,
    );
  }
});

test("the head is a smooth cranial form described by contours", () => {
  const geometry = buildHeadContours();
  const positions = geometry.getAttribute("position");
  assert.ok(positions.count > 0, "the head has no contour lines to describe it");

  const chin = FIGURE.chin;
  const crown = FIGURE.crown;
  for (let index = 0; index < positions.count; index += 1) {
    const point: [number, number, number] = [
      positions.getX(index), positions.getY(index), positions.getZ(index),
    ];
    assert.ok(
      Number.isFinite(point[0]) && Number.isFinite(point[1]) && Number.isFinite(point[2]),
      "a contour vertex is non-finite",
    );

    // Contours belong to the head. One straying down the neck would read as a
    // collar rather than as cranial anatomy.
    assert.ok(
      point[1] <= crown + 1e-6 && point[1] >= chin - 0.11,
      `a contour line sits at y=${point[1].toFixed(3)}, off the head`,
    );

    // And they trace the surface: a contour floating off it is a halo, one
    // sunk into it disappears at the first oblique angle.
    if (point[1] > chin && point[1] < crown - 0.02) {
      const distance = surfaceDistance(HEAD_RINGS, point);
      assert.ok(
        distance > 0.99 && distance < 1.05,
        `a contour line sits at ${distance.toFixed(3)}× the head surface`,
      );
    }
  }
  geometry.dispose();
});

test("the inset shell stays inside the surface it is derived from", () => {
  for (const [name, rings] of Object.entries({ BODY_RINGS, ARM_RINGS, LEG_RINGS })) {
    const inner = insetRings(rings, 0.05);
    assert.equal(inner.length, rings.length, `${name}: inset must not change the sampling`);

    for (let index = 0; index < rings.length; index += 1) {
      assert.ok(
        inner[index].rx <= rings[index].rx + 1e-9,
        `${name}: the tissue shell is wider than the skin at ring ${index}`,
      );
      assert.ok(
        inner[index].rz <= rings[index].rz + 1e-9,
        `${name}: the tissue shell is deeper than the skin at ring ${index}`,
      );
      assert.ok(inner[index].rx >= 0 && inner[index].rz >= 0, `${name}: inset drove a radius negative`);
      assert.equal(inner[index].y, rings[index].y, `${name}: inset moved a ring`);
      // A ring that was closed has to stay closed, or the cap opens up.
      if (rings[index].rx === 0) assert.equal(inner[index].rx, 0, `${name}: inset opened a closed ring`);
    }
  }
});

test("mirroring a limb reflects it without reshaping it", () => {
  const left = mirrorRings(ARM_RINGS);
  assert.equal(left.length, ARM_RINGS.length);

  for (let index = 0; index < ARM_RINGS.length; index += 1) {
    assert.equal(left[index].x, -(ARM_RINGS[index].x ?? 0), "the mirrored arm is not reflected");
    assert.equal(left[index].rx, ARM_RINGS[index].rx, "mirroring changed a width");
    assert.equal(left[index].rz, ARM_RINGS[index].rz, "mirroring changed a depth");
    assert.equal(left[index].y, ARM_RINGS[index].y, "mirroring moved a ring");
  }

  // Mirroring by negating a group's scale would be shorter and would invert the
  // winding, so the reflected limb has to be its own geometry facing outward.
  const geometry = buildLoft(left, 32);
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  let outer = -1;
  let furthest = 0;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    if (-x > furthest) { furthest = -x; outer = index; }
  }
  assert.ok(outer >= 0);
  assert.ok(normals.getX(outer) < -0.8, "the mirrored arm renders inside-out");
  geometry.dispose();
});

test("the limbs meet the trunk instead of floating beside it", () => {
  // Each limb's first ring is meant to start inside the trunk, which is what
  // hides the joint. A limb that starts outside the skin leaves a visible ring
  // at the shoulder or the hip.
  for (const [name, rings] of Object.entries({ ARM_RINGS, LEG_RINGS })) {
    const first = rings[0];
    const trunk = ringAt(BODY_RINGS, first.y);
    assert.ok(trunk, `${name} starts at y=${first.y}, where there is no trunk to join`);

    // The limb's inner edge, not its centre: a deltoid's centre sits outside the
    // ribcage in any real body. What matters is that the two surfaces overlap,
    // because a limb that merely abuts the trunk shows daylight at the joint
    // from at least one angle.
    const innerEdge = Math.abs(first.x ?? 0) - first.rx;
    assert.ok(
      innerEdge < trunk!.rx,
      `${name} starts at x=${innerEdge.toFixed(3)} beside a trunk of ${trunk!.rx.toFixed(3)} — a gap at the joint`,
    );
  }

  /**
   * The A-pose, asserted as two facts rather than one tolerance.
   *
   * Above the axilla the arm has to overlap the trunk, because that overlap *is*
   * the armpit and a gap there is a hole in the figure. Below it the abducted arm
   * has to clear the trunk outright — that separation is the whole point of the
   * pose, and without it the arm merges into the flank and the torso loses its
   * outline. A single "penetrates by no more than X" tolerance, which is what
   * this test used while the arms hung vertically, cannot express either.
   */
  const AXILLA = 1.45;
  const CLEAR_BELOW = 1.1;

  for (const ring of ARM_RINGS) {
    const trunk = ringAt(BODY_RINGS, ring.y);
    if (!trunk) continue;
    const innerEdge = (ring.x ?? 0) - ring.rx;

    if (ring.y >= AXILLA) {
      assert.ok(
        innerEdge < trunk.rx,
        `an arm ring at y=${ring.y} leaves a gap at the armpit: `
          + `inner edge ${innerEdge.toFixed(3)} vs trunk ${trunk.rx.toFixed(3)}`,
      );
    } else if (ring.y <= CLEAR_BELOW && ring.y > FIGURE.crotch) {
      assert.ok(
        innerEdge > trunk.rx,
        `an abducted arm ring at y=${ring.y} still cuts into the trunk: `
          + `inner edge ${innerEdge.toFixed(3)} vs trunk ${trunk.rx.toFixed(3)}`,
      );
    }
  }
});

test("the feet stand the figure on the ground", () => {
  const geometry = buildLoft(FOOT_RINGS, 24);
  const points = vertices(geometry);
  const { min, max } = bounds(points);

  // The foot is authored along +Y and rotated forward by the renderer, so its
  // authored height becomes the foot's length and its depth becomes its height.
  const length = max[1] - min[1];
  assert.ok(length > 0.6 && length < 0.85, `a foot ${length.toFixed(2)} long is out of proportion`);

  const halfHeight = Math.max(...points.map((point) => Math.abs(point[2])));
  const sole = FOOT_MOUNT.y - halfHeight;
  assert.ok(
    Math.abs(sole - FIGURE.sole) < 0.02,
    `the sole lands at ${sole.toFixed(3)} but the figure stands at ${FIGURE.sole}`,
  );

  // The ankle end of the foot has to reach the bottom of the leg, or the figure
  // has a gap at each ankle.
  const ankle = LEG_RINGS[LEG_RINGS.length - 1];
  assert.ok(
    FOOT_MOUNT.y + halfHeight >= ankle.y - 1e-6,
    "the foot does not reach the bottom of the leg",
  );
  assert.equal(FOOT_MOUNT.x, ankle.x, "the foot is not mounted under its own leg");
  geometry.dispose();
});

test("the skull stays inside the head", () => {
  for (const ring of SKULL_RINGS) {
    if (ring.rx === 0) continue;
    const head = ringAt(HEAD_RINGS, ring.y);
    assert.ok(head, `no head surface at skull height ${ring.y}`);
    assert.ok(
      ring.rx < head!.rx,
      `bone breaks the skin sideways at ${ring.y}: ${ring.rx} vs ${head!.rx.toFixed(4)}`,
    );
    // Compared front-to-back including each ring's own centre, because the
    // cranium and the face are offset differently along z.
    const boneFront = (ring.z ?? 0) + ring.rz;
    const skinFront = (head!.z ?? 0) + head!.rz;
    assert.ok(
      boneFront < skinFront,
      `bone breaks the skin at the forehead at ${ring.y}: ${boneFront.toFixed(4)} vs ${skinFront.toFixed(4)}`,
    );
  }
});

test("the nested arch fits inside the head that contains it", () => {
  const arch = buildArchLayout();
  const { position, scale } = NESTED_ARCH;

  for (const tooth of arch) {
    const spec = TOOTH_CLASSES[tooth.toothClass];
    const [toothX, toothY, toothZ] = tooth.position;

    /**
     * The whole tooth, not just the gum line it is placed at.
     *
     * An upper tooth is rendered flipped, so its crown points down and its root
     * up; a lower one is the other way round. Checking only the placement height
     * missed the root tips of the back teeth entirely — and the jaw is narrowest
     * exactly where those roots end, which is why the earlier version of this
     * test passed while a molar root sat outside the mandible.
     */
    const span = tooth.upper
      ? [toothY - spec.crown, toothY + spec.root]
      : [toothY - spec.root, toothY + spec.crown];

    for (const localY of span) {
      const height = position[1] + localY * scale;
      const head = ringAt(HEAD_RINGS, height);
      assert.ok(head, `no head surface at arch height ${height.toFixed(3)}`);

      // Measured per axis. Using the radial reach for both, as an earlier
      // version did, charges a front incisor's depth against the width of the
      // jaw and rejects an arch that fits perfectly well.
      const outX = (Math.abs(toothX) + spec.width) * scale;
      const outZ = (Math.abs(toothZ) + spec.width) * scale + Math.abs(position[2]);
      assert.ok(
        outX < head!.rx,
        `arch tooth ${tooth.fdi} breaks the jaw sideways at ${height.toFixed(3)}: `
          + `${outX.toFixed(4)} vs ${head!.rx.toFixed(4)}`,
      );
      assert.ok(
        outZ < (head!.z ?? 0) + head!.rz,
        `arch tooth ${tooth.fdi} breaks the jaw front-to-back at ${height.toFixed(3)}: `
          + `${outZ.toFixed(4)} vs ${((head!.z ?? 0) + head!.rz).toFixed(4)}`,
      );
    }
  }

  // And it has to sit in the lower face rather than in the cranium.
  assert.ok(
    position[1] < FIGURE.brow && position[1] > FIGURE.chin,
    `the arch sits at ${position[1]}, outside the region between brow and chin`,
  );
});

test("every hotspot sits on the figure it annotates", () => {
  /**
   * Markers were first placed by eye against the camera, which put every dental
   * one up to 0.6 units in front of the teeth — reading as beads floating in
   * space rather than as labels on anatomy. Both models have known extents, so
   * the fit is checkable in every direction rather than only from the front.
   */
  const dental = findArea("dental");
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

  for (const area of AREAS.filter((candidate) => candidate.model === "figure")) {
    for (const region of area.regions) {
      const point = regionWorldPosition(region);
      assert.ok(
        point[1] <= FIGURE.crown && point[1] >= FIGURE.sole,
        `${area.id}/${region.id} sits at y=${point[1]}, off the figure entirely`,
      );

      const distance = surfaceDistance(BODY_RINGS, point);
      assert.ok(
        Number.isFinite(distance),
        `${area.id}/${region.id} has no body at its height`,
      );
      // A marker is a label standing slightly proud of the anatomy, not a pin
      // buried in it and not a bead hovering in front of it.
      assert.ok(
        distance >= 0.98 && distance <= 1.3,
        `${area.id}/${region.id} sits at ${distance.toFixed(3)}× the body surface`,
      );

      // Mirrored markers have to land on the far side of the same anatomy.
      if (region.mirrorX) {
        const mirrored: [number, number, number] = [-point[0], point[1], point[2]];
        const other = surfaceDistance(BODY_RINGS, mirrored);
        assert.ok(
          Math.abs(other - distance) < 1e-9,
          `${area.id}/${region.id} is not symmetric about the midline`,
        );
      }
    }
  }
});

test("breast annotations sit on the chest wall, below the clavicles", () => {
  const breast = findArea("breast");
  const markers = breast.regions.filter((region) =>
    ["position", "volume", "scar"].includes(region.id),
  );
  assert.ok(markers.length === 3, "the breast area lost one of its surface markers");

  const neck = regionWorldPosition(findArea("face").regions.find((region) => region.id === "neck")!);
  for (const marker of markers) {
    const point = regionWorldPosition(marker);
    assert.ok(
      point[1] < neck[1] - 0.3,
      `${marker.id} drifted up into the neck and clavicle zone`,
    );
    assert.ok(point[2] > 0.2, `${marker.id} is not on the anterior chest`);
  }

  // The chest landmarks the markers mount against are bilateral and level.
  const [left, right] = AVATAR_LANDMARKS.chest.centres;
  assert.equal(left[1], right[1], "the chest landmarks must share a height");
  assert.equal(left[0], -right[0], "the chest landmarks must be mirrored");
  assert.ok(left[1] < FIGURE.shoulder, "the chest sits below the shoulder girdle");
  assert.ok(left[1] > FIGURE.waist, "the chest sits above the waist");

  // And the torso continues below them, which is what stops the figure reading
  // as a bust on a plinth.
  assert.ok(
    AVATAR_LANDMARKS.navel[1] < left[1],
    "the torso must continue below the chest to the navel",
  );
  assert.ok(
    Math.abs(AVATAR_LANDMARKS.navel[1] - FIGURE.waist) < 0.1,
    "the navel should sit at the waist",
  );
});

test("the shoulders are as wide as a standing figure's should be", () => {
  const [left, right] = AVATAR_LANDMARKS.acromion.centres;
  assert.equal(left[1], right[1], "the shoulders must be level");
  assert.equal(left[0], -right[0], "the shoulders must be mirrored");
  assert.ok(
    Math.abs(left[1] - FIGURE.shoulder) < 1e-9,
    "the acromion landmark is not at the shoulder level",
  );

  /**
   * Deltoid to deltoid, measured within the shoulder band.
   *
   * Taking the widest arm ring outright was correct while the arms hung vertical
   * and wrong the moment they were abducted — the widest point moved to the
   * forearm, and the test started reporting a 2.2-head shoulder on a figure whose
   * shoulders had not changed. Measured off the rings that are actually deltoid,
   * so it still tracks rendered geometry rather than a landmark constant.
   */
  const deltoid = ARM_RINGS.filter((ring) => ring.y >= 1.6 && ring.y <= 1.84);
  assert.ok(deltoid.length >= 2, "no arm rings fall in the shoulder band");
  const widest = Math.max(...deltoid.map((ring) => (ring.x ?? 0) + ring.rx));
  const span = (widest * 2) / HEAD_HEIGHT;
  assert.ok(
    span > 1.6 && span < 2.1,
    `shoulders spanning ${span.toFixed(2)} heads are outside the neutral adult range`,
  );
});

test("the hands and feet are built and proportioned like hands and feet", () => {
  for (const mirror of [false, true]) {
    const hand = buildHand(mirror);
    const points = vertices(hand);
    const { min, max } = bounds(points);

    for (const [x, y, z] of points) {
      assert.ok(
        Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z),
        "the hand produced a non-finite vertex",
      );
    }

    // Wrist to fingertip. A 16.5cm hand is 0.57 units at this figure's scale.
    const length = max[1] - min[1];
    assert.ok(
      length > 0.5 && length < 0.64,
      `a hand ${length.toFixed(3)} long is out of proportion`,
    );
    // Thin front to back: the palm faces the viewer, which is anatomical position.
    const width = max[0] - min[0];
    const thickness = max[2] - min[2];
    assert.ok(
      thickness < width * 0.62,
      `the hand is ${thickness.toFixed(3)} thick against ${width.toFixed(3)} wide — not a palm`,
    );
    assert.ok(width > 0.2, "the hand has no span across the fingers");
    hand.dispose();
  }

  // Five toes, longest medial, and the whole set inside the foot's own width.
  const lengths = FOOT_TOES.map((toe) => toe.length);
  assert.equal(lengths.length, 5, "a foot needs five toes");
  for (let index = 1; index < lengths.length; index += 1) {
    assert.ok(
      lengths[index] < lengths[index - 1],
      `toe ${index} is not shorter than the one beside it`,
    );
  }
  const soleWidth = Math.max(...FOOT_RINGS.map((ring) => ring.rx));
  for (const toe of FOOT_TOES) {
    assert.ok(
      Math.abs(toe.x) + toe.radius <= soleWidth + 1e-9,
      `a toe at x=${toe.x} overhangs the sole`,
    );
    // Rooted inside the foot, so there is no joint ring at the ball.
    assert.ok(
      toe.top - toe.length < FOOT_RINGS[0].y,
      "a toe does not reach back into the foot it grows from",
    );
  }

  const foot = buildFoot();
  assert.ok(vertices(foot).length > 0, "the foot produced no vertices");
  foot.dispose();
});

test("the breast is sculpted into the chest, not attached to it", () => {
  /**
   * The assertion the whole sculpt architecture exists to satisfy.
   *
   * The breast used to be an ellipsoid mesh intersecting the torso, and two closed
   * surfaces meeting always leave an intersection curve — the "sphere stuck on the
   * chest" that no shading hides. A displacement cannot leave one, because it
   * moves vertices the chest already had. So this measures the displacement field
   * on the finished mesh and requires three things of it: that a breast is
   * genuinely there, that its projection is anatomically restrained, and — the
   * part that matters — that it is everywhere continuous. A separate object would
   * show as a step between neighbouring vertices; a sculpt cannot.
   */
  const SEGMENTS = 96;
  const rings = resampleRings(BODY_RINGS, 0.013, 0.028);
  const base = buildLoft(rings, SEGMENTS);
  const sculpted = applySculpt(buildLoft(rings, SEGMENTS), BODY_SCULPT);

  const basePoints = vertices(base);
  const sculptedPoints = vertices(sculpted);
  assert.equal(
    basePoints.length, sculptedPoints.length,
    "sculpting must not change the vertex count — it displaces, it does not add",
  );

  const displacement = basePoints.map((point, index) => Math.hypot(
    sculptedPoints[index][0] - point[0],
    sculptedPoints[index][1] - point[1],
    sculptedPoints[index][2] - point[2],
  ));

  // A breast exists, on both sides, and projects a plausible amount.
  const [left, right] = AVATAR_LANDMARKS.chest.centres;
  assert.equal(left[1], right[1], "the chest landmarks must be level");
  for (const centre of [left, right]) {
    let peak = 0;
    for (let index = 0; index < basePoints.length; index += 1) {
      const [x, y, z] = basePoints[index];
      if (z <= 0) continue;
      if (Math.hypot(x - centre[0], y - centre[1]) > 0.12) continue;
      peak = Math.max(peak, displacement[index]);
    }
    assert.ok(
      peak > 0.05 && peak < 0.14,
      `the breast at x=${centre[0]} rises ${peak.toFixed(3)} — outside the restrained range`,
    );
  }

  // Nothing anywhere on the body moves further than a restrained sculpt should.
  const loudest = Math.max(...displacement);
  assert.ok(loudest < 0.15, `a sculpt feature displaces ${loudest.toFixed(3)} — exaggerated`);

  /**
   * Continuity, established by refinement rather than by a fixed tolerance.
   *
   * The first version of this check capped how much the displacement could change
   * between neighbouring vertices, and a nose ridge failed it — correctly, because
   * a nose ridge really is steep. Steep is not the same as discontinuous, and only
   * one of the two is a defect.
   *
   * What actually separates them is how the step behaves as the mesh refines. On a
   * continuous surface the step between neighbours is the gradient times the
   * spacing, so halving the spacing halves the step. Across a join the step is the
   * size of the join and refining changes nothing. Measuring at two densities
   * therefore distinguishes a sculpted ridge from an attached object, which is the
   * exact property this model is required to have.
   */
  const maximumRingStep = (segments: number) => {
    const coarse = buildLoft(rings, segments);
    const fine = applySculpt(buildLoft(rings, segments), BODY_SCULPT);
    const from = vertices(coarse);
    const to = vertices(fine);
    let worst = 0;
    for (let ring = 0; ring < rings.length; ring += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const here = ring * segments + segment;
        const across = ring * segments + ((segment + 1) % segments);
        const push = (index: number) => Math.hypot(
          to[index][0] - from[index][0],
          to[index][1] - from[index][1],
          to[index][2] - from[index][2],
        );
        worst = Math.max(worst, Math.abs(push(here) - push(across)));
      }
    }
    coarse.dispose();
    fine.dispose();
    return worst;
  };

  const atCoarse = maximumRingStep(96);
  const atFine = maximumRingStep(192);
  assert.ok(atCoarse > 0, "the sculpt displaced nothing at all");
  assert.ok(
    atFine < atCoarse * 0.62,
    `doubling the mesh density only reduced the worst step from ${atCoarse.toFixed(4)} to `
      + `${atFine.toFixed(4)} — the surface is joined, not sculpted`,
  );

  base.dispose();
  sculpted.dispose();
});

test("the face is sculpted but carries no identity", () => {
  /**
   * Every facial form is shallow by design. The brief is a premium medical
   * mannequin: enough relief that the head reads as a head, nowhere near enough
   * to be a likeness. The nose is the deepest thing on it and even that is a
   * centimetre at this figure's scale.
   */
  const deepest = Math.max(...FACE_SCULPT.map((feature) => Math.abs(feature.amount)));
  assert.ok(
    deepest <= 0.04,
    `a facial feature displaces ${deepest.toFixed(3)} — deep enough to read as a likeness`,
  );

  // Paired features are mirrored rather than authored twice, so the face cannot
  // drift asymmetric — asymmetry is one of the strongest identity cues there is.
  for (const feature of FACE_SCULPT) {
    if (Math.abs(feature.at[0]) > 1e-9) {
      assert.ok(
        feature.mirror,
        `an off-midline facial feature at x=${feature.at[0]} is not mirrored`,
      );
    }
    // And everything stays on the head.
    assert.ok(
      feature.at[1] > FIGURE.chin - 0.35 && feature.at[1] <= FIGURE.crown,
      `a facial feature at y=${feature.at[1]} is not on the head`,
    );
  }

  // The nose is the most prominent form, and the mouth is a fraction of it.
  const amounts = new Map(FACE_SCULPT.map((feature) => [
    `${feature.at[0]},${feature.at[1]}`, feature.amount,
  ]));
  const noseTip = amounts.get("0,2.428");
  const upperLip = amounts.get("0,2.345");
  assert.ok(noseTip && upperLip, "the nose tip and upper lip features are missing");
  assert.ok(
    noseTip! > upperLip! * 2,
    "the mouth should be a fraction of the nose's relief, not a rival to it",
  );
});
