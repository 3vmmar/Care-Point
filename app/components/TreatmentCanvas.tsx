"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

/**
 * CareLens — the consultation model.
 *
 * The previous version stacked four primitives into a rough mannequin: an
 * ellipsoid head, a cone for a nose, a cylinder neck and a squashed sphere for
 * shoulders, all in saturated pink under three coloured lights. It read as a
 * placeholder, and for a reason worth stating plainly — **a literal human head
 * rendered badly is worse than no head at all.** The nearer a synthetic face gets
 * to real without arriving, the more it unsettles, and unsettling is the opposite
 * of what a surgical practice wants a prospective patient to feel.
 *
 * So this is not a better mannequin. It is a different object: a single
 * sculptural bust in polished porcelain, closer to a museum study than to a
 * person. Abstract enough to carry no uncanny weight, anatomical enough to orient
 * someone pointing at where their concern is.
 *
 * Three things do most of the visual work:
 *
 *  1. **A real environment to reflect.** The old scene used
 *     `MeshPhysicalMaterial` with clearcoat but had no environment map, so the
 *     clearcoat had nothing to mirror and the surface resolved flat. A small
 *     studio is now built in code and pre-filtered into an IBL — no asset, no
 *     network request, nothing for the CSP to allow.
 *  2. **One continuous silhouette.** A lathed profile replaces the four stacked
 *     primitives, so head, neck and shoulders are one unbroken surface with no
 *     intersection seams catching the light.
 *  3. **Filmic tone mapping.** Highlights roll off instead of clipping to white,
 *     which is most of the difference between "rendered" and "photographed".
 */

export type CareLensArea = "face" | "nose" | "body" | "breast";

/**
 * Where the camera sits for each area, in spherical terms.
 *
 * The old scene rotated the *model* to face the viewer, which reads as the object
 * turning to be inspected. Moving the camera instead reads as the viewer walking
 * around it — calmer, and it keeps the key light stable on the form.
 */
const VIEWS: Record<CareLensArea, { azimuth: number; elevation: number; distance: number; target: number }> = {
  // Distances are set so the whole silhouette stays inside the frame with
  // headroom. The first pass framed too tightly and cropped the shoulders, which
  // read as a mistake rather than as a crop.
  face: { azimuth: -0.36, elevation: 0.06, distance: 6.4, target: 0.5 },
  nose: { azimuth: 0.66, elevation: 0.02, distance: 5.6, target: 0.62 },
  body: { azimuth: -0.18, elevation: -0.08, distance: 7.4, target: 0.12 },
  breast: { azimuth: -0.5, elevation: -0.04, distance: 6.8, target: 0.24 },
};

/** Surface point each hotspot marks, tuned against the lathe profile below. */
const HOTSPOTS: Record<CareLensArea, [number, number, number]> = {
  face: [-0.26, 0.92, 0.3],
  nose: [0.02, 0.8, 0.34],
  body: [0.34, -0.36, 0.42],
  breast: [-0.24, -0.18, 0.4],
};

/**
 * The bust silhouette, generated rather than hand-listed.
 *
 * The first attempt listed control points by hand and produced two visible
 * defects: the crown pinched to a point, because the apex radius was a literal
 * 0.001 rather than a curve arriving at zero tangentially, and the shoulders
 * belled out like a vase because the flare was linear.
 *
 * Both are solved by describing the form as three continuous curves and sampling
 * them, so every join is tangent-continuous by construction and the lathe has no
 * corner to catch a highlight on.
 *
 * The proportions are deliberately generalised. No brow, no jawline, no features
 * — a form that orients someone pointing at where their concern is, without
 * pretending to be a person.
 */
function buildProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];

  /**
   * Cranium: a superellipse, not a sphere.
   *
   * `n = 2.35` keeps the sides fuller than a circle before they turn, which is
   * what separates a human cranium from an egg. The apex is reached by the curve
   * itself, so the pole closes smoothly.
   */
  const CROWN_TOP = 1.62;
  const HEAD_CENTRE = 1.06;
  const HEAD_HEIGHT = CROWN_TOP - HEAD_CENTRE;
  const HEAD_WIDTH = 0.5;
  const N = 2.35;

  const CRANIUM_STEPS = 26;
  for (let step = 0; step <= CRANIUM_STEPS; step += 1) {
    const t = (step / CRANIUM_STEPS) * (Math.PI / 2);
    const radius = HEAD_WIDTH * Math.pow(Math.sin(t), 2 / N);
    const height = HEAD_CENTRE + HEAD_HEIGHT * Math.pow(Math.cos(t), 2 / N);
    points.push(new THREE.Vector2(radius, height));
  }

  /**
   * Face and jaw: the widest point sits at the temples, then the form tapers.
   * A cubic bezier from the head's equator to the top of the neck, sampled.
   */
  const bezier = (
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    steps: number,
  ) => {
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const u = 1 - t;
      const radius =
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
      const height =
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
      points.push(new THREE.Vector2(radius, height));
    }
  };

  // Temple → jaw → under-chin → neck. The control points keep the jaw taper
  // gentle; a sharp one reads as a chess bishop.
  bezier([HEAD_WIDTH, HEAD_CENTRE], [0.5, 0.84], [0.36, 0.66], [0.215, 0.5], 22);

  // Neck: near-parallel, with the faintest swell. Long enough that the head is
  // clearly carried rather than sitting straight on the shoulders.
  bezier([0.215, 0.5], [0.2, 0.38], [0.198, 0.24], [0.212, 0.1], 12);

  /**
   * Shoulders: the curve that was previously a bell.
   *
   * It leaves the neck almost vertically, turns late, and flattens as it runs
   * out — a trapezius, rather than the skirt of a vase. The final points barely
   * gain radius, which is what stops the silhouette reading as a plinth.
   */
  bezier([0.212, 0.1], [0.28, -0.14], [0.62, -0.26], [0.86, -0.4], 18);
  bezier([0.86, -0.4], [1.0, -0.47], [1.08, -0.56], [1.11, -0.7], 12);

  /**
   * Close the base.
   *
   * A lathe is an open surface, so without this the camera sees straight into the
   * hollow underside of the shoulders — which rendered as a dark, grid-textured
   * ellipse sitting under the bust and read unmistakably as a modelling error.
   * Turning the profile back to the axis caps it.
   */
  bezier([1.11, -0.7], [1.06, -0.79], [0.7, -0.84], [0.0, -0.85], 10);

  return points;
}

/**
 * A studio, rendered once into an environment map.
 *
 * This is what gives the porcelain something to reflect. Two soft boxes and a
 * warm bounce, inside a neutral shell — the same arrangement a photographer would
 * use for a ceramic object, which is exactly the reference.
 *
 * `PMREMGenerator` pre-filters it into the mip chain that physically based
 * materials sample for roughness, so a low-roughness clearcoat picks up a crisp
 * highlight while the body of the form stays soft.
 */
function useStudioEnvironment(): THREE.Texture | null {
  const gl = useThree((state) => state.gl);

  /**
   * Built in a memo rather than in an effect.
   *
   * The map is a pure function of the renderer, and producing it during render
   * means the first frame is already lit — an effect would paint one unlit frame
   * first, which on a pale material is a visible flash.
   */
  const studioEnvironment = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();

    const studio = new THREE.Scene();

    // The shell: a warm off-white room, seen from inside.
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(12, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a2624, side: THREE.BackSide, roughness: 1 }),
    );
    studio.add(shell);

    const softbox = (
      color: number,
      power: number,
      size: [number, number],
      position: [number, number, number],
      lookAt: [number, number, number] = [0, 0, 0],
    ) => {
      const light = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        new THREE.MeshBasicMaterial({ color }),
      );
      light.material.color.multiplyScalar(power);
      light.position.set(...position);
      light.lookAt(...lookAt);
      studio.add(light);
      return light;
    };

    // Key: large, warm, high and to the right — the dominant highlight.
    softbox(0xfff2e2, 5.5, [7, 7], [4.5, 5, 4]);
    // Fill: cooler, opposite side, weak. Stops the shadow side going dead.
    softbox(0xdfe6f0, 1.4, [6, 6], [-5, 1, 3]);
    // Rim: the practice's burgundy, behind and low, so the silhouette separates
    // from the dark backdrop with a colour that belongs to the brand.
    softbox(0x7b263c, 3.2, [5, 3], [-2.5, -1.5, -4.5]);
    // Bounce: champagne, below, mimicking light off a pale surface.
    softbox(0xc9af86, 1.1, [6, 4], [0, -4.5, 1.5]);

    const target = pmrem.fromScene(studio, 0.02);
    pmrem.dispose();

    // The studio itself is transient, but its geometry and materials are ours to
    // free — the pre-filtered result is all that outlives this function.
    studio.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });

    return target;
  }, [gl]);

  useEffect(() => () => studioEnvironment.dispose(), [studioEnvironment]);

  return studioEnvironment.texture;
}

function Bust({
  selected,
  reducedMotion,
  environment,
}: {
  selected: CareLensArea;
  reducedMotion: boolean;
  environment: THREE.Texture | null;
}) {
  const group = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const { pointer } = useThree();

  const geometry = useMemo(() => {
    // 128 radial segments: smooth enough that the silhouette has no facets at this
    // camera distance, cheap enough to stay well inside the frame budget.
    const lathe = new THREE.LatheGeometry(buildProfile(), 128);
    lathe.computeVertexNormals();
    return lathe;
  }, []);

  // Front-to-back flattening. A perfectly round bust reads as a chess piece; a
  // shallower one reads as a body without needing any actual anatomy.
  const flatten = useMemo(() => new THREE.Vector3(1, 1, 0.74), []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, delta) => {
    if (!group.current) return;

    if (!reducedMotion) {
      // A breath, not a spin. Barely perceptible, and it stops the object reading
      // as a static screenshot.
      group.current.position.y = Math.sin(state.clock.elapsedTime * 0.55) * 0.018;
      // Parallax on the pointer, heavily damped, clamped small: enough that the
      // form feels present, not enough to become a toy.
      group.current.rotation.y = THREE.MathUtils.damp(
        group.current.rotation.y,
        pointer.x * 0.1,
        2.2,
        delta,
      );
      group.current.rotation.x = THREE.MathUtils.damp(
        group.current.rotation.x,
        pointer.y * 0.045,
        2.2,
        delta,
      );
    }

    // The hotspot pulses on a slow sine. Opacity rather than scale, so it reads
    // as a signal rather than as something inflating.
    if (halo.current && !reducedMotion) {
      const pulse = (Math.sin(state.clock.elapsedTime * 1.6) + 1) / 2;
      const material = halo.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.25 + pulse * 0.4;
      halo.current.scale.setScalar(1 + pulse * 0.18);
    }
    if (core.current) core.current.lookAt(state.camera.position);
    if (halo.current) halo.current.lookAt(state.camera.position);
  });

  const hotspot = HOTSPOTS[selected];

  return (
    <group ref={group}>
      <mesh geometry={geometry} scale={flatten} castShadow>
        <meshPhysicalMaterial
          /**
           * Porcelain, not skin.
           *
           * A pale warm body with a clear lacquer over it. Skin tones were the old
           * scene's mistake: they invite the eye to look for a face, and then find
           * a cone where the nose should be.
           */
          color="#e9e2d8"
          roughness={0.42}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.14}
          reflectivity={0.5}
          // Attached to the material rather than the scene: only this surface is
          // meant to mirror the studio, and setting it here says so.
          envMap={environment}
          envMapIntensity={1.15}
        />
      </mesh>

      {/**
       * The measurement contour.
       *
       * A wireframe of the *same* geometry, fractionally inflated, at very low
       * opacity — so the lines follow the surface exactly instead of floating off
       * it the way the old separate low-poly sphere did.
       */}
      <mesh geometry={geometry} scale={flatten.clone().multiplyScalar(1.004)}>
        {/**
         * Barely there on purpose.
         *
         * At 0.055 the lathe rings read as 3D-print layer lines, which is the one
         * association this surface must not carry. This is low enough to register
         * as a measurement grid only when the light catches it.
         */}
        <meshBasicMaterial
          color="#c9af86"
          wireframe
          transparent
          opacity={0.022}
          depthWrite={false}
        />
      </mesh>

      {/* Hotspot: a thin ring, a soft halo and a bright core, always facing the
          camera so it reads as an annotation on the image rather than a bead
          stuck to the model. */}
      <group position={hotspot}>
        <mesh ref={halo}>
          <ringGeometry args={[0.085, 0.115, 64]} />
          <meshBasicMaterial
            color="#f6e7cd"
            transparent
            opacity={0.45}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh ref={core}>
          <circleGeometry args={[0.028, 32]} />
          <meshBasicMaterial color="#fffaf0" depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * A soft shadow beneath the form.
 *
 * Not a real shadow map — a radial gradient on a plane costs nothing and reads
 * better at this scale than a low-resolution depth map would. Its only job is to
 * stop the bust floating.
 */
function ContactShadow() {
  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2,
      );
      gradient.addColorStop(0, "rgba(0,0,0,0.5)");
      gradient.addColorStop(0.55, "rgba(0,0,0,0.18)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={[0, -0.88, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[5.4, 4.2]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} opacity={0.85} />
    </mesh>
  );
}

/**
 * Moves the camera between areas.
 *
 * Critically damped rather than eased over a fixed duration, so switching area
 * mid-move redirects smoothly instead of restarting. `damp` is framerate
 * independent, which matters because this runs at whatever rate the device gives.
 */
function CameraRig({
  selected,
  reducedMotion,
}: {
  selected: CareLensArea;
  reducedMotion: boolean;
}) {
  const lookTarget = useRef(new THREE.Vector3(0, VIEWS[selected].target, 0));

  useFrame((state, delta) => {
    const { azimuth, elevation, distance, target } = VIEWS[selected];
    const desired = new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance + target,
      Math.cos(azimuth) * Math.cos(elevation) * distance,
    );

    if (reducedMotion) {
      state.camera.position.copy(desired);
      lookTarget.current.set(0, target, 0);
    } else {
      state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, desired.x, 2.4, delta);
      state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, desired.y, 2.4, delta);
      state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, desired.z, 2.4, delta);
      lookTarget.current.y = THREE.MathUtils.damp(lookTarget.current.y, target, 2.4, delta);
    }
    state.camera.lookAt(lookTarget.current);
  });

  return null;
}

function Scene({
  selected,
  reducedMotion,
}: {
  selected: CareLensArea;
  reducedMotion: boolean;
}) {
  const environment = useStudioEnvironment();

  return (
    <>
      {/**
       * The environment map does the lighting. These three are shaping light on
       * top of it — without an IBL underneath they would be doing all the work,
       * which is what made the old scene look like a plastic toy.
       */}
      <ambientLight intensity={0.18} />
      <directionalLight position={[3.2, 4.4, 3.6]} intensity={1.5} color="#fff4e6" />
      <directionalLight position={[-3.6, 0.6, -2.4]} intensity={0.9} color="#b46978" />
      <ContactShadow />
      <Bust selected={selected} reducedMotion={reducedMotion} environment={environment} />
      <CameraRig selected={selected} reducedMotion={reducedMotion} />
    </>
  );
}

/** Keep a WebGL failure local to the optional visual, never the care content. */
class CanvasBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("CareLens scene failed to render", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function TreatmentCanvas({
  selected,
  rtl,
}: {
  selected: CareLensArea;
  rtl: boolean;
}) {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <CanvasBoundary
      fallback={
        <div className="universe-fallback" role="status">
          <strong>{rtl ? "كير لِنز" : "CareLens"}</strong>
          <p>
            {rtl
              ? "لا يدعم هذا الجهاز العرض ثلاثي الأبعاد. يمكنك متابعة استكشاف المناطق والخيارات بالكامل."
              : "This device cannot display the 3D scene. You can still explore every area and option below."}
          </p>
        </div>
      }
    >
      <Canvas
        camera={{ position: [-2.2, 1.0, 6.0], fov: 32 }}
        /**
         * Capped at 1.75 rather than the device's full ratio. On a 3× phone the
         * difference is invisible on a form this smooth and costs nine times the
         * fragments of 1×.
         */
        dpr={[1, 1.75]}
        /**
         * With motion reduced the scene is a still image, so the loop runs once
         * per state change instead of sixty times a second. The camera rig snaps
         * rather than damps in that mode, so one frame is all it needs.
         */
        frameloop={reducedMotion ? "demand" : "always"}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          // Filmic roll-off. Without it the clearcoat highlight clips to a flat
          // white disc, which is the single most "computer graphics" artefact
          // available.
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        aria-hidden
      >
        <Scene selected={selected} reducedMotion={reducedMotion} />
      </Canvas>
    </CanvasBoundary>
  );
}
