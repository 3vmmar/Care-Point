/**
 * CareLens geometry — every vertex the explorer draws, generated here.
 *
 * Split out of `TreatmentCanvas` so it can be tested. There is no asset
 * pipeline in this project: no glTF, no Draco decoder, and a CSP that forbids
 * fetching one. So the model is arithmetic, and arithmetic can be checked —
 * which matters more than usual here, because a defect in a cross-section shows
 * up as bone poking through a shoulder at one camera angle and nowhere else.
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

/* ══ Figure ════════════════════════════════════════════════════════════════ */

/**
 * The whole-body avatar, as a stack of measured cross-sections.
 *
 * ## Why cross-sections rather than primitives
 *
 * The previous avatar was a lathe: one profile revolved around the vertical
 * axis, with eyes, a nose, lips and a hair cap glued on as separate ellipsoids.
 * A revolved surface cannot be a body — it has no shoulders, no limbs, and the
 * same width front-to-back as side-to-side — and the glued features detached
 * from the envelope at any oblique angle, which is what made the old model read
 * as a doll rather than as clinical anatomy.
 *
 * A loft solves both. Each ring carries its own half-width (`rx`) and
 * half-depth (`rz`), so a chest can be broad and shallow while a thigh is
 * round; each ring also carries its own centre (`x`, `z`), which is what lets a
 * limb travel away from the axis. The surface between rings is generated, so
 * every transition is continuous by construction and there is no seam for a
 * highlight to catch on.
 *
 * ## The figure is deliberately faceless
 *
 * There are no eyes, nose, mouth, ears or hair anywhere in this module, and
 * that is a clinical decision rather than a shortcut. A synthetic face that
 * approaches realism without arriving unsettles people, and a prospective
 * patient is the last audience that should feel unsettled. It is also a privacy
 * decision: a faceless figure cannot resemble one patient more than another, so
 * every viewer sees a body that could be theirs. The head is therefore a smooth
 * cranial form, and the only thing that describes it is a set of contour lines
 * — the same convention a surgical atlas uses.
 *
 * ## Proportions
 *
 * A canonical 7.5-head standing figure, six units tall, with the origin at the
 * pubic level so the model is centred on its own mid-height. Every landmark
 * below is measured in head-heights from the crown, which is how figure
 * proportion is actually specified — inventing numbers per body part is what
 * produces a torso that does not match its own legs.
 */
export const HEAD_HEIGHT = 0.8;

export const FIGURE = {
  crown: 3.0,
  /** Widest point of the cranium, at the parietal. */
  cranium: 2.745,
  brow: 2.66,
  chin: 2.2,
  /** Acromion — the outer end of the shoulder girdle. */
  shoulder: 1.78,
  chest: 1.4,
  waist: 0.96,
  hip: 0.5,
  /** Mid-height of the figure, and the origin of model space. */
  crotch: 0,
  knee: -1.08,
  ankle: -2.72,
  sole: -3.0,
} as const;

/**
 * Segments around each ring.
 *
 * 128 rather than 96: at a head-filling zoom the silhouette of a 96-segment
 * cranium shows faceting along its edge, and a faceted edge is the single
 * clearest tell of a low-poly model. The cost is linear in a vertex count that
 * is already trivial for a GPU.
 */
export const FIGURE_SEGMENTS = 128;

/**
 * One measured cross-section.
 *
 * `n` is the superellipse exponent: 2 is an ellipse, higher values square the
 * section off. A ribcage is closer to 2.4 than to a true ellipse, and using one
 * number for that beats modelling the difference with extra geometry.
 */
export type Ring = {
  y: number;
  rx: number;
  rz: number;
  /** Lateral centre, so a limb can leave the midline. */
  x?: number;
  /** Anterior/posterior centre, for the occiput and the lumbar curve. */
  z?: number;
  n?: number;
};

/**
 * Head, neck and trunk as one unbroken surface, crown to pubis.
 *
 * Authored top-down: `buildLoft` derives triangle winding from ring order, so
 * every ring list in this module descends. The head section carries a small
 * negative `z` at the cranium and a small positive one through the jaw, which
 * is the difference between a smooth skull and an egg.
 */
export const HEAD_RINGS: Ring[] = [
  // Vault: parietal at the widest, occiput carried back on a negative centre.
  { y: 3.000, rx: 0.000, rz: 0.000, z: -0.010 },
  { y: 2.980, rx: 0.100, rz: 0.110, z: -0.012 },
  { y: 2.945, rx: 0.168, rz: 0.186, z: -0.014 },
  { y: 2.900, rx: 0.216, rz: 0.240, z: -0.016 },
  { y: 2.850, rx: 0.248, rz: 0.276, z: -0.018 },
  { y: 2.800, rx: 0.256, rz: 0.290, z: -0.020 },
  { y: 2.745, rx: 0.268, rz: 0.304, z: -0.020 },
  { y: 2.700, rx: 0.270, rz: 0.310, z: -0.018 },
  // Brow ridge: the centre swings forward, which is what turns an ovoid into a
  // face-bearing skull without adding a single feature to it.
  { y: 2.660, rx: 0.268, rz: 0.314, z: -0.012 },
  { y: 2.620, rx: 0.262, rz: 0.312, z: -0.004 },
  { y: 2.570, rx: 0.252, rz: 0.304, z: 0.004 },
  // Zygomatic arch.
  { y: 2.520, rx: 0.244, rz: 0.294, z: 0.012 },
  { y: 2.470, rx: 0.236, rz: 0.282, z: 0.020 },
  { y: 2.420, rx: 0.222, rz: 0.268, z: 0.026 },
  { y: 2.370, rx: 0.206, rz: 0.252, z: 0.030 },
  /**
   * Mandible, with the gonial angle as its widest point and the chin carried
   * forward on a positive centre.
   *
   * The narrowing below the gonion is slight on purpose. A ring is the union
   * silhouette at its height, and below the cheekbone that union contains the
   * neck as well as the jaw — the mandible's lower border overhangs the neck,
   * which no single-axis loft can express. An earlier version pinched to a true
   * waist here and produced a head on a stalk, so the jaw line is carried by
   * the change of slope and by the contour lines instead.
   */
  { y: 2.320, rx: 0.200, rz: 0.240, z: 0.032 },
  { y: 2.285, rx: 0.196, rz: 0.226, z: 0.034 },
  { y: 2.250, rx: 0.187, rz: 0.210, z: 0.035 },
  { y: 2.220, rx: 0.171, rz: 0.192, z: 0.034 },
  // The jaw line. Holding the mandible wide to 2.22 and then dropping 0.02 over
  // 0.04 of height puts a crease where the lower border overhangs the neck. A
  // gentler taper over the same span — which is what the previous pass had — runs
  // the jaw straight into the neck and the two read as one long oval.
  { y: 2.206, rx: 0.164, rz: 0.182, z: 0.032 },
  { y: 2.192, rx: 0.156, rz: 0.172, z: 0.030 },
  { y: 2.178, rx: 0.152, rz: 0.165, z: 0.024 },
];

/**
 * Neck, and the trapezius slope that carries it into the shoulders.
 *
 * Sized from a 37cm neck circumference at the figure's scale, where one unit is
 * 29cm. The first pass guessed roughly half that and the result read as a stem.
 */
export const NECK_RINGS: Ring[] = [
  { y: 2.150, rx: 0.164, rz: 0.176, z: 0.014 },
  { y: 2.080, rx: 0.174, rz: 0.186, z: 0.004 },
  { y: 2.010, rx: 0.182, rz: 0.194, z: -0.002 },
  { y: 1.945, rx: 0.190, rz: 0.202, z: -0.006 },
  { y: 1.900, rx: 0.202, rz: 0.210, z: -0.008 },
  // The suprasternal notch. Drawing the ring's centre back as the neck meets
  // the girdle leaves the hollow between the clavicles that every real chest
  // has, and its absence was most of why the neck read as a fitting rather than
  // as anatomy.
  { y: 1.868, rx: 0.216, rz: 0.212, z: -0.018 },
];

/**
 * Trunk, shoulder girdle to pubis.
 *
 * The deltoid mass belongs to the arm rather than to this list: a trunk ring
 * wide enough to include it would put a horizontal shelf where a trapezius
 * should slope. `n` rises through the ribcage because a chest section is
 * squarer than an ellipse, and falls again at the waist.
 */
export const TRUNK_RINGS: Ring[] = [
  // The trapezius slope, spread over four rings. Compressed into one it renders
  // as a horizontal shelf, and the neck above it reads as the stem of a bulb.
  // Clavicle shelf: the girdle spreads fast and stays shallow, so the plane
  // between the collarbones reads flat rather than barrel-round.
  { y: 1.836, rx: 0.268, rz: 0.212, z: -0.016, n: 2.1 },
  { y: 1.800, rx: 0.320, rz: 0.226, z: -0.010, n: 2.2 },
  { y: 1.762, rx: 0.366, rz: 0.244, z: -0.004, n: 2.3 },
  { y: 1.722, rx: 0.404, rz: 0.264, n: 2.35 },
  { y: 1.676, rx: 0.438, rz: 0.286, n: 2.4 },
  { y: 1.620, rx: 0.462, rz: 0.306, n: 2.4 },
  { y: 1.560, rx: 0.478, rz: 0.322, n: 2.38 },
  { y: 1.480, rx: 0.488, rz: 0.336, n: 2.34 },
  { y: 1.400, rx: 0.490, rz: 0.344, n: 2.3 },
  { y: 1.320, rx: 0.484, rz: 0.344, n: 2.28 },
  // Costal margin: the ribcage releases and the waist draws in. Sampling this
  // transition every 0.07 rather than every 0.14 is what turns a straight
  // cone into the curve under a rib.
  { y: 1.250, rx: 0.470, rz: 0.336, n: 2.24 },
  { y: 1.180, rx: 0.450, rz: 0.320, n: 2.2 },
  { y: 1.110, rx: 0.432, rz: 0.304, z: -0.004, n: 2.14 },
  { y: 1.040, rx: 0.418, rz: 0.292, z: -0.008, n: 2.1 },
  // Waist, then out to the iliac crest. The pelvis was the worst proportion in
  // the first pass: narrower than the two thighs hanging off it, which read as a
  // wide-shouldered figure balanced on a stalk.
  { y: 0.960, rx: 0.410, rz: 0.284, z: -0.010, n: 2.08 },
  { y: 0.880, rx: 0.414, rz: 0.282, z: -0.008, n: 2.08 },
  { y: 0.800, rx: 0.436, rz: 0.286, z: -0.004, n: 2.1 },
  { y: 0.720, rx: 0.464, rz: 0.294, n: 2.14 },
  { y: 0.640, rx: 0.496, rz: 0.302, n: 2.18 },
  { y: 0.560, rx: 0.528, rz: 0.312, n: 2.2 },
  { y: 0.480, rx: 0.550, rz: 0.320, n: 2.22 },
  { y: 0.400, rx: 0.558, rz: 0.326, n: 2.22 },
  { y: 0.320, rx: 0.552, rz: 0.328, n: 2.2 },
  { y: 0.240, rx: 0.534, rz: 0.324, n: 2.16 },
  { y: 0.160, rx: 0.504, rz: 0.316, n: 2.12 },
  { y: 0.080, rx: 0.470, rz: 0.306, n: 2.08 },
  { y: 0.010, rx: 0.432, rz: 0.294 },
  { y: -0.050, rx: 0.372, rz: 0.268 },
  { y: -0.100, rx: 0.284, rz: 0.220 },
  { y: -0.140, rx: 0.160, rz: 0.136 },
  { y: -0.168, rx: 0.000, rz: 0.000 },
];

/** Crown to pubis in one list, so the surface has no join to hide. */
export const BODY_RINGS: Ring[] = [...HEAD_RINGS, ...NECK_RINGS, ...TRUNK_RINGS];

/**
 * Right arm, from the deltoid to the fingertips.
 *
 * A neutral standing pose: hanging, very slightly abducted, with the hand
 * flattened in the sagittal plane so the palm faces the thigh. The first rings
 * sit inside the trunk on purpose — a limb that starts at the skin leaves a
 * visible ring at the joint, and one that starts inside it does not.
 */
/**
 * Right arm, deltoid to wrist, in the anatomical A-pose.
 *
 * Abducted about 16° from vertical rather than hanging flat against the ribs.
 * Three reasons, in order of importance: it is the anatomical reference pose, so
 * it is the one a clinician reads without translating; it separates the arm from
 * the torso in silhouette, where a vertical arm merges into the flank and the
 * whole figure loses its outline; and it exposes the hand, which cannot be a
 * selectable region while it is tucked against a thigh.
 *
 * The root ring is still small and close in, so it stays buried in the trapezius
 * slope — an arm that begins at full deltoid width leaves a notch over the
 * shoulder, because the trunk is still neck at that height.
 */
export const ARM_RINGS: Ring[] = [
  { y: 1.820, rx: 0.106, rz: 0.128, x: 0.290 },
  { y: 1.782, rx: 0.140, rz: 0.156, x: 0.366 },
  { y: 1.736, rx: 0.170, rz: 0.176, x: 0.442 },
  { y: 1.684, rx: 0.184, rz: 0.184, x: 0.498 },
  { y: 1.610, rx: 0.178, rz: 0.176, x: 0.540 },
  { y: 1.500, rx: 0.166, rz: 0.164, x: 0.580 },
  { y: 1.360, rx: 0.152, rz: 0.150, x: 0.622 },
  { y: 1.200, rx: 0.140, rz: 0.138, x: 0.660 },
  // Elbow: the taper reverses just below it for the forearm's flexor belly,
  // which is the one bulge that stops a forearm reading as a dowel.
  { y: 1.060, rx: 0.128, rz: 0.130, x: 0.692 },
  { y: 0.960, rx: 0.119, rz: 0.124, x: 0.712 },
  { y: 0.860, rx: 0.126, rz: 0.130, x: 0.730 },
  { y: 0.700, rx: 0.123, rz: 0.126, x: 0.754 },
  { y: 0.520, rx: 0.108, rz: 0.111, x: 0.776 },
  { y: 0.340, rx: 0.090, rz: 0.093, x: 0.792 },
  { y: 0.180, rx: 0.071, rz: 0.077, x: 0.800 },
  { y: 0.060, rx: 0.058, rz: 0.070, x: 0.802 },
];

/**
 * Where each hand joins its wrist, and how far it carries the arm's angle on.
 *
 * `roll` turns the palm to face forward. That is the anatomical position, and it
 * is also the only orientation in which a hand reads as a hand at a glance: edge
 * on, four fingers of similar width collapse into one paddle.
 */
export const HAND_MOUNT = { x: 0.802, y: 0.062, z: 0.004, angle: 0.28 };

/**
 * One hand: a palm, four fingers and a thumb.
 *
 * Authored in its own space with the wrist at the origin and the fingers running
 * down −Y, thin front-to-back so the palm faces the viewer. Sized from a 16.5cm
 * hand at this figure's scale — the previous flattened paddle was both too long
 * and undivided, and a hand with no fingers is the detail a viewer notices first
 * on an otherwise careful body.
 */
export const HAND_PALM: Ring[] = [
  { y: 0.000, rx: 0.070, rz: 0.043 },
  { y: -0.060, rx: 0.080, rz: 0.046 },
  { y: -0.160, rx: 0.090, rz: 0.045 },
  { y: -0.260, rx: 0.092, rz: 0.041 },
  { y: -0.310, rx: 0.088, rz: 0.037 },
];

/** Finger and thumb axes: lateral offset, top, length, and root/tip radius. */
export const HAND_DIGITS = [
  { x: 0.052, z: 0.002, top: -0.296, length: 0.235, radius: 0.0195, tip: 0.0135 },
  { x: 0.017, z: 0.004, top: -0.306, length: 0.256, radius: 0.0195, tip: 0.0135 },
  { x: -0.018, z: 0.002, top: -0.300, length: 0.236, radius: 0.0185, tip: 0.0128 },
  { x: -0.051, z: -0.002, top: -0.284, length: 0.188, radius: 0.0165, tip: 0.0115 },
] as const;

export const HAND_THUMB = {
  from: [0.070, -0.088, 0.010] as const,
  to: [0.156, -0.268, 0.020] as const,
  radius: 0.0245,
  tip: 0.0165,
};

/**
 * Right leg, from inside the pelvis to the ankle.
 *
 * The femur travels medially on the way down, which is why `x` decreases: legs
 * that drop straight from the hip sockets read as a pair of columns rather than
 * as a stance.
 */
export const LEG_RINGS: Ring[] = [
  // The thigh hangs from the femoral head, about 8cm off the midline at this
  // scale, and the inner surfaces touch at the crotch before parting at
  // mid-thigh. Placing the thigh closer to the axis than its own radius — as the
  // first pass did — fuses the two legs into one mass down to the knee.
  { y: 0.320, rx: 0.292, rz: 0.298, x: 0.276 },
  { y: 0.180, rx: 0.288, rz: 0.294, x: 0.272 },
  { y: 0.040, rx: 0.281, rz: 0.288, x: 0.266 },
  { y: -0.120, rx: 0.270, rz: 0.277, x: 0.259 },
  { y: -0.300, rx: 0.256, rz: 0.263, x: 0.250 },
  { y: -0.480, rx: 0.240, rz: 0.248, x: 0.240 },
  { y: -0.660, rx: 0.224, rz: 0.232, x: 0.230 },
  { y: -0.820, rx: 0.208, rz: 0.216, x: 0.221 },
  // Suprapatellar swell, then the patella carried forward on a positive centre.
  // A knee that only narrows reads as a hinge in a tube; the forward shift is
  // what makes it read as a joint with a bone across the front of it.
  { y: -0.940, rx: 0.196, rz: 0.202, x: 0.213, z: 0.005 },
  { y: -1.020, rx: 0.184, rz: 0.190, x: 0.208, z: 0.009 },
  { y: -1.080, rx: 0.176, rz: 0.184, x: 0.205, z: 0.013 },
  { y: -1.140, rx: 0.170, rz: 0.177, x: 0.202, z: 0.009 },
  { y: -1.220, rx: 0.167, rz: 0.173, x: 0.199, z: 0.002 },
  // Gastrocnemius: rises fast behind the shin, peaks in the upper third of the
  // calf, and the centre draws back as it does.
  { y: -1.320, rx: 0.180, rz: 0.188, x: 0.195, z: -0.007 },
  { y: -1.400, rx: 0.188, rz: 0.196, x: 0.192, z: -0.013 },
  { y: -1.520, rx: 0.180, rz: 0.188, x: 0.187, z: -0.011 },
  { y: -1.680, rx: 0.162, rz: 0.168, x: 0.181, z: -0.006 },
  { y: -1.860, rx: 0.142, rz: 0.146, x: 0.175, z: -0.002 },
  { y: -2.060, rx: 0.124, rz: 0.128, x: 0.169 },
  { y: -2.260, rx: 0.110, rz: 0.114, x: 0.163 },
  { y: -2.460, rx: 0.100, rz: 0.104, x: 0.157 },
  { y: -2.620, rx: 0.096, rz: 0.100, x: 0.153 },
  { y: -2.720, rx: 0.095, rz: 0.098, x: 0.152 },
  { y: -2.820, rx: 0.094, rz: 0.097, x: 0.152 },
];

/**
 * Right foot, authored along +Y and rotated forward by the renderer.
 *
 * `rx` is the width of the foot and `rz` becomes its height once rotated, so a
 * ring reads as an ankle at the top of the list and as a toe box at the end.
 */
export const FOOT_RINGS: Ring[] = [
  { y: 0.520, rx: 0.086, rz: 0.031 },
  { y: 0.400, rx: 0.098, rz: 0.050 },
  { y: 0.250, rx: 0.104, rz: 0.072 },
  { y: 0.100, rx: 0.102, rz: 0.094 },
  { y: 0.000, rx: 0.096, rz: 0.102 },
  { y: -0.090, rx: 0.084, rz: 0.078 },
  { y: -0.135, rx: 0.000, rz: 0.000 },
];

/**
 * Five toes, medial to lateral for a right foot.
 *
 * Authored tip-first because ring lists descend, and the tip is the far end once
 * the foot is stood up. Descending lengths and radii: the hallux is nearly twice
 * the little toe, and getting that gradient wrong is what makes a foot read as a
 * flipper.
 */
export const FOOT_TOES = [
  // Each root runs 0.03 back past the ball of the foot. Ending flush with it
  // leaves the two surfaces merely touching, which shows as a ring of seam at
  // the base of every toe from a low camera.
  { x: -0.052, top: 0.672, length: 0.182, radius: 0.030, tip: 0.024 },
  { x: -0.014, top: 0.660, length: 0.170, radius: 0.022, tip: 0.017 },
  { x: 0.016, top: 0.648, length: 0.158, radius: 0.020, tip: 0.015 },
  { x: 0.044, top: 0.632, length: 0.142, radius: 0.018, tip: 0.014 },
  { x: 0.068, top: 0.612, length: 0.122, radius: 0.016, tip: 0.012 },
] as const;

/** Where each foot is mounted, and how far it is turned out. */
export const FOOT_MOUNT = { x: 0.152, y: -2.9, z: -0.06, toeOut: 0.1 };

/**
 * Faceless surface landmarks the annotations and tests share.
 *
 * What used to be an inventory of eyes, brows, nostrils and a hair cap is now
 * four measurements, because those are the only landmarks a faceless figure
 * actually has.
 */
export const AVATAR_LANDMARKS = {
  /**
   * Chest wall centres the breast-area annotations mount against, and the soft
   * form that sits on them.
   *
   * A restrained one: enough that the Breast area has anatomy to point at and
   * that the chest reads as a body rather than a barrel, small enough that the
   * figure stays anatomically neutral. There is no areola and no nipple — those
   * are identity, not structure, and the figure carries no identity.
   */
  chest: {
    centres: [[-0.235, 1.42, 0], [0.235, 1.42, 0]] as const,
  },
  /** Outer end of each shoulder girdle. */
  acromion: {
    centres: [[-0.56, 1.78, 0], [0.56, 1.78, 0]] as const,
  },
  navel: [0, 0.9, 0.28] as const,
  /** Heights the head contour lines are drawn at. */
  contourHeights: [2.88, 2.80, 2.71, 2.61, 2.51, 2.41, 2.31] as const,
} as const;

/**
 * The face, as displacement rather than as features.
 *
 * Deliberately shallow. The deepest form here is the nose tip at 0.034 — one
 * centimetre at this figure's scale — and everything else is half that or less.
 * That is the whole budget: enough that the head reads as a head from its
 * structure, far too little to carry an identity, an expression or a likeness.
 * There is no iris, no lash, no lip border, no nostril opening; what exists is
 * the shallow relief a premium medical mannequin has, which says "human head"
 * and nothing else about whose.
 *
 * `facing` keeps each form on the aspect it belongs to, so a brow ridge does not
 * also appear on the back of the skull.
 */
export const FACE_SCULPT: readonly SculptFeature[] = [
  // Brow and orbit.
  { at: [0.10, 2.655, 0.29], radius: [0.115, 0.046, 0.10], amount: 0.011, mirror: true, falloff: 2.2, facing: [0, 0.25, 1] },
  { at: [0, 2.645, 0.30], radius: [0.05, 0.04, 0.08], amount: 0.006, facing: [0, 0, 1] },
  { at: [0.105, 2.603, 0.285], radius: [0.086, 0.048, 0.09], amount: -0.013, mirror: true, facing: [0, 0, 1] },
  { at: [0.235, 2.60, 0.13], radius: [0.10, 0.10, 0.16], amount: -0.009, mirror: true, facing: [0.6, 0, 0.5] },
  // Midface.
  { at: [0.175, 2.505, 0.235], radius: [0.11, 0.075, 0.13], amount: 0.010, mirror: true, facing: [0.4, 0.1, 0.9] },
  { at: [0.155, 2.415, 0.235], radius: [0.085, 0.065, 0.11], amount: -0.007, mirror: true, facing: [0.3, 0, 0.9] },
  // Nose: a bridge, a tip and two wings. Nothing more.
  { at: [0, 2.495, 0.30], radius: [0.042, 0.086, 0.075], amount: 0.017, falloff: 2.6, facing: [0, 0, 1] },
  { at: [0, 2.428, 0.298], radius: [0.048, 0.045, 0.07], amount: 0.034, falloff: 2.4, facing: [0, -0.15, 1] },
  { at: [0.045, 2.408, 0.288], radius: [0.035, 0.030, 0.06], amount: 0.014, mirror: true, facing: [0, 0, 1] },
  // Mouth.
  { at: [0, 2.372, 0.276], radius: [0.022, 0.028, 0.05], amount: -0.005, falloff: 3, facing: [0, 0, 1] },
  { at: [0, 2.345, 0.272], radius: [0.072, 0.022, 0.06], amount: 0.009, falloff: 2.4, facing: [0, 0, 1] },
  { at: [0, 2.315, 0.268], radius: [0.066, 0.024, 0.06], amount: 0.008, falloff: 2.4, facing: [0, 0, 1] },
  { at: [0.068, 2.330, 0.255], radius: [0.030, 0.030, 0.05], amount: -0.005, mirror: true, facing: [0, 0, 1] },
  { at: [0, 2.285, 0.255], radius: [0.055, 0.022, 0.05], amount: -0.006, facing: [0, 0, 1] },
  // Chin and mandible.
  { at: [0, 2.245, 0.245], radius: [0.075, 0.050, 0.07], amount: 0.010, falloff: 2.2, facing: [0, -0.2, 1] },
  { at: [0.185, 2.300, 0.10], radius: [0.090, 0.100, 0.14], amount: 0.007, mirror: true, facing: [0.8, 0, 0.5] },
  // Occiput and the neck's sternocleidomastoid.
  { at: [0, 2.72, -0.30], radius: [0.20, 0.18, 0.12], amount: 0.006, facing: [0, 0, -1] },
  { at: [0.090, 1.98, 0.17], radius: [0.070, 0.16, 0.11], amount: 0.008, mirror: true, facing: [0.3, 0, 0.9] },
];

/**
 * The torso, as displacement.
 *
 * The breast is the reason this exists. It was an ellipsoid mesh intersecting the
 * chest, and an intersection between two closed surfaces leaves a curve that
 * reads as a join no matter how the two are shaded — which is exactly the "sphere
 * placed on the torso" the whole approach was criticised for. Here it is a place
 * where the chest wall rises: the same vertices, displaced along their own
 * normals, so pectoral, breast, inframammary fold, rib cage and side torso are
 * one uninterrupted surface with no join to hide.
 *
 * The three features that make it read as anatomy rather than a bump are the
 * upper pectoral swell it grows out of, the lower fullness that shifts its mass
 * below centre, and the inframammary fold that tucks it back into the rib cage.
 */
export const TORSO_SCULPT: readonly SculptFeature[] = [
  // Clavicles and the hollows either side of the sternal notch.
  { at: [0.17, 1.815, 0.16], radius: [0.13, 0.055, 0.12], amount: -0.016, mirror: true, facing: [0, 0.4, 0.9] },
  { at: [0.20, 1.775, 0.175], radius: [0.16, 0.040, 0.12], amount: 0.009, mirror: true, facing: [0, 0.3, 0.9] },
  { at: [0, 1.845, 0.175], radius: [0.05, 0.045, 0.08], amount: -0.012, facing: [0, 0.3, 0.9] },
  // Pectoral, breast, and the fold that returns it to the rib cage.
  { at: [0.235, 1.545, 0.27], radius: [0.20, 0.11, 0.20], amount: 0.016, mirror: true, facing: [0, 0.2, 1] },
  { at: [0.235, 1.405, 0.255], radius: [0.215, 0.20, 0.235], amount: 0.088, mirror: true, falloff: 1.9, facing: [0.15, 0, 1] },
  { at: [0.235, 1.335, 0.24], radius: [0.175, 0.115, 0.20], amount: 0.030, mirror: true, falloff: 2.2, facing: [0, -0.2, 1] },
  { at: [0.235, 1.268, 0.235], radius: [0.16, 0.045, 0.16], amount: -0.014, mirror: true, facing: [0, -0.3, 1] },
  { at: [0, 1.44, 0.30], radius: [0.055, 0.16, 0.10], amount: -0.010, falloff: 2.5, facing: [0, 0, 1] },
  // Rib arch, abdomen, linea alba and navel.
  { at: [0.175, 1.245, 0.275], radius: [0.15, 0.075, 0.16], amount: 0.010, mirror: true, facing: [0, 0, 1] },
  { at: [0, 1.14, 0.29], radius: [0.16, 0.11, 0.14], amount: 0.007, facing: [0, 0, 1] },
  { at: [0, 1.02, 0.285], radius: [0.024, 0.19, 0.08], amount: -0.006, falloff: 3, facing: [0, 0, 1] },
  { at: [0, 0.90, 0.282], radius: [0.036, 0.040, 0.055], amount: -0.024, falloff: 3, facing: [0, 0, 1] },
  // Waist, iliac crest, lower abdomen and the inguinal crease.
  { at: [0.415, 1.045, 0.06], radius: [0.13, 0.16, 0.22], amount: -0.014, mirror: true, facing: [1, 0, 0.25] },
  { at: [0.455, 0.585, 0.10], radius: [0.14, 0.13, 0.22], amount: 0.016, mirror: true, facing: [1, 0.2, 0.35] },
  { at: [0, 0.72, 0.30], radius: [0.20, 0.16, 0.14], amount: 0.008, facing: [0, 0, 1] },
  { at: [0.20, 0.115, 0.235], radius: [0.19, 0.115, 0.16], amount: -0.018, mirror: true, falloff: 2.4, facing: [0.3, -0.3, 0.9] },
  { at: [0, 0.03, 0.26], radius: [0.13, 0.10, 0.12], amount: 0.010, facing: [0, 0, 1] },
  // Back: scapulae, spinal groove, lumbar hollow, glutes and the gluteal fold.
  { at: [0.245, 1.58, -0.28], radius: [0.17, 0.18, 0.14], amount: 0.011, mirror: true, facing: [0.2, 0, -1] },
  { at: [0, 1.35, -0.33], radius: [0.035, 0.55, 0.10], amount: -0.010, falloff: 2.5, facing: [0, 0, -1] },
  { at: [0, 0.90, -0.29], radius: [0.14, 0.16, 0.12], amount: -0.012, facing: [0, 0, -1] },
  { at: [0.205, 0.235, -0.29], radius: [0.20, 0.22, 0.16], amount: 0.032, mirror: true, facing: [0.2, 0, -1] },
  { at: [0.205, 0.03, -0.26], radius: [0.16, 0.05, 0.14], amount: -0.012, mirror: true, facing: [0, -0.3, -1] },
];

/** Head, neck and trunk share one geometry, so they share one feature set. */
export const BODY_SCULPT: readonly SculptFeature[] = [...FACE_SCULPT, ...TORSO_SCULPT];

export const ARM_SCULPT: readonly SculptFeature[] = [
  { at: [0.505, 1.685, 0], radius: [0.20, 0.16, 0.20], amount: 0.016, mirror: true },
  { at: [0.600, 1.360, 0.11], radius: [0.13, 0.19, 0.13], amount: 0.010, mirror: true, facing: [0, 0, 1] },
  { at: [0.600, 1.400, -0.11], radius: [0.13, 0.22, 0.13], amount: 0.009, mirror: true, facing: [0, 0, -1] },
  { at: [0.712, 0.955, -0.09], radius: [0.10, 0.09, 0.11], amount: 0.008, mirror: true, facing: [0, 0, -1] },
  { at: [0.735, 0.845, 0.09], radius: [0.11, 0.14, 0.12], amount: 0.009, mirror: true, facing: [0, 0, 1] },
];

export const LEG_SCULPT: readonly SculptFeature[] = [
  // Quadriceps, medial and lateral.
  { at: [0.175, -0.90, 0.11], radius: [0.13, 0.18, 0.14], amount: 0.014, mirror: true, facing: [-0.5, 0, 0.8] },
  { at: [0.315, -0.62, 0.06], radius: [0.13, 0.24, 0.15], amount: 0.011, mirror: true, facing: [1, 0, 0.4] },
  // Patella and the hollow behind the knee.
  { at: [0.205, -1.075, 0.185], radius: [0.095, 0.085, 0.10], amount: 0.013, mirror: true, falloff: 2.4, facing: [0, 0, 1] },
  { at: [0.200, -1.100, -0.175], radius: [0.09, 0.09, 0.10], amount: -0.010, mirror: true, facing: [0, 0, -1] },
  // Calf heads, tibial ridge, malleoli and the Achilles hollow.
  { at: [0.155, -1.37, -0.16], radius: [0.11, 0.20, 0.13], amount: 0.013, mirror: true, facing: [-0.4, 0, -0.9] },
  { at: [0.235, -1.42, -0.15], radius: [0.10, 0.18, 0.12], amount: 0.010, mirror: true, facing: [0.5, 0, -0.9] },
  { at: [0.190, -1.85, 0.13], radius: [0.05, 0.35, 0.08], amount: 0.007, mirror: true, falloff: 2.6, facing: [0, 0, 1] },
  { at: [0.075, -2.70, 0], radius: [0.06, 0.07, 0.07], amount: 0.009, mirror: true, facing: [-1, 0, 0.2] },
  { at: [0.235, -2.73, 0], radius: [0.055, 0.065, 0.065], amount: 0.008, mirror: true, facing: [1, 0, 0.2] },
  { at: [0.152, -2.60, -0.09], radius: [0.06, 0.18, 0.07], amount: -0.008, mirror: true, facing: [0, 0, -1] },
];

/* ══ Lofting ═══════════════════════════════════════════════════════════════ */

/** Superellipse unit offset at an angle. `n` = 2 is a plain ellipse. */
function sectionOffset(theta: number, n: number): [number, number] {
  if (n === 2) return [Math.cos(theta), Math.sin(theta)];
  const power = 2 / n;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    Math.sign(cos) * Math.pow(Math.abs(cos), power),
    Math.sign(sin) * Math.pow(Math.abs(sin), power),
  ];
}

/**
 * A closed surface through a descending stack of rings.
 *
 * The ring is not duplicated at the seam — the last segment indexes back to the
 * first — so `computeVertexNormals` averages across it and there is no shading
 * line down the back of the model. That is also why nothing here writes UVs: a
 * wrapped ring has no place to put a `u` discontinuity, and the figure is lit
 * by an environment map rather than textured.
 *
 * A ring of zero radius closes the surface. Its segments collapse onto one
 * point, so half of each quad degenerates and the remainder forms a fan.
 */
export function buildLoft(rings: Ring[], segments = FIGURE_SEGMENTS): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const ring of rings) {
    const centreX = ring.x ?? 0;
    const centreZ = ring.z ?? 0;
    const exponent = ring.n ?? 2;
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = (segment / segments) * Math.PI * 2;
      const [unitX, unitZ] = sectionOffset(theta, exponent);
      positions.push(centreX + unitX * ring.rx, ring.y, centreZ + unitZ * ring.rz);
    }
  }

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + segment;
      const d = (ring + 1) * segments + next;
      // Rings descend, so this winding faces outward. Reversing it culls the
      // near surface and shows the inside of the far one through the model.
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Several ring stacks in one geometry.
 *
 * A hand is a palm plus five digits and a foot is a sole plus five toes; each
 * part is its own closed surface, but they belong to one mesh so they take one
 * draw call and one material. Appending into shared buffers is all that requires
 * — no merge utility, and normals are computed once over the finished result.
 *
 * The parts genuinely interpenetrate at their roots, which is deliberate: a digit
 * rooted inside the palm has no visible joint, and a digit merely touching it
 * shows a seam from at least one angle.
 */
export function buildMultiLoft(
  parts: Array<{ rings: Ring[]; segments?: number }>,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const part of parts) {
    const segments = part.segments ?? 32;
    const offset = positions.length / 3;

    for (const ring of part.rings) {
      const centreX = ring.x ?? 0;
      const centreZ = ring.z ?? 0;
      const exponent = ring.n ?? 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const theta = (segment / segments) * Math.PI * 2;
        const [unitX, unitZ] = sectionOffset(theta, exponent);
        positions.push(centreX + unitX * ring.rx, ring.y, centreZ + unitZ * ring.rz);
      }
    }

    for (let ring = 0; ring < part.rings.length - 1; ring += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        const a = offset + ring * segments + segment;
        const b = offset + ring * segments + next;
        const c = offset + (ring + 1) * segments + segment;
        const d = offset + (ring + 1) * segments + next;
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A finger, thumb or toe: a tapered tube with a rounded tip.
 *
 * The last three rings collapse on a quarter-sine rather than linearly, which is
 * what rounds the end. A digit that tapers straight to a point reads as a claw,
 * and five claws is the difference between a hand and a rake.
 */
export function digitRings(options: {
  x?: number;
  z?: number;
  /** Highest point of the digit; the list descends from here. */
  top: number;
  /** Vertical span from `top` to the far end. */
  length: number;
  radius: number;
  tip: number;
  /**
   * Which end of the descending list is the fingertip.
   *
   * Fingers hang down, so their tip is the lowest ring; toes point forward, which
   * is +Y before the foot is stood up, so their tip is the highest. Both still
   * have to be authored descending for the winding to face outward, so the taper
   * has to know which end it is rounding.
   */
  capAt: "start" | "end";
  /** Lateral and depth drift from root to tip, for a thumb. */
  driftX?: number;
  driftZ?: number;
}): Ring[] {
  const { top, length, radius, tip, capAt } = options;
  const STEPS = 10;
  const CAP = 0.16;
  const rings: Ring[] = [];

  for (let step = 0; step <= STEPS; step += 1) {
    const down = step / STEPS;
    const fromRoot = capAt === "end" ? down : 1 - down;
    const remaining = 1 - fromRoot;
    const width = remaining < CAP
      ? tip * Math.sin((remaining / CAP) * (Math.PI / 2))
      : tip + (radius - tip) * ((remaining - CAP) / (1 - CAP));

    rings.push({
      y: top - down * length,
      rx: width,
      rz: width,
      x: (options.x ?? 0) + (options.driftX ?? 0) * fromRoot,
      z: (options.z ?? 0) + (options.driftZ ?? 0) * fromRoot,
    });
  }

  return rings;
}

/** Palm and five digits, wrist at the origin, palm facing +Z. */
export function buildHand(mirror = false): THREE.BufferGeometry {
  const flip = (rings: Ring[]) => (mirror ? mirrorRings(rings) : rings);

  return buildMultiLoft([
    { rings: flip(HAND_PALM), segments: 44 },
    ...HAND_DIGITS.map((digit) => ({
      rings: flip(digitRings({
        x: digit.x,
        z: digit.z,
        top: digit.top,
        length: digit.length,
        radius: digit.radius,
        tip: digit.tip,
        capAt: "end",
      })),
      segments: 22,
    })),
    {
      rings: flip(digitRings({
        x: HAND_THUMB.from[0],
        z: HAND_THUMB.from[2],
        top: HAND_THUMB.from[1],
        length: HAND_THUMB.from[1] - HAND_THUMB.to[1],
        radius: HAND_THUMB.radius,
        tip: HAND_THUMB.tip,
        capAt: "end",
        driftX: HAND_THUMB.to[0] - HAND_THUMB.from[0],
        driftZ: HAND_THUMB.to[2] - HAND_THUMB.from[2],
      })),
      segments: 22,
    },
  ]);
}

/** Sole and five toes, authored along +Y and stood up by the renderer. */
export function buildFoot(mirror = false): THREE.BufferGeometry {
  const flip = (rings: Ring[]) => (mirror ? mirrorRings(rings) : rings);

  return buildMultiLoft([
    { rings: flip(FOOT_RINGS), segments: 44 },
    ...FOOT_TOES.map((toe) => ({
      rings: flip(digitRings({
        x: toe.x,
        top: toe.top,
        length: toe.length,
        radius: toe.radius,
        tip: toe.tip,
        capAt: "start",
      })),
      segments: 18,
    })),
  ]);
}

/* ══ Sculpting ═════════════════════════════════════════════════════════════ */

/**
 * Rings interpolated to a maximum vertical step.
 *
 * A ring stack authored for readable anatomy is far too coarse to sculpt into: a
 * nose is 0.05 tall and the head's authored rings are up to 0.05 apart, so a
 * displacement would land on one ring and read as a crease rather than a form.
 * Resampling first is what gives the sculpt something to move.
 *
 * The step is finer above the shoulders because that is where the small features
 * are — spending head-level density on a shin costs vertices for nothing.
 */
export function resampleRings(rings: Ring[], fineStep: number, coarseStep: number): Ring[] {
  const out: Ring[] = [rings[0]];

  for (let index = 1; index < rings.length; index += 1) {
    const from = rings[index - 1];
    const to = rings[index];
    const span = from.y - to.y;
    const step = to.y > FIGURE.chin - 0.1 ? fineStep : coarseStep;
    const divisions = Math.max(1, Math.ceil(span / step));

    for (let piece = 1; piece <= divisions; piece += 1) {
      const amount = piece / divisions;
      const blend = (a: number, b: number) => a + (b - a) * amount;
      out.push({
        y: blend(from.y, to.y),
        rx: blend(from.rx, to.rx),
        rz: blend(from.rz, to.rz),
        x: blend(from.x ?? 0, to.x ?? 0),
        z: blend(from.z ?? 0, to.z ?? 0),
        n: blend(from.n ?? 2, to.n ?? 2),
      });
    }
  }

  return out;
}

/**
 * One sculpted form: a smooth displacement of the surface along its own normal.
 *
 * This is the whole answer to "the breast looks like a separate object stuck on
 * the torso". It was one — an ellipsoid mesh intersecting the chest, which leaves
 * an intersection curve no amount of shading hides. A displacement has no
 * intersection to hide, because it moves the vertices that are already there: the
 * breast becomes a place where the chest wall rises, exactly as it is in a body,
 * and the transition to pectoral, rib cage and side torso is whatever the falloff
 * says it is. The mesh stays single and continuous.
 *
 * It is also how a sculptor works — a clay-buildup brush is this operation — so
 * the same mechanism gives eye sockets (negative), a nose bridge, a clavicle
 * hollow and a patella without adding a single object to the scene.
 */
export type SculptFeature = {
  /** Centre of influence, in model space. */
  at: readonly [number, number, number];
  /** Ellipsoidal extent of the influence. */
  radius: readonly [number, number, number];
  /** Peak displacement along the surface normal. Negative hollows the surface. */
  amount: number;
  /** Also apply the mirror image across the midline. */
  mirror?: boolean;
  /**
   * Falloff exponent. 2 is a soft dome; higher concentrates the peak and is what
   * separates a nose ridge from a swelling.
   */
  falloff?: number;
  /** Restrict to vertices whose normal points this way, for front-only forms. */
  facing?: readonly [number, number, number];
};

/** Smooth, C1-continuous falloff. Zero at the edge of influence, 1 at the centre. */
function falloffAt(distance: number, exponent: number): number {
  if (distance >= 1) return 0;
  const base = 1 - distance * distance;
  return Math.pow(base * base, exponent / 2);
}

/**
 * Displace a geometry's vertices along their normals by a set of features.
 *
 * Normals are read before anything moves, so every vertex is pushed along the
 * surface direction it had in the base form; recomputing them afterwards is what
 * makes the result shade as one continuous surface. Applying the features in one
 * accumulated pass rather than sequentially keeps overlapping forms — a breast
 * over a pectoral, a brow over a temple — blending additively instead of
 * stair-stepping.
 */
export function applySculpt(
  geometry: THREE.BufferGeometry,
  features: readonly SculptFeature[],
): THREE.BufferGeometry {
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
  if (!normals) geometry.computeVertexNormals();

  const source = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const baseNormals = Float32Array.from(source.array);

  // Expand mirrored features once rather than testing for them per vertex.
  const expanded: SculptFeature[] = [];
  for (const feature of features) {
    expanded.push(feature);
    if (feature.mirror) {
      expanded.push({
        ...feature,
        at: [-feature.at[0], feature.at[1], feature.at[2]],
        facing: feature.facing
          ? [-feature.facing[0], feature.facing[1], feature.facing[2]]
          : undefined,
      });
    }
  }

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const nx = baseNormals[index * 3];
    const ny = baseNormals[index * 3 + 1];
    const nz = baseNormals[index * 3 + 2];

    let push = 0;
    for (const feature of expanded) {
      const dx = (x - feature.at[0]) / feature.radius[0];
      const dy = (y - feature.at[1]) / feature.radius[1];
      const dz = (z - feature.at[2]) / feature.radius[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance >= 1) continue;

      let weight = falloffAt(distance, feature.falloff ?? 2);
      if (feature.facing) {
        // A form on the front of the chest must not also appear on the back of
        // it. Gating on the normal's agreement with a direction keeps a feature
        // on the aspect it belongs to, and fades it out rather than clipping it.
        const agreement =
          nx * feature.facing[0] + ny * feature.facing[1] + nz * feature.facing[2];
        if (agreement <= 0) continue;
        weight *= agreement * agreement;
      }
      push += feature.amount * weight;
    }

    if (push !== 0) {
      positions.setXYZ(index, x + nx * push, y + ny * push, z + nz * push);
    }
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The same rings, shrunk toward their own centres.
 *
 * This is how the structure shell is produced from the surface rather than from
 * a second hand-authored list: there is only one set of measurements, so the
 * layers cannot drift apart. A ring already closed stays closed.
 */
export function insetRings(rings: Ring[], inset: number): Ring[] {
  return rings.map((ring) => ({
    ...ring,
    rx: ring.rx === 0 ? 0 : Math.max(0.002, ring.rx - inset),
    rz: ring.rz === 0 ? 0 : Math.max(0.002, ring.rz - inset),
  }));
}

/**
 * The mirrored limb, as its own geometry.
 *
 * Negating a group's X scale would be shorter and wrong: it inverts the
 * winding, so the mirrored limb renders inside-out under front-face culling.
 */
export function mirrorRings(rings: Ring[]): Ring[] {
  return rings.map((ring) => ({ ...ring, x: -(ring.x ?? 0) }));
}

/** Linear cross-section between the two rings that straddle a height. */
export function ringAt(rings: Ring[], y: number): Ring | null {
  for (let index = 0; index < rings.length - 1; index += 1) {
    const upper = rings[index];
    const lower = rings[index + 1];
    const top = Math.max(upper.y, lower.y);
    const bottom = Math.min(upper.y, lower.y);
    if (y > top || y < bottom) continue;
    const span = lower.y - upper.y;
    const amount = Math.abs(span) < 1e-12 ? 0 : (y - upper.y) / span;
    const blend = (from: number, to: number) => from + (to - from) * amount;
    return {
      y,
      rx: blend(upper.rx, lower.rx),
      rz: blend(upper.rz, lower.rz),
      x: blend(upper.x ?? 0, lower.x ?? 0),
      z: blend(upper.z ?? 0, lower.z ?? 0),
      n: blend(upper.n ?? 2, lower.n ?? 2),
    };
  }
  return null;
}

/**
 * Anterior surface of the head-neck-trunk shell at a point.
 *
 * Annotations are authored as offsets from a named landmark, and this is what
 * proves each one lands on the body instead of floating in front of it or
 * sinking inside it. Returns `NaN` where there is no body at that height, or
 * where the lateral offset is already outside it.
 */
export function frontAt(rings: Ring[], x: number, y: number): number {
  const ring = ringAt(rings, y);
  if (!ring) return Number.NaN;
  const lateral = Math.abs(x - (ring.x ?? 0));
  if (ring.rx <= 0 || lateral > ring.rx) return Number.NaN;

  // Invert the superellipse rather than the circle: at the ribcage an ellipse
  // underestimates the surface by several millimetres, which is the difference
  // between a marker on the skin and one buried under it.
  const exponent = ring.n ?? 2;
  const unit = Math.pow(
    Math.max(0, 1 - Math.pow(lateral / ring.rx, exponent)),
    1 / exponent,
  );
  return (ring.z ?? 0) + ring.rz * unit;
}

export function bodyFrontAt(x: number, y: number): number {
  return frontAt(BODY_RINGS, x, y);
}

/**
 * The sculpted body surface, sampled.
 *
 * Once the anatomy is displacement rather than rings, `bodyFrontAt` describes the
 * base form and not what renders — a marker on the breast sits 0.04 outside it.
 * Anything that needs to know where the skin actually is has to ask the finished
 * mesh, so this is the one definition of that, shared by the annotation tests and
 * by the tooling that authors marker positions. Built lazily and once: it is a
 * pure function of module constants, so there is nothing to invalidate.
 *
 * Deliberately coarser than the render mesh. The extra density in the renderer
 * exists to keep the silhouette smooth at a head-filling zoom, and contributes
 * nothing to locating a surface to within a millimetre.
 */
const SAMPLE_SEGMENTS = 128;
let sampleCache: Array<[number, number, number]> | null = null;

function sculptedSamples(): Array<[number, number, number]> {
  if (sampleCache) return sampleCache;

  const geometry = applySculpt(
    buildLoft(resampleRings(BODY_RINGS, 0.013, 0.028), SAMPLE_SEGMENTS),
    BODY_SCULPT,
  );
  const position = geometry.getAttribute("position");
  const points: Array<[number, number, number]> = [];
  for (let index = 0; index < position.count; index += 1) {
    points.push([position.getX(index), position.getY(index), position.getZ(index)]);
  }
  geometry.dispose();

  sampleCache = points;
  return points;
}

/** Anterior surface of the sculpted body nearest a point, or `NaN` if none. */
export function sculptedFrontAt(x: number, y: number, window = 0.024): number {
  let best = -Infinity;
  for (const [px, py, pz] of sculptedSamples()) {
    if (pz <= 0) continue;
    if (Math.abs(px - x) > window || Math.abs(py - y) > window) continue;
    if (pz > best) best = pz;
  }
  return Number.isFinite(best) ? best : Number.NaN;
}

/** Lateral surface of the sculpted body, for markers on the side of the head. */
export function sculptedSideAt(x: number, y: number, window = 0.024): number {
  const sign = Math.sign(x) || 1;
  let best = -Infinity;
  for (const [px, py, pz] of sculptedSamples()) {
    if (Math.abs(pz) > 0.05 || Math.abs(py - y) > window) continue;
    const lateral = sign * px;
    if (lateral > best) best = lateral;
  }
  return Number.isFinite(best) ? best : Number.NaN;
}

/**
 * Contour lines over the cranium.
 *
 * The only thing describing the head, and the reason a featureless ovoid still
 * reads as a skull: horizontal sections at measured heights, plus the sagittal
 * and coronal profiles. It is the convention a surgical atlas uses, and it
 * conveys form without asserting an identity.
 */
export function buildHeadContours(): THREE.BufferGeometry {
  const positions: number[] = [];
  const CLEARANCE = 1.006;

  const strip = (points: Array<[number, number, number]>) => {
    for (let index = 0; index < points.length - 1; index += 1) {
      positions.push(...points[index], ...points[index + 1]);
    }
  };

  for (const height of AVATAR_LANDMARKS.contourHeights) {
    const ring = ringAt(HEAD_RINGS, height);
    if (!ring) continue;
    const loop: Array<[number, number, number]> = [];
    for (let segment = 0; segment <= 72; segment += 1) {
      const theta = (segment / 72) * Math.PI * 2;
      const [unitX, unitZ] = sectionOffset(theta, ring.n ?? 2);
      loop.push([
        (ring.x ?? 0) + unitX * ring.rx * CLEARANCE,
        height,
        (ring.z ?? 0) + unitZ * ring.rz * CLEARANCE,
      ]);
    }
    strip(loop);
  }

  // Sagittal (front and back) and coronal (both sides) profiles, sampled from
  // the same rings so they cannot disagree with the surface they trace.
  const sagittalFront: Array<[number, number, number]> = [];
  const sagittalBack: Array<[number, number, number]> = [];
  const coronalLeft: Array<[number, number, number]> = [];
  const coronalRight: Array<[number, number, number]> = [];
  const TOP = HEAD_RINGS[0].y;
  const BOTTOM = HEAD_RINGS[HEAD_RINGS.length - 1].y;
  for (let step = 0; step <= 64; step += 1) {
    const height = TOP - (TOP - BOTTOM) * (step / 64);
    const ring = ringAt(HEAD_RINGS, height);
    if (!ring) continue;
    const centreZ = ring.z ?? 0;
    sagittalFront.push([0, height, centreZ + ring.rz * CLEARANCE]);
    sagittalBack.push([0, height, centreZ - ring.rz * CLEARANCE]);
    coronalLeft.push([-ring.rx * CLEARANCE, height, centreZ]);
    coronalRight.push([ring.rx * CLEARANCE, height, centreZ]);
  }
  strip(sagittalFront);
  strip(sagittalBack);
  strip(coronalLeft);
  strip(coronalRight);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/* ══ Skeleton ══════════════════════════════════════════════════════════════ */

/** Cranial vault and maxilla. Stops above the mandible so the arch is visible. */
export const SKULL_RINGS: Ring[] = [
  { y: 2.965, rx: 0.000, rz: 0.000, z: -0.006 },
  { y: 2.930, rx: 0.108, rz: 0.126, z: -0.010 },
  { y: 2.880, rx: 0.166, rz: 0.196, z: -0.014 },
  { y: 2.820, rx: 0.206, rz: 0.240, z: -0.016 },
  { y: 2.760, rx: 0.228, rz: 0.264, z: -0.017 },
  { y: 2.700, rx: 0.235, rz: 0.272, z: -0.017 },
  { y: 2.640, rx: 0.233, rz: 0.272, z: -0.015 },
  { y: 2.580, rx: 0.226, rz: 0.268, z: -0.011 },
  { y: 2.520, rx: 0.214, rz: 0.258, z: -0.006 },
  { y: 2.460, rx: 0.196, rz: 0.240, z: 0.004 },
  { y: 2.400, rx: 0.172, rz: 0.216, z: 0.014 },
  { y: 2.340, rx: 0.148, rz: 0.190, z: 0.020 },
  { y: 2.290, rx: 0.120, rz: 0.158, z: 0.020 },
  { y: 2.260, rx: 0.000, rz: 0.000, z: 0.018 },
];

/** Cervical, thoracic and lumbar curve. Swept as a tube by the renderer. */
export const SPINE_POINTS: Array<[number, number, number]> = [
  [0, 2.08, -0.03],
  [0, 1.9, -0.05],
  [0, 1.7, -0.09],
  [0, 1.45, -0.12],
  [0, 1.2, -0.12],
  [0, 0.98, -0.08],
  [0, 0.78, -0.04],
  [0, 0.6, -0.04],
  [0, 0.42, -0.07],
];

/**
 * Thoracic cage, as open arcs rather than closed hoops.
 *
 * A closed ellipse at each level was the first attempt and it read as a stack of
 * plates: real ribs stop either side of the sternum, and they slope down and
 * forward from the spine. The gap is what lets the sternum be a bone rather than
 * a decoration, and `tilt` is what stops seven identical horizontal rings
 * looking like a barrel.
 */
export const RIB_ARC = Math.PI * 1.42;

export const RIB_LEVELS: Array<{ y: number; rx: number; rz: number; tilt: number }> = [
  { y: 1.70, rx: 0.300, rz: 0.200, tilt: 0.16 },
  { y: 1.60, rx: 0.350, rz: 0.235, tilt: 0.19 },
  { y: 1.50, rx: 0.385, rz: 0.258, tilt: 0.22 },
  { y: 1.40, rx: 0.400, rz: 0.268, tilt: 0.25 },
  { y: 1.30, rx: 0.395, rz: 0.262, tilt: 0.27 },
  { y: 1.20, rx: 0.375, rz: 0.245, tilt: 0.29 },
  { y: 1.10, rx: 0.340, rz: 0.215, tilt: 0.31 },
];

/** Sternum, clavicles and the pelvic ring. */
export const AXIAL_BONES = {
  sternum: { y: 1.46, rx: 0.052, rz: 0.032, height: 0.32, z: 0.215 },
  clavicle: { y: 1.79, half: 0.22, radius: 0.024, z: 0.115, lift: 0.16 },
  pelvis: { y: 0.42, rx: 0.40, rz: 0.255, radius: 0.055 },
} as const;

/** Long bones, as tapered lofts inside their limb. */
export const ARM_BONES: Ring[] = [
  { y: 1.740, rx: 0.052, rz: 0.052, x: 0.436 },
  { y: 1.500, rx: 0.046, rz: 0.046, x: 0.580 },
  { y: 1.200, rx: 0.044, rz: 0.044, x: 0.660 },
  { y: 1.060, rx: 0.046, rz: 0.046, x: 0.692 },
  { y: 0.960, rx: 0.053, rz: 0.053, x: 0.712 },
  { y: 0.860, rx: 0.046, rz: 0.046, x: 0.730 },
  { y: 0.520, rx: 0.040, rz: 0.040, x: 0.776 },
  { y: 0.180, rx: 0.034, rz: 0.036, x: 0.800 },
  { y: 0.062, rx: 0.028, rz: 0.030, x: 0.802 },
  { y: 0.010, rx: 0.000, rz: 0.000, x: 0.802 },
];

export const LEG_BONES: Ring[] = [
  { y: 0.400, rx: 0.080, rz: 0.080, x: 0.275 },
  { y: 0.100, rx: 0.066, rz: 0.066, x: 0.266 },
  { y: -0.400, rx: 0.058, rz: 0.058, x: 0.245 },
  { y: -0.900, rx: 0.060, rz: 0.060, x: 0.215 },
  { y: -1.080, rx: 0.074, rz: 0.074, x: 0.205 },
  { y: -1.250, rx: 0.062, rz: 0.062, x: 0.199 },
  { y: -1.700, rx: 0.054, rz: 0.054, x: 0.181 },
  { y: -2.300, rx: 0.048, rz: 0.048, x: 0.163 },
  { y: -2.720, rx: 0.054, rz: 0.054, x: 0.152 },
  { y: -2.800, rx: 0.000, rz: 0.000, x: 0.152 },
];

/**
 * Where the dental arch sits inside the head, and how far it is scaled down.
 *
 * The arch is generated at its own scale for the Dental area; the same geometry
 * is reused inside the skull at the skeleton depth, which is what joins
 * dentistry to the rest of the body rather than making it a sixth subject.
 * `tests/carelens-geometry.test.mts` measures the fit — a round arch inside a
 * head that is deeper than it is wide pushes out through the jaw, and that is
 * invisible from the front.
 */
export const NESTED_ARCH = { position: [0, 2.32, 0.02] as const, scale: 0.22 };
