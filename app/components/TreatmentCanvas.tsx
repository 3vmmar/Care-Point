"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { AreaId, LayerId, Region } from "@/lib/anatomy";
import {
  ARCH,
  BONE,
  BUST_FLATTEN,
  GUM,
  NESTED_ARCH,
  buildArchLayout,
  buildCranium,
  buildProfile,
  buildRidge,
  buildTooth,
} from "@/lib/carelens-geometry";

/**
 * CareLens — the consultation model.
 *
 * ## What this is, and what it deliberately is not
 *
 * Every vertex here is generated in code. There is no glTF, no Draco decoder,
 * and no external asset — the CSP forbids the fetch and the project has no
 * model pipeline. So this cannot be, and does not claim to be, an anatomically
 * exact rendering. It is a **study model**: accurate enough that a patient can
 * point at where their concern is, abstract enough that it never pretends to be
 * a photograph of a person.
 *
 * That abstraction is a choice, not only a constraint. A realistic human face
 * rendered imperfectly is worse than no face at all — the nearer a synthetic
 * face gets to real without arriving, the more it unsettles, and unsettling is
 * the opposite of what a surgical practice wants a prospective patient to feel.
 *
 * ## Three things do most of the visual work
 *
 *  1. **A real environment to reflect.** A small studio is built in code and
 *     pre-filtered into an IBL, so the clearcoat has something to mirror.
 *  2. **One continuous silhouette.** A lathed profile, so head, neck and
 *     shoulders are one unbroken surface with no intersection seams.
 *  3. **Filmic tone mapping.** Highlights roll off instead of clipping, which
 *     is most of the difference between "rendered" and "photographed".
 *
 * ## The dental arch is load-bearing twice
 *
 * `buildArch` generates the model for the Dental area — and the same geometry
 * sits inside the skull at the skeleton layer of every other area. Dentistry is
 * not a fifth tab beside four others; it is the part of the same body that the
 * other four views happen to be looking past.
 */

export type CareLensArea = AreaId;
export type AnatomyTissue = "skin" | "muscles" | "fat" | "vessels" | "ligaments" | "nerves" | "skeleton";

/* ══ Lighting ══════════════════════════════════════════════════════════════ */

/**
 * A studio, rendered once into an environment map.
 *
 * This is what gives the surfaces something to reflect: two soft boxes and a
 * warm bounce inside a neutral shell, the arrangement a photographer would use
 * for a ceramic object. `PMREMGenerator` pre-filters it into the mip chain that
 * physically based materials sample for roughness, so a low-roughness clearcoat
 * picks up a crisp highlight while the body of the form stays soft.
 */
function useStudioEnvironment(): THREE.Texture | null {
  const gl = useThree((state) => state.gl);

  // Built in a memo rather than an effect: the map is a pure function of the
  // renderer, and producing it during render means the first frame is already
  // lit. An effect would paint one unlit frame first, which on a pale material
  // is a visible flash.
  const studioEnvironment = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();

    const studio = new THREE.Scene();
    studio.add(new THREE.Mesh(
      new THREE.BoxGeometry(12, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a2624, side: THREE.BackSide, roughness: 1 }),
    ));

    const softbox = (
      color: number, power: number,
      size: [number, number], position: [number, number, number],
    ) => {
      const light = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        new THREE.MeshBasicMaterial({ color }),
      );
      light.material.color.multiplyScalar(power);
      light.position.set(...position);
      light.lookAt(0, 0, 0);
      studio.add(light);
    };

    softbox(0xfff2e2, 5.5, [7, 7], [4.5, 5, 4]);       // key
    softbox(0xdfe6f0, 1.4, [6, 6], [-5, 1, 3]);        // fill
    softbox(0x7b263c, 3.2, [5, 3], [-2.5, -1.5, -4.5]); // brand rim
    softbox(0xc9af86, 1.1, [6, 4], [0, -4.5, 1.5]);     // bounce

    const target = pmrem.fromScene(studio, 0.02);
    pmrem.dispose();

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

/* ══ Layer opacity ═════════════════════════════════════════════════════════ */

/**
 * How visible each shell is at each depth.
 *
 * Cutting a layer never hides it outright. The outer form drops to a ghost so
 * the viewer keeps their bearings — an inner structure floating with no
 * silhouette around it is disorienting, and a patient who loses the outline
 * loses the point of the picture.
 */
const SHELL_OPACITY: Record<LayerId, { surface: number; structure: number; skeleton: number }> = {
  surface:   { surface: 1.0,  structure: 0.0,  skeleton: 0.0 },
  structure: { surface: 0.16, structure: 1.0,  skeleton: 0.0 },
  skeleton:  { surface: 0.07, structure: 0.14, skeleton: 1.0 },
};

/** Critically damped fade, so switching layer mid-fade redirects rather than restarts. */
function useFade(target: number, reducedMotion: boolean) {
  const value = useRef(target);
  useFrame((_, delta) => {
    value.current = reducedMotion
      ? target
      : THREE.MathUtils.damp(value.current, target, 4.5, delta);
  });
  return value;
}

function FadingMesh({
  geometry, opacity, reducedMotion, children, ...props
}: {
  geometry: THREE.BufferGeometry;
  opacity: number;
  reducedMotion: boolean;
  children: ReactNode;
} & Record<string, unknown>) {
  const mesh = useRef<THREE.Mesh>(null);
  const fade = useFade(opacity, reducedMotion);

  useFrame(() => {
    const node = mesh.current;
    if (!node) return;
    const material = node.material as THREE.Material;
    material.opacity = fade.current;
    // A fully transparent mesh still costs a draw call and still writes to the
    // depth buffer's sort order. Below a threshold it is cheaper and cleaner to
    // remove it from the frame entirely.
    node.visible = fade.current > 0.012;
  });

  return (
    <mesh ref={mesh} geometry={geometry} {...props}>
      {children}
    </mesh>
  );
}

/* ══ Hotspots ══════════════════════════════════════════════════════════════ */

function Hotspot({
  region, active, reducedMotion, onSelect,
}: {
  region: Region;
  active: boolean;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const hovered = useRef(false);
  const scale = useRef(active ? 1 : 0.72);

  useFrame((state, delta) => {
    // Always face the camera, so a marker reads as an annotation on the image
    // rather than a bead stuck to the surface.
    if (core.current) core.current.lookAt(state.camera.position);
    if (halo.current) halo.current.lookAt(state.camera.position);

    const wanted = active ? 1 : hovered.current ? 0.92 : 0.72;
    scale.current = reducedMotion
      ? wanted
      : THREE.MathUtils.damp(scale.current, wanted, 9, delta);
    group.current?.scale.setScalar(scale.current);

    if (halo.current) {
      const material = halo.current.material as THREE.MeshBasicMaterial;
      if (active && !reducedMotion) {
        const pulse = (Math.sin(state.clock.elapsedTime * 1.6) + 1) / 2;
        material.opacity = 0.3 + pulse * 0.4;
      } else {
        material.opacity = active ? 0.6 : hovered.current ? 0.5 : 0.26;
      }
    }
  });

  return (
    <group ref={group} position={region.at}>
      {/* An invisible disc, larger than the visible mark, so the pointer target
          is comfortable without the graphic having to be. */}
      <mesh
        onPointerOver={(event) => { event.stopPropagation(); hovered.current = true; }}
        onPointerOut={() => { hovered.current = false; }}
        onClick={(event) => { event.stopPropagation(); onSelect(region.id); }}
      >
        <circleGeometry args={[0.16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={halo}>
        <ringGeometry args={[0.075, 0.1, 48]} />
        <meshBasicMaterial
          color={active ? "#f6e7cd" : "#c9af86"}
          transparent opacity={0.4} depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={core}>
        <circleGeometry args={[0.026, 24]} />
        <meshBasicMaterial color="#fffaf0" depthWrite={false} transparent />
      </mesh>
    </group>
  );
}

/* ══ Models ════════════════════════════════════════════════════════════════ */

function DentalArch({
  layer, reducedMotion, environment, activeTooth, onTooth, dim = false,
}: {
  layer: LayerId;
  reducedMotion: boolean;
  environment: THREE.Texture | null;
  activeTooth?: string | null;
  onTooth?: (key: string, fdi: number) => void;
  /** Inside the skull the arch is scenery, not a control. */
  dim?: boolean;
}) {
  const placements = useMemo(() => buildArchLayout(), []);

  // One geometry per class, shared across every tooth of that class. Twenty-eight
  // separate geometries would be twenty-eight uploads for four distinct shapes.
  const toothGeometry = useMemo(() => ({
    incisor: buildTooth("incisor"),
    canine: buildTooth("canine"),
    premolar: buildTooth("premolar"),
    molar: buildTooth("molar"),
  }), []);

  const gums = useMemo(() => ({
    upper: buildRidge(ARCH.upper.radiusX, ARCH.upper.radiusZ, GUM.upper.radius),
    lower: buildRidge(ARCH.lower.radiusX, ARCH.lower.radiusZ, GUM.lower.radius),
  }), []);

  const bone = useMemo(() => ({
    upper: buildRidge(ARCH.upper.radiusX, ARCH.upper.radiusZ, BONE.upper.radius),
    lower: buildRidge(ARCH.lower.radiusX, ARCH.lower.radiusZ, BONE.lower.radius),
  }), []);

  useEffect(() => () => {
    Object.values(toothGeometry).forEach((geometry) => geometry.dispose());
    Object.values(gums).forEach((geometry) => geometry.dispose());
    Object.values(bone).forEach((geometry) => geometry.dispose());
  }, [toothGeometry, gums, bone]);

  const shell = SHELL_OPACITY[layer];

  return (
    <group>
      {/* Bone first: it sits behind everything and should never occlude a tooth. */}
      {(["upper", "lower"] as const).map((jaw) => (
        <FadingMesh
          key={`bone-${jaw}`}
          geometry={bone[jaw]}
          opacity={shell.skeleton * (dim ? 0.5 : 1)}
          reducedMotion={reducedMotion}
          position={[0, BONE[jaw].y, 0]}
          scale={[1, BONE[jaw].yScale, 1]}
        >
          <meshPhysicalMaterial
            color="#d9cdb6" roughness={0.78} metalness={0}
            transparent envMap={environment} envMapIntensity={0.5}
            depthWrite={layer === "skeleton"}
          />
        </FadingMesh>
      ))}

      {(["upper", "lower"] as const).map((jaw) => (
        <FadingMesh
          key={`gum-${jaw}`}
          geometry={gums[jaw]}
          /**
           * Opaque at the surface, translucent once the viewer cuts deeper.
           *
           * This is what makes the "Roots and gums" depth mean anything: the
           * gum has to stop hiding the roots it covers, without vanishing and
           * leaving the teeth floating unattached.
           */
          opacity={(layer === "surface" ? 1 : layer === "structure" ? 0.26 : 0.14) * (dim ? 0.4 : 1)}
          reducedMotion={reducedMotion}
          position={[0, GUM[jaw].y, 0]}
          scale={[1, GUM[jaw].yScale, 1]}
        >
          {/**
           * Gum, not gum-coloured plastic. A high-clearcoat pink reads as a
           * denture; a matte, slightly translucent one reads as tissue.
           */}
          <meshPhysicalMaterial
            color="#b4707a" roughness={0.62} metalness={0}
            clearcoat={0.35} clearcoatRoughness={0.5}
            transparent envMap={environment} envMapIntensity={0.65}
            /**
             * A translucent surface that still writes depth hides whatever is
             * behind it. Leaving this on made the "Roots and gums" depth show a
             * see-through gum with no roots inside — the fade worked and the
             * reveal did not, which looked like the layer simply doing nothing.
             */
            depthWrite={layer === "surface"}
          />
        </FadingMesh>
      ))}

      {placements.map((tooth) => {
        const selected = activeTooth === tooth.key;
        return (
          <group key={tooth.key} position={tooth.position} rotation={tooth.rotation}>
            <mesh
              geometry={toothGeometry[tooth.toothClass]}
              onClick={onTooth
                ? (event) => { event.stopPropagation(); onTooth(tooth.key, tooth.fdi); }
                : undefined}
            >
              {/**
               * Enamel. The clearcoat is what sells it — a tooth is a slightly
               * translucent body under a hard glossy shell, and without the
               * second layer it renders as chalk.
               */}
              <meshPhysicalMaterial
                color={selected ? "#fffdf6" : "#f3ece0"}
                roughness={0.24}
                metalness={0}
                clearcoat={1}
                clearcoatRoughness={0.07}
                reflectivity={0.62}
                emissive={selected ? "#7b263c" : "#000000"}
                emissiveIntensity={selected ? 0.22 : 0}
                envMap={environment}
                envMapIntensity={dim ? 0.6 : 1.25}
                transparent
                opacity={dim ? 0.55 : 1}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Bust({
  layer, tissue, reducedMotion, environment,
}: {
  layer: LayerId;
  tissue: AnatomyTissue;
  reducedMotion: boolean;
  environment: THREE.Texture | null;
}) {
  const surface = useMemo(() => {
    const lathe = new THREE.LatheGeometry(buildProfile(0), 128);
    lathe.computeVertexNormals();
    return lathe;
  }, []);

  const structure = useMemo(() => {
    // 96 segments rather than 128: it is never the outermost silhouette, so the
    // facets it saves are facets nobody can see.
    const lathe = new THREE.LatheGeometry(buildProfile(0.035), 96);
    lathe.computeVertexNormals();
    return lathe;
  }, []);

  const cranium = useMemo(() => buildCranium(), []);

  const accents = useMemo(() => ({
    chest: new THREE.SphereGeometry(1, 64, 40),
    arm: new THREE.SphereGeometry(1, 48, 32),
    hair: new THREE.SphereGeometry(1, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.6),
    bun: new THREE.SphereGeometry(1, 48, 32),
  }), []);

  useEffect(() => () => {
    surface.dispose();
    structure.dispose();
    cranium.dispose();
    Object.values(accents).forEach((geometry) => geometry.dispose());
  }, [surface, structure, cranium, accents]);

  // Front-to-back flattening. A perfectly round bust reads as a chess piece; a
  // shallower one reads as a body without needing any actual anatomy.
  const flatten = useMemo(
    () => new THREE.Vector3(BUST_FLATTEN.x, BUST_FLATTEN.y, BUST_FLATTEN.z),
    [],
  );
  const shell = SHELL_OPACITY[layer];
  const tissueStyle: Record<AnatomyTissue, { color: string; sheen: string }> = {
    skin: { color: "#b77f69", sheen: "#d7a18c" },
    muscles: { color: "#a34f54", sheen: "#d5827d" },
    fat: { color: "#d2a76f", sheen: "#f0cf99" },
    vessels: { color: "#8b4054", sheen: "#c4687e" },
    ligaments: { color: "#b8a27f", sheen: "#dfcca5" },
    nerves: { color: "#c5a94d", sheen: "#f0d975" },
    skeleton: { color: "#d8ccb6", sheen: "#eee2ca" },
  };
  const activeTissue = tissueStyle[tissue];

  return (
    <group>
      <FadingMesh
        geometry={surface}
        opacity={shell.surface}
        reducedMotion={reducedMotion}
        scale={flatten}
      >
        <meshPhysicalMaterial
          color="#b77f69" roughness={0.54} metalness={0}
          clearcoat={0.35} clearcoatRoughness={0.48} reflectivity={0.42}
          sheen={0.28} sheenColor="#d7a18c"
          envMap={environment} envMapIntensity={0.92}
          transparent depthWrite={layer === "surface"}
        />
      </FadingMesh>

      {/* Secondary forms turn the continuous silhouette into a recognisable
          upper torso without splitting the primary skin shell. They share the
          exact same material response, so the joins read as soft anatomy rather
          than separate primitives under the studio lighting. */}
      {[
        { key: "left-chest", position: [-0.39, -0.76, 0.64], scale: [0.43, 0.32, 0.31] },
        { key: "right-chest", position: [0.39, -0.76, 0.64], scale: [0.43, 0.32, 0.31] },
      ].map((part) => (
        <FadingMesh
          key={part.key}
          geometry={accents.chest}
          opacity={shell.surface}
          reducedMotion={reducedMotion}
          position={part.position}
          scale={part.scale}
        >
          <meshPhysicalMaterial
            color="#b77f69" roughness={0.56} metalness={0}
            clearcoat={0.3} clearcoatRoughness={0.5}
            sheen={0.25} sheenColor="#d7a18c"
            envMap={environment} envMapIntensity={0.88}
            transparent depthWrite={layer === "surface"}
          />
        </FadingMesh>
      ))}

      {[
        { key: "left-arm", position: [-1.02, -1.05, -0.02], rotation: [0, 0, -0.13] },
        { key: "right-arm", position: [1.02, -1.05, -0.02], rotation: [0, 0, 0.13] },
      ].map((part) => (
        <FadingMesh
          key={part.key}
          geometry={accents.arm}
          opacity={shell.surface}
          reducedMotion={reducedMotion}
          position={part.position}
          rotation={part.rotation}
          scale={[0.23, 0.82, 0.28]}
        >
          <meshPhysicalMaterial
            color="#b77f69" roughness={0.57} metalness={0}
            clearcoat={0.28} clearcoatRoughness={0.52}
            sheen={0.24} sheenColor="#d7a18c"
            envMap={environment} envMapIntensity={0.84}
            transparent depthWrite={layer === "surface"}
          />
        </FadingMesh>
      ))}

      <FadingMesh
        geometry={accents.hair}
        opacity={shell.surface}
        reducedMotion={reducedMotion}
        position={[0, 1.26, -0.04]}
        scale={[0.54, 0.58, 0.43]}
      >
        <meshPhysicalMaterial
          color="#2a201c" roughness={0.72} metalness={0}
          sheen={0.78} sheenColor="#6c5147"
          envMap={environment} envMapIntensity={0.45}
          transparent depthWrite={layer === "surface"}
        />
      </FadingMesh>

      <FadingMesh
        geometry={accents.bun}
        opacity={shell.surface}
        reducedMotion={reducedMotion}
        position={[0.18, 1.56, -0.31]}
        scale={[0.25, 0.22, 0.2]}
      >
        <meshPhysicalMaterial
          color="#241b18" roughness={0.75} metalness={0}
          sheen={0.7} sheenColor="#684c43"
          envMap={environment} envMapIntensity={0.42}
          transparent depthWrite={layer === "surface"}
        />
      </FadingMesh>

      {layer === "surface" && (
        <>
          <mesh position={[0, 1.06, 0.39]} rotation={[Math.PI / 2, 0, 0]} scale={[0.1, 0.18, 0.1]}>
            <coneGeometry args={[1, 1, 32]} />
            <meshPhysicalMaterial color="#b9826c" roughness={0.58} envMap={environment} envMapIntensity={0.82} />
          </mesh>
          {[-0.17, 0.17].map((x) => (
            <mesh key={x} position={[x, 1.17, 0.382]} scale={[0.075, 0.035, 0.018]}>
              <sphereGeometry args={[1, 32, 18]} />
              <meshPhysicalMaterial color="#3b2d28" roughness={0.38} envMap={environment} envMapIntensity={0.7} />
            </mesh>
          ))}
          <mesh position={[0, 0.92, 0.382]} scale={[0.13, 0.025, 0.018]}>
            <sphereGeometry args={[1, 32, 16]} />
            <meshPhysicalMaterial color="#8d4f4c" roughness={0.5} envMap={environment} envMapIntensity={0.55} />
          </mesh>
          <mesh position={[0, -1.76, 0.455]}>
            <torusGeometry args={[0.035, 0.009, 10, 32]} />
            <meshBasicMaterial color="#7b5448" transparent opacity={0.72} />
          </mesh>
        </>
      )}

      <FadingMesh
        geometry={structure}
        opacity={shell.structure}
        reducedMotion={reducedMotion}
        scale={flatten}
      >
        {/**
         * The supporting form. Warmer and far rougher than the surface, so the
         * two never read as the same material seen twice.
         */}
        <meshPhysicalMaterial
          color={activeTissue.color} roughness={0.76} metalness={0}
          sheen={0.42} sheenColor={activeTissue.sheen}
          envMap={environment} envMapIntensity={0.55}
          transparent depthWrite={layer === "structure"}
        />
      </FadingMesh>

      <FadingMesh
        geometry={cranium}
        opacity={shell.skeleton}
        reducedMotion={reducedMotion}
        scale={flatten}
      >
        <meshPhysicalMaterial
          color="#ded2bd" roughness={0.74} metalness={0}
          envMap={environment} envMapIntensity={0.6}
          transparent depthWrite={layer === "skeleton"}
        />
      </FadingMesh>

      {/**
       * The same arch that the Dental area shows, sitting where a jaw is.
       *
       * This is the join between the five areas: dentistry is not a fifth
       * subject beside four others, it is the part of one body that the other
       * four views are looking past.
       */}
      {layer === "skeleton" && (
        <group
          position={NESTED_ARCH.position}
          /**
           * Squashed with the head, not merely shrunk inside it.
           *
           * The arch is round and the head is flattened front-to-back, so a
           * uniform scale let the molars push out through the jaw — about 3mm
           * in model units, invisible head-on and obvious in profile. Caught by
           * `tests/carelens-geometry.test.mts`, which measures the fit rather
           * than trusting a screenshot taken from one angle.
           */
          scale={[
            NESTED_ARCH.scale,
            NESTED_ARCH.scale,
            NESTED_ARCH.scale * BUST_FLATTEN.z,
          ]}
        >
          <DentalArch
            layer="skeleton"
            reducedMotion={reducedMotion}
            environment={environment}
            dim
          />
        </group>
      )}

      {/**
       * The measurement contour: a wireframe of the same surface geometry,
       * fractionally inflated. At 0.055 the lathe rings read as 3D-print layer
       * lines, which is the one association this must not carry.
       */}
      {layer === "surface" && (
        <mesh geometry={surface} scale={flatten.clone().multiplyScalar(1.004)}>
          <meshBasicMaterial color="#c9af86" wireframe transparent opacity={0.022} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/* ══ Shadow ════════════════════════════════════════════════════════════════ */

/**
 * A soft shadow beneath the form.
 *
 * Not a shadow map — a radial gradient on a plane costs nothing and reads
 * better at this scale than a low-resolution depth buffer would. Its only job
 * is to stop the model floating.
 */
function ContactShadow({ y, size }: { y: number; size: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, "rgba(0,0,0,0.5)");
      gradient.addColorStop(0.55, "rgba(0,0,0,0.18)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 256, 256);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size, size * 0.78]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} opacity={0.85} />
    </mesh>
  );
}

/* ══ Camera ════════════════════════════════════════════════════════════════ */

export type Framing = { azimuth: number; elevation: number; distance: number; target: number };

type OrbitState = {
  azimuth: number;
  elevation: number;
  distance: number;
  /** True once the viewer has moved the camera themselves. */
  engaged: boolean;
};

const MIN_DISTANCE = 2.6;
const MAX_DISTANCE = 11;

/**
 * Orbit, zoom, and a framing the view can return to.
 *
 * Hand-rolled rather than pulled from `drei`, which is not a dependency here
 * and would cost more than this does. It also lets the two behaviours coexist
 * properly: the camera flies to a framing when the area changes, and hands
 * control over the moment the user drags — without the fight for the camera
 * that mixing a tween with a controller usually produces.
 *
 * The listeners live here rather than on the `<Canvas>` element, and the orbit
 * state is a ref owned by this component. An earlier version passed the ref
 * down as a prop and mutated it from the frame loop; the React compiler
 * rejected that, correctly — a component that mutates something it was handed
 * cannot be reasoned about, and the fix was to give the mutation and the state
 * the same owner rather than to silence the rule.
 *
 * Damping is critical rather than time-based, so a drag mid-flight redirects
 * smoothly instead of snapping or restarting.
 */
function CameraRig({
  area, framing, reducedMotion, onEngage,
}: {
  area: AreaId;
  framing: Framing;
  reducedMotion: boolean;
  onEngage?: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const look = useRef(new THREE.Vector3(0, framing.target, 0));
  const engagedOnce = useRef(false);

  /**
   * Held in a ref so the listeners are registered once.
   *
   * The callback is rebuilt on every parent render. Depending on it directly
   * tore the listeners down and rebuilt them mid-gesture — and the in-flight
   * pointer lived in that closure, so any re-render during a drag (selecting a
   * region, for one) silently ended the drag.
   */
  const engageCallback = useRef(onEngage);
  useEffect(() => {
    engageCallback.current = onEngage;
  }, [onEngage]);

  const orbit = useRef<OrbitState>({
    azimuth: framing.azimuth,
    elevation: framing.elevation,
    distance: framing.distance,
    engaged: false,
  });

  // Changing area re-frames the model. Without this the camera would stay
  // wherever the viewer last left it and the new area would open off-centre,
  // which reads as a bug rather than as continuity.
  useEffect(() => {
    orbit.current.engaged = false;
  }, [area]);

  useEffect(() => {
    const element = gl.domElement;
    let pointer: { id: number; x: number; y: number } | null = null;

    const take = () => {
      orbit.current.engaged = true;
      if (!engagedOnce.current) {
        engagedOnce.current = true;
        engageCallback.current?.();
      }
      // Under reduced motion the loop runs on demand, so interaction has to ask
      // for the frames it needs or the model simply will not move.
      invalidate();
    };

    const down = (event: PointerEvent) => {
      // Only a primary drag orbits. Right-click belongs to the browser, and
      // stealing it to pan is a nuisance on a marketing page.
      if (event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture?.(event.pointerId);
    };

    const move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;

      take();
      orbit.current.azimuth -= dx * 0.007;
      // Clamped short of the poles: passing over the crown inverts the horizon,
      // and there is nothing up there worth seeing.
      orbit.current.elevation = THREE.MathUtils.clamp(
        orbit.current.elevation + dy * 0.006, -0.75, 0.95,
      );
    };

    const up = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = null;
    };

    const wheel = (event: WheelEvent) => {
      // The page must still scroll past a scene that fills the viewport, so the
      // wheel only zooms once the viewer has shown intent by dragging.
      if (!orbit.current.engaged) return;
      event.preventDefault();
      take();
      orbit.current.distance = THREE.MathUtils.clamp(
        orbit.current.distance + event.deltaY * 0.0035, MIN_DISTANCE, MAX_DISTANCE,
      );
    };

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("wheel", wheel, { passive: false });

    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("wheel", wheel);
    };
  }, [gl, invalidate]);

  useFrame((state, delta) => {
    const current = orbit.current;

    // While the area's framing is authoritative, drive the orbit state toward
    // it. Once the viewer has taken hold, their values are the truth.
    if (!current.engaged) {
      current.azimuth = framing.azimuth;
      current.elevation = framing.elevation;
      current.distance = framing.distance;
    }

    const desired = new THREE.Vector3(
      Math.sin(current.azimuth) * Math.cos(current.elevation) * current.distance,
      Math.sin(current.elevation) * current.distance + framing.target,
      Math.cos(current.azimuth) * Math.cos(current.elevation) * current.distance,
    );

    if (reducedMotion) {
      state.camera.position.copy(desired);
      look.current.set(0, framing.target, 0);
    } else {
      // Weight, deliberately. 2.4 is slow enough that a re-frame reads as a
      // considered move rather than a cut; a drag tracks faster so the model
      // does not feel like it is lagging behind the hand.
      const rate = current.engaged ? 9 : 2.4;
      state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, desired.x, rate, delta);
      state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, desired.y, rate, delta);
      state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, desired.z, rate, delta);
      look.current.y = THREE.MathUtils.damp(look.current.y, framing.target, 2.4, delta);
    }
    state.camera.lookAt(look.current);
  });

  return null;
}

/* ══ Scene ═════════════════════════════════════════════════════════════════ */

function Scene({
  area, layer, tissue, framing, regions, activeRegion, activeTooth, reducedMotion,
  onSelect, onTooth, onEngage,
}: {
  area: AreaId;
  layer: LayerId;
  tissue: AnatomyTissue;
  framing: Framing;
  regions: Region[];
  activeRegion: string | null;
  activeTooth: string | null;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
  onTooth: (key: string) => void;
  onEngage?: () => void;
}) {
  const environment = useStudioEnvironment();
  const dental = area === "dental";

  return (
    <>
      {/* The environment map does the lighting. These are shaping light on top
          of it — without an IBL underneath they would be doing all the work,
          which is what makes a scene look like a plastic toy. */}
      <ambientLight intensity={0.18} />
      <directionalLight position={[3.2, 4.4, 3.6]} intensity={1.5} color="#fff4e6" />
      <directionalLight position={[-3.6, 0.6, -2.4]} intensity={0.9} color="#b46978" />

      <ContactShadow y={dental ? -0.72 : -2.22} size={dental ? 3.6 : 5.4} />

      {dental ? (
        <DentalArch
          layer={layer}
          reducedMotion={reducedMotion}
          environment={environment}
          activeTooth={activeTooth}
          onTooth={(key) => onTooth(key)}
        />
      ) : (
        <Bust layer={layer} tissue={tissue} reducedMotion={reducedMotion} environment={environment} />
      )}

      {regions.map((region) => (
        <Hotspot
          key={region.id}
          region={region}
          active={activeRegion === region.id}
          reducedMotion={reducedMotion}
          onSelect={onSelect}
        />
      ))}

      <CameraRig
        area={area}
        framing={framing}
        reducedMotion={reducedMotion}
        onEngage={onEngage}
      />
    </>
  );
}

/** Keep a WebGL failure local to the optional visual, never the care content. */
class CanvasBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("CareLens scene failed to render", error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function TreatmentCanvas({
  area, layer, tissue, framing, regions, activeRegion, rtl, onSelect, onTooth, onEngage,
}: {
  area: AreaId;
  layer: LayerId;
  tissue: AnatomyTissue;
  framing: Framing;
  regions: Region[];
  activeRegion: string | null;
  rtl: boolean;
  onSelect: (id: string) => void;
  /** A tooth was clicked. The parent decides which region that opens. */
  onTooth?: () => void;
  /** Fired once, the first time the viewer moves the camera themselves. */
  onEngage?: () => void;
}) {
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  /**
   * Which tooth is lit.
   *
   * Local to the canvas because it is a property of the picture, not of the
   * content — the panel is driven by the region the click opens, which the
   * parent owns. Cleared on any area or depth change, since the tooth that
   * was lit may not even be on screen afterwards.
   */
  const [tooth, setTooth] = useState<{ key: string; area: AreaId; layer: LayerId } | null>(null);

  // Derived, not reset. Clearing it from an effect on [area, layer] worked but
  // cost a second render pass every time the view changed; remembering which
  // view the click belonged to answers the same question during render.
  const activeTooth = tooth && tooth.area === area && tooth.layer === layer ? tooth.key : null;

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
         * Capped at 1.75 rather than the device ratio. On a 3× phone the
         * difference is invisible on forms this smooth and costs nine times
         * the fragments of 1×.
         */
        dpr={[1, 1.75]}
        /**
         * With motion reduced the scene is a still image, so the loop runs on
         * demand instead of sixty times a second. Interaction invalidates it
         * explicitly below.
         */
        frameloop={reducedMotion ? "demand" : "always"}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          // Filmic roll-off. Without it the clearcoat highlight clips to a flat
          // white disc, the single most "computer graphics" artefact available.
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        /**
         * Dragging the model must not also drag the page.
         *
         * Without this a touch that starts on the canvas scrolls the section
         * away instead of rotating the model, which on a phone makes the whole
         * control unusable.
         */
        style={{ touchAction: "none" }}
        /**
         * Hidden from assistive technology on purpose.
         *
         * A canvas cannot describe itself, and a focusable one that announces
         * nothing is worse than one that is skipped. Every region reachable by
         * clicking the model is also a real button in the panel beside it, so
         * the keyboard and screen-reader path is complete without this element.
         */
        aria-hidden
      >
        <Scene
          area={area}
          layer={layer}
          tissue={tissue}
          framing={framing}
          regions={regions}
          activeRegion={activeRegion}
          activeTooth={activeTooth}
          reducedMotion={reducedMotion}
          onSelect={onSelect}
          onTooth={(key) => { setTooth({ key, area, layer }); onTooth?.(); }}
          onEngage={onEngage}
        />
      </Canvas>
    </CanvasBoundary>
  );
}
