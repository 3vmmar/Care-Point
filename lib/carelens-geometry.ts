/**
 * CareLens geometry — every vertex the explorer draws, generated here.
 *
 * Split out of `TreatmentCanvas` so it can be tested. There is no asset
 * pipeline in this project: no glTF, no Draco decoder, and a CSP that forbids
 * fetching one. So the model is arithmetic, and arithmetic can be checked —
 * which matters more than usual here, because a defect in a lathe profile shows
 * up as bone poking through a cheek at one camera angle and nowhere else.
 *
 * Nothing in this module imports React. It depends only on three.js for its
 * vector and buffer types, so `node --test` can import it directly.
 */

import * as THREE from "three";

/* ══ Teeth ═════════════════════════════════════════════════════════════════ */

export type ToothClass = "incisor" | "canine" | "premolar" | "molar";

/**
 * The four classes, as the parameters that actually distinguish them.
 *
 * `cusps` drives the biting surface: zero gives an incisor's straight edge, one
 * a canine's single point, two a premolar, four a molar. `flat` squashes the
 * cross-section front-to-back — an incisor is a blade, a molar is a block, and
 * that one number is most of what separates them in silhouette.
 */
export const TOOTH_CLASSES: Record<ToothClass, {
  width: number;
  flat: number;
  crown: number;
  root: number;
  cusps: number;
  cuspDepth: number;
}> = {
  // Proportions are scaled from average adult dimensions at 0.0104 units per
  // millimetre. The first pass invented them, and crowns came out at roughly
  // twice their real height-to-width ratio — rendered, the arch read as a bear
  // trap rather than a mouth. Real teeth are much squatter than they feel.
  incisor:  { width: 0.088, flat: 0.52, crown: 0.109, root: 0.135, cusps: 0, cuspDepth: 0.0 },
  canine:   { width: 0.078, flat: 0.70, crown: 0.104, root: 0.176, cusps: 1, cuspDepth: 0.030 },
  premolar: { width: 0.072, flat: 0.88, crown: 0.088, root: 0.145, cusps: 2, cuspDepth: 0.020 },
  molar:    { width: 0.109, flat: 0.94, crown: 0.078, root: 0.135, cusps: 4, cuspDepth: 0.018 },
};

/** Seven positions per quadrant, midline outwards. Third molars are omitted. */
export const QUADRANT: ToothClass[] = [
  "incisor", "incisor", "canine", "premolar", "premolar", "molar", "molar",
];

export const TOOTH_RINGS = 26;
export const TOOTH_SEGMENTS = 24;

/**
 * One tooth, swept rather than assembled.
 *
 * A tooth is a single surface from root tip to biting edge, so building it from
 * primitives would put a seam at the gum line — exactly where the eye goes.
 * Instead a cross-section is swept along a vertical profile: `shape` gives the
 * root taper, the neck pinch and the crown bulge, and the cross-section is a
 * superellipse so a molar reads as a rounded block rather than a cylinder.
 */
export function buildTooth(spec: ToothClass): THREE.BufferGeometry {
  const { width, flat, crown, root, cusps, cuspDepth } = TOOTH_CLASSES[spec];

  const positions: number[] = [];
  const indices: number[] = [];

  /** Vertical profile. v = 0 at the root tip, v = 1 at the biting surface. */
  const shape = (v: number) => {
    if (v < 0.46) {
      // Root: tapers from a rounded tip up to the neck. The fractional exponent
      // blunts the tip — a needle root reads as a spike, not as anatomy.
      const t = v / 0.46;
      return { r: 0.34 + 0.62 * Math.pow(t, 0.62), y: -root + root * t };
    }
    // Crown: pinches at the neck, bulges at the widest point, eases back in.
    const t = (v - 0.46) / 0.54;
    const bulge = Math.sin(Math.min(1, t * 1.18) * Math.PI * 0.82);
    return { r: 0.9 + 0.24 * bulge - 0.16 * t * t, y: crown * t };
  };

  for (let ring = 0; ring <= TOOTH_RINGS; ring += 1) {
    const v = ring / TOOTH_RINGS;
    const { r, y } = shape(v);

    for (let segment = 0; segment <= TOOTH_SEGMENTS; segment += 1) {
      const theta = (segment / TOOTH_SEGMENTS) * Math.PI * 2;

      const power = 0.72;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const sx = Math.sign(cos) * Math.pow(Math.abs(cos), power);
      const sz = Math.sign(sin) * Math.pow(Math.abs(sin), power);

      // Cusps shape only the top of the crown, and fade in over the last third
      // so the bumps grow out of the surface instead of sitting on it.
      let lift = 0;
      if (cusps > 0 && v > 0.7) {
        const blend = (v - 0.7) / 0.3;
        lift = cuspDepth * blend * blend * (0.5 + 0.5 * Math.cos(theta * cusps));
      } else if (cusps === 0 && v > 0.94) {
        // An incisal edge, not a dome: flatten the crown's last rings.
        lift = -(v - 0.94) * crown * 0.5;
      }

      positions.push(sx * r * width, y + lift, sz * r * width * flat);
    }
  }

  for (let ring = 0; ring < TOOTH_RINGS; ring += 1) {
    for (let segment = 0; segment < TOOTH_SEGMENTS; segment += 1) {
      const a = ring * (TOOTH_SEGMENTS + 1) + segment;
      const b = a + TOOTH_SEGMENTS + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export type ToothPlacement = {
  key: string;
  /** FDI notation — the numbering a dentist actually writes down. */
  fdi: number;
  toothClass: ToothClass;
  position: [number, number, number];
  rotation: [number, number, number];
  upper: boolean;
};

export const ARCH = {
  // `y` is the gum line, not the biting edge. Set so the crowns almost meet:
  // a closed bite hides the lower arch, and a wide one reads as a denture.
  upper: { radiusX: 0.72, radiusZ: 0.86, y: 0.13 },
  lower: { radiusX: 0.66, radiusZ: 0.80, y: -0.13 },
};

/**
 * Gum and bone, as flattened tubes rather than round ones.
 *
 * A tube's radius applies equally in every direction, so one thick enough to
 * bury a root was also thick enough to swallow the arch front-to-back — the
 * first version rendered as a pink ring passing through the middle of the
 * teeth, with the roots standing proud above it. Scaling the mesh vertically
 * gives a ridge that is thin in plan and tall in section, which is what gum
 * over a root actually looks like.
 *
 * Bone sits radially *inside* the gum so the gum covers it, and is revealed by
 * the gum fading at the skeleton depth rather than by being drawn on top.
 */
/**
 * The ridge the teeth sit in.
 *
 * `radius` is the thickness in plan and has to exceed how deep a tooth is — a
 * molar is about 0.10 front to back, so half of it is 0.051. Below that the
 * tube is narrower than the teeth it should be burying, and because a tube's
 * section is round, its height falls away toward the edges: at 0.055 the root
 * tips escaped through the top of the gum as small white nubs.
 *
 * Height then comes from scaling the mesh vertically rather than from a larger
 * radius, which is what keeps the ridge from reading as a sausage. It has to
 * clear the longest root in the arch — the canine, at 0.176 — from the gum
 * line, or that one tooth in each quadrant breaks the surface.
 */
export const GUM = {
  upper: { radius: 0.072, yScale: 1.55, y: 0.215 },
  lower: { radius: 0.070, yScale: 1.55, y: -0.215 },
};

/** Inside the gum radially, so the gum covers it until the gum fades. */
export const BONE = {
  upper: { radius: 0.058, yScale: 2.2, y: 0.25 },
  lower: { radius: 0.056, yScale: 2.2, y: -0.25 },
};

/**
 * Both arches, laid out on an ellipse.
 *
 * Teeth are stepped by their own width rather than by a fixed angle, so the
 * incisors sit close together and the molars do not overlap. An evenly spaced
 * arch is the single clearest sign of a model nobody measured.
 */
export function buildArchLayout(): ToothPlacement[] {
  const placements: ToothPlacement[] = [];

  for (const upper of [true, false]) {
    // The lower arch is narrower and sits inside the upper one, which is what
    // makes the two read as a bite rather than as two copies of one ring.
    const { radiusX, radiusZ, y } = upper ? ARCH.upper : ARCH.lower;

    for (const side of [-1, 1]) {
      let angle = 0;

      QUADRANT.forEach((toothClass, index) => {
        const { width } = TOOTH_CLASSES[toothClass];
        const previous = index === 0 ? 0 : TOOTH_CLASSES[QUADRANT[index - 1]].width;

        /**
         * Step by arc length, not by angle.
         *
         * The arch is an ellipse, and dividing a width by `radiusX` alone
         * assumes it is a circle. Toward the back, where the local radius is
         * closer to `radiusZ`, that overestimated the angle each tooth needed
         * and opened visible gaps between the molars — while the incisors sat
         * correctly, which is what made it hard to spot.
         */
        const localRadius = Math.hypot(
          radiusX * Math.cos(angle),
          radiusZ * Math.sin(angle),
        );
        angle += ((width + previous) * 0.55) / localRadius;

        const theta = angle * side;

        placements.push({
          key: `${upper ? "U" : "L"}${side < 0 ? "L" : "R"}${index}`,
          // FDI quadrants: 1 upper-right, 2 upper-left, 3 lower-left, 4 lower-right.
          fdi: (upper ? (side > 0 ? 10 : 20) : (side > 0 ? 40 : 30)) + index + 1,
          toothClass,
          position: [Math.sin(theta) * radiusX, y, Math.cos(theta) * radiusZ],
          // Crowns face the bite plane, so the upper arch is flipped. The Y
          // rotation turns each tooth outward along the arch normal.
          rotation: [upper ? Math.PI : 0, theta, 0],
          upper,
        });
      });
    }
  }

  return placements;
}

/**
 * The gum ridge, and the bone behind it.
 *
 * A tube swept along the arch reads as gum; a larger one further back reads as
 * the bone the roots sit in. One open curve, so there is no join at the midline.
 */
/**
 * How far round the ridge sweeps, in radians either side of the midline.
 *
 * The last molar sits at about 1.0 rad. An earlier value of 1.95 ran the ridge
 * most of a half-turn further, and the overshoot rendered as two pink horns
 * curling up behind the molars where no jaw exists. Just past the last tooth is
 * the whole requirement.
 */
export const ARCH_SWEEP = 1.16;

export function buildRidge(radiusX: number, radiusZ: number, thickness: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: 48 }, (_, index) => {
      const theta = (index / 47 - 0.5) * 2 * ARCH_SWEEP;
      return new THREE.Vector3(Math.sin(theta) * radiusX, 0, Math.cos(theta) * radiusZ);
    }),
    false,
    "catmullrom",
    0.4,
  );
  return new THREE.TubeGeometry(curve, 64, thickness, 14, false);
}

/**
 * Front-to-back squash applied to every shell of the bust.
 *
 * A perfectly round bust reads as a chess piece; a shallower one reads as a
 * body without needing any actual anatomy. It lives here rather than in the
 * component because anything nested inside the head has to take the same
 * squash — a round object inside a flattened one pushes through the front.
 */
export const BUST_FLATTEN = { x: 1, y: 1, z: 0.74 };

/* ══ Bust ══════════════════════════════════════════════════════════════════ */

export const CROWN_TOP = 1.62;
export const HEAD_CENTRE = 1.06;
export const HEAD_WIDTH = 0.5;

/**
 * The bust silhouette, generated rather than hand-listed.
 *
 * Describing the form as continuous curves and sampling them makes every join
 * tangent-continuous by construction, so the lathe has no corner to catch a
 * highlight on. An earlier hand-listed version pinched at the crown and belled
 * at the shoulders, both because a straight line met a curve.
 *
 * `inset` shrinks the profile toward its own axis, which is how the structure
 * shell is produced from the same curve rather than from a second one. The
 * layers cannot drift apart if there is only one profile.
 */
export function buildProfile(inset = 0): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];

  // Cranium: a superellipse, not a sphere. n = 2.35 keeps the sides fuller than
  // a circle before they turn, which is what separates a cranium from an egg.
  const HEAD_HEIGHT = CROWN_TOP - HEAD_CENTRE;
  const N = 2.35;

  const CRANIUM_STEPS = 26;
  for (let step = 0; step <= CRANIUM_STEPS; step += 1) {
    const t = (step / CRANIUM_STEPS) * (Math.PI / 2);
    points.push(new THREE.Vector2(
      HEAD_WIDTH * Math.pow(Math.sin(t), 2 / N),
      HEAD_CENTRE + HEAD_HEIGHT * Math.pow(Math.cos(t), 2 / N),
    ));
  }

  const bezier = (
    p0: [number, number], p1: [number, number],
    p2: [number, number], p3: [number, number], steps: number,
  ) => {
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const u = 1 - t;
      points.push(new THREE.Vector2(
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ));
    }
  };

  // Temple → jaw → under-chin → neck. A gentle taper; a sharp one reads as a
  // chess bishop.
  bezier([HEAD_WIDTH, HEAD_CENTRE], [0.5, 0.84], [0.36, 0.66], [0.215, 0.5], 22);
  // Neck: near-parallel, with the faintest swell.
  bezier([0.215, 0.5], [0.2, 0.38], [0.198, 0.24], [0.212, 0.1], 12);
  // Shoulders: leaves the neck almost vertically and turns late — a trapezius,
  // rather than the skirt of a vase.
  bezier([0.212, 0.1], [0.28, -0.14], [0.62, -0.26], [0.86, -0.4], 18);
  bezier([0.86, -0.4], [1.0, -0.47], [1.08, -0.56], [1.11, -0.7], 12);
  // Close the base. A lathe is an open surface; without this the camera sees
  // into the hollow underside and reads it as a modelling error.
  bezier([1.11, -0.7], [1.06, -0.79], [0.7, -0.84], [0.0, -0.85], 10);

  if (inset === 0) return points;

  // Shrink toward the axis. A point already at radius zero cannot shrink, which
  // is exactly the behaviour wanted at the poles — the base stays closed.
  return points.map((point) => new THREE.Vector2(
    Math.max(0, point.x - inset),
    point.y - inset * 0.35,
  ));
}

export const CRANIUM_TOP = 1.545;
export const CRANIUM_BASE = 0.82;

/**
 * A skull, at the depth where bone would be.
 *
 * It stops where the maxilla begins rather than running down to the chin, so
 * the dental arch nested inside it at the skeleton layer is not buried in bone.
 */
export function buildCraniumProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const WIDTH = 0.435;

  for (let step = 0; step <= 22; step += 1) {
    const t = (step / 22) * (Math.PI / 2);
    points.push(new THREE.Vector2(
      WIDTH * Math.pow(Math.sin(t), 2 / 2.3),
      HEAD_CENTRE + (CRANIUM_TOP - HEAD_CENTRE) * Math.pow(Math.cos(t), 2 / 2.3),
    ));
  }

  // Down past the cheekbone and in under the arch.
  for (let step = 1; step <= 14; step += 1) {
    const t = step / 14;
    const u = 1 - t;
    points.push(new THREE.Vector2(
      u * u * u * WIDTH + 3 * u * u * t * 0.42 + 3 * u * t * t * 0.3 + t * t * t * 0.0,
      u * u * u * HEAD_CENTRE + 3 * u * u * t * 0.9 + 3 * u * t * t * 0.83 + t * t * t * CRANIUM_BASE,
    ));
  }

  return points;
}

export function buildCranium(): THREE.BufferGeometry {
  const lathe = new THREE.LatheGeometry(buildCraniumProfile(), 72);
  lathe.computeVertexNormals();
  return lathe;
}

/** Where the nested arch sits inside the skull, and how far it is scaled down. */
export const NESTED_ARCH = { position: [0, 0.87, 0.02] as const, scale: 0.46 };
