"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import {
  ANATOMY_ANCHORS,
  regionWorldPosition,
  type AreaId,
  type LayerId,
  type Region,
} from "@/lib/anatomy";
import {
  ARCH,
  ARM_BONES,
  ARM_RINGS,
  AXIAL_BONES,
  BODY_RINGS,
  BONE,
  FIGURE,
  FOOT_MOUNT,
  GUM,
  LEG_BONES,
  LEG_RINGS,
  NESTED_ARCH,
  HAND_MOUNT,
  RIB_ARC,
  RIB_LEVELS,
  SKULL_RINGS,
  SPINE_POINTS,
  ARM_SCULPT,
  BODY_SCULPT,
  LEG_SCULPT,
  applySculpt,
  buildArchLayout,
  buildFoot,
  buildHand,
  buildHeadContours,
  buildLoft,
  buildRidge,
  buildTooth,
  insetRings,
  mirrorRings,
  resampleRings,
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
 * ## The figure has no face, and that is the design
 *
 * A realistic human face rendered imperfectly is worse than no face at all —
 * the nearer a synthetic face gets to real without arriving, the more it
 * unsettles, and unsettling is the opposite of what a surgical practice wants a
 * prospective patient to feel. So there are no eyes, no nose, no mouth, no ears
 * and no hair: the head is a smooth cranial form described by contour lines, the
 * way a surgical atlas draws one. It is also the more inclusive choice, because
 * a figure with no identity cannot resemble one patient more than another.
 *
 * ## Four things do most of the visual work
 *
 *  1. **A broad, soft studio.** Built in code and pre-filtered into an IBL, lit
 *     roughly 2:1 key to fill. An anatomical study is lit like a specimen, not
 *     like a product shot.
 *  2. **One continuous silhouette.** Head, neck and trunk are lofted from a
 *     single stack of measured cross-sections, so there is no seam anywhere on
 *     the axis and no join for a highlight to catch on.
 *  3. **An unglazed surface rather than a skin one.** Simulated skin invites the
 *     comparison it cannot win, and a clearcoat on a body this smooth reads as
 *     moulded plastic. High roughness and almost no specular is what an
 *     anatomical study model physically is, and it makes the form describe
 *     itself through diffuse falloff instead of through highlights.
 *  4. **Filmic tone mapping.** Highlights roll off instead of clipping, which
 *     is most of the difference between "rendered" and "photographed".
 *
 * ## The dental arch is load-bearing twice
 *
 * `DentalArch` generates the model for the Dental area — and the same geometry
 * sits inside the skull at the skeleton layer of every other area. Dentistry is
 * not a fifth tab beside four others; it is the part of the same body that the
 * other four views happen to be looking past.
 */

export type CareLensArea = AreaId;

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

    /**
     * A large, close, soft frontal source rather than a hard three-point rig.
     *
     * The previous arrangement lit a ceramic object: a strong raking key at 5.5
     * against a weak fill, which on a full body threw one half into a hot
     * highlight and the other into near black. An anatomical study is lit the way
     * a specimen cabinet is — a broad soft source high and slightly front, wide
     * fills either side to keep the flanks readable, and a dim rim only to lift
     * the silhouette off the background. Key-to-fill is now about 2:1 instead of
     * 4:1, which is what removes the "3D render" look.
     */
    softbox(0xfff6ec, 5.2, [14, 14], [1.5, 6.5, 6]);    // broad key, high and front
    softbox(0xeaf0f8, 2.7, [11, 11], [-6.5, 2, 4.5]);   // wide fill, camera left
    softbox(0xe8eef6, 2.2, [10, 10], [6.5, 1, 3.5]);   // wide fill, camera right
    softbox(0x6f2438, 1.9, [7, 5], [-2.5, -1, -5.5]);   // brand rim, restrained
    softbox(0xd9cbb4, 1.5, [9, 6], [0, -5.5, 2.5]);    // floor bounce

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
  region, position, active, reducedMotion, markerScale, onSelect,
}: {
  region: Region;
  position: [number, number, number];
  active: boolean;
  reducedMotion: boolean;
  /**
   * Marker size for the model underneath.
   *
   * The figure's head is about half the width of the revolved bust it replaced,
   * so a marker authored against that model now covers a whole cheek. The
   * dental arch is unchanged and keeps its original size.
   */
  markerScale: number;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const hovered = useRef(false);
  const scale = useRef((active ? 0.9 : 0.62) * markerScale);

  useFrame((state, delta) => {
    // Always face the camera, so a marker reads as an annotation on the image
    // rather than a bead stuck to the surface.
    if (core.current) core.current.lookAt(state.camera.position);
    if (halo.current) halo.current.lookAt(state.camera.position);

    const wanted = (active ? 0.9 : hovered.current ? 0.78 : 0.62) * markerScale;
    scale.current = reducedMotion
      ? wanted
      : THREE.MathUtils.damp(scale.current, wanted, 9, delta);
    group.current?.scale.setScalar(scale.current);

    if (halo.current) {
      const material = halo.current.material as THREE.MeshBasicMaterial;
      if (active && !reducedMotion) {
        const pulse = (Math.sin(state.clock.elapsedTime * 1.6) + 1) / 2;
        material.opacity = 0.3 + pulse * 0.18;
      } else {
        material.opacity = active ? 0.44 : hovered.current ? 0.32 : 0.16;
      }
    }
  });

  return (
    <group ref={group} position={position}>
      {/* An invisible disc, larger than the visible mark, so the pointer target
          is comfortable without the graphic having to be. */}
      <mesh
        onPointerOver={(event) => { event.stopPropagation(); hovered.current = true; }}
        onPointerOut={() => { hovered.current = false; }}
        onClick={(event) => { event.stopPropagation(); onSelect(region.id); }}
      >
        <circleGeometry args={[0.24, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={halo}>
        <ringGeometry args={[0.064, 0.082, 48]} />
        <meshBasicMaterial
          color={active ? "#f1dadd" : "#c99aaa"}
          transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={core}>
        <circleGeometry args={[0.021, 24]} />
        <meshBasicMaterial color="#f8eeeb" depthWrite={false} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * How large the tissue wash is for each region, in model units.
 *
 * Re-measured for the standing figure. The head is roughly half the width of
 * the old revolved bust, so a wash authored against that model would now cover
 * most of a skull — a highlight that spans the whole head tells the viewer
 * nothing about which part of it is being discussed.
 */
const REGION_HIGHLIGHT_SCALE: Partial<Record<string, [number, number, number]>> = {
  brow: [0.11, 0.034, 0.02],
  eyelid: [0.058, 0.024, 0.016],
  midface: [0.08, 0.07, 0.024],
  lips: [0.072, 0.026, 0.016],
  jawline: [0.1, 0.042, 0.022],
  chin: [0.058, 0.04, 0.022],
  ears: [0.042, 0.066, 0.024],
  neck: [0.085, 0.105, 0.024],
  dorsum: [0.032, 0.07, 0.02],
  tip: [0.03, 0.028, 0.02],
  septum: [0.026, 0.05, 0.02],
  alar: [0.03, 0.026, 0.018],
  abdomen: [0.2, 0.2, 0.04],
  flank: [0.11, 0.17, 0.036],
  posture: [0.3, 0.24, 0.05],
  "post-weight": [0.15, 0.15, 0.036],
  position: [0.15, 0.13, 0.04],
  volume: [0.15, 0.13, 0.04],
  "chest-support": [0.24, 0.16, 0.05],
  scar: [0.13, 0.03, 0.022],
};

/** A soft tissue wash, separate from the pointer marker, so selection reads on the body itself. */
function RegionHighlight({
  region,
  position,
  reducedMotion,
}: {
  region: Region;
  position: [number, number, number];
  reducedMotion: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const scale = REGION_HIGHLIGHT_SCALE[region.id] ?? [0.12, 0.09, 0.03];

  useFrame((state) => {
    if (!mesh.current) return;
    const material = mesh.current.material as THREE.MeshBasicMaterial;
    material.opacity = reducedMotion
      ? 0.075
      : 0.055 + ((Math.sin(state.clock.elapsedTime * 1.25) + 1) / 2) * 0.035;
  });

  return (
    <mesh ref={mesh} position={position} scale={scale} renderOrder={4}>
      <sphereGeometry args={[1, 32, 18]} />
      <meshBasicMaterial
        color="#b94f69"
        transparent
        opacity={0.075}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
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
    <group name="consultation-avatar">
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

/* ══ Materials ═════════════════════════════════════════════════════════════ */

/**
 * The figure's outer surface.
 *
 * Porcelain rather than skin, deliberately. A simulated skin tone on a faceless
 * body lands in the same uncanny valley the missing face was removed to avoid,
 * and it forces a choice of complexion that would make the model belong to one
 * patient rather than to every patient. A pale clinical material with a
 * burgundy sheen at grazing angles reads as medical instrumentation instead —
 * and the sheen is what keeps it from looking like unpainted plastic, because it
 * puts a warm falloff exactly where a rim light would find one.
 *
 * There is no bump or albedo map here on purpose. The loft wraps its rings
 * without duplicating the seam column, which is what makes the shading
 * continuous around the body — and a wrapped ring has nowhere to put the `u`
 * discontinuity a texture would need. The finish comes from the environment
 * map, the clearcoat and the tone mapping instead.
 */
function ClinicalSurface({
  environment,
  depthWrite,
}: {
  environment: THREE.Texture | null;
  depthWrite: boolean;
}) {
  return (
    <meshPhysicalMaterial
      color="#cfc9c4"
      /**
       * Matte, not polished.
       *
       * The previous pass reached for a clearcoat to look premium and got the
       * opposite: a hard specular travelling over a smooth body is exactly what
       * makes a render read as moulded plastic. What an anatomical study model
       * actually is, physically, is unglazed plaster — high roughness, almost no
       * specular, and all of its form carried by diffuse falloff. So the coat is
       * nearly off and the roughness is up, and the surface now describes itself
       * through shading rather than through highlights.
       */
      roughness={0.66}
      metalness={0}
      clearcoat={0.08}
      clearcoatRoughness={0.7}
      /**
       * A trace of sheen remains, because a body this smooth has no texture to
       * catch light and needs something to darken the surfaces turning away from
       * the camera. Cool rather than burgundy: a warm sheen on a grey body tinted
       * the whole figure pink at grazing angles.
       */
      sheen={0.24}
      sheenColor="#8d8b93"
      sheenRoughness={0.72}
      envMap={environment}
      envMapIntensity={0.95}
      transparent
      depthWrite={depthWrite}
    />
  );
}

function TissueMaterial({
  environment,
  depthWrite,
}: {
  environment: THREE.Texture | null;
  depthWrite: boolean;
}) {
  return (
    <meshPhysicalMaterial
      color="#a54d4d"
      roughness={0.77}
      metalness={0}
      sheen={0.32}
      sheenColor="#6f252e"
      envMap={environment}
      envMapIntensity={0.46}
      transparent
      depthWrite={depthWrite}
    />
  );
}

function BoneMaterial({
  environment,
  depthWrite,
}: {
  environment: THREE.Texture | null;
  depthWrite: boolean;
}) {
  return (
    <meshPhysicalMaterial
      color="#ded2bd"
      roughness={0.74}
      metalness={0}
      envMap={environment}
      envMapIntensity={0.6}
      transparent
      depthWrite={depthWrite}
    />
  );
}

/* ══ Figure ════════════════════════════════════════════════════════════════ */

/** How far the tissue shell sits inside the surface it is derived from. */
const TRUNK_INSET = 0.05;
const LIMB_INSET = 0.03;

/**
 * Every geometry the figure needs, built once.
 *
 * Grouped into one record so disposal is a single loop. Twenty individual
 * `useMemo` hooks and a twenty-line cleanup is the same thing written in a way
 * that guarantees one of them will eventually be forgotten and leak.
 */
function useFigureGeometry() {
  const geometry = useMemo(() => {
    const armLeft = mirrorRings(ARM_RINGS);
    const legLeft = mirrorRings(LEG_RINGS);
    const spine = new THREE.CatmullRomCurve3(
      SPINE_POINTS.map((point) => new THREE.Vector3(...point)),
    );

    return {
      /**
       * Resample, loft, then sculpt — in that order, every time.
       *
       * The authored rings are too coarse to displace: a nose is 0.05 tall and the
       * head's rings are up to 0.05 apart, so a feature would land on a single
       * ring and read as a crease. Resampling to a fine step first gives the
       * sculpt vertices to move, which is what lets the breast rise out of the
       * chest wall instead of being a second mesh intersecting it.
       */
      /**
       * Densities are set by the smallest feature each part carries, not by size.
       *
       * The trunk holds the nose and the eye sockets, so it earns the finest step;
       * a thigh's smallest form is a whole quadriceps and resolves at three times
       * the spacing. Sampling the legs as finely as the face cost 40,000 triangles
       * that changed nothing on screen and made the software-WebGL test browser
       * unusable — a real signal, even though a GPU would not have noticed.
       */
      body: applySculpt(
        buildLoft(resampleRings(BODY_RINGS, 0.016, 0.038), 144),
        BODY_SCULPT,
      ),
      // The tissue shell takes the same sculpt at reduced amplitude, so the
      // muscle depth is a sculpted inner form rather than a scatter of blobs.
      bodyTissue: applySculpt(
        buildLoft(resampleRings(insetRings(BODY_RINGS, TRUNK_INSET), 0.03, 0.06), 96),
        BODY_SCULPT.map((feature) => ({ ...feature, amount: feature.amount * 0.55 })),
      ),
      armRight: applySculpt(buildLoft(resampleRings(ARM_RINGS, 0.05, 0.05), 64), ARM_SCULPT),
      armLeft: applySculpt(buildLoft(resampleRings(armLeft, 0.05, 0.05), 64), ARM_SCULPT),
      armRightTissue: buildLoft(insetRings(ARM_RINGS, LIMB_INSET), 40),
      armLeftTissue: buildLoft(insetRings(armLeft, LIMB_INSET), 40),
      handRight: buildHand(false),
      handLeft: buildHand(true),
      legRight: applySculpt(buildLoft(resampleRings(LEG_RINGS, 0.05, 0.05), 72), LEG_SCULPT),
      legLeft: applySculpt(buildLoft(resampleRings(legLeft, 0.05, 0.05), 72), LEG_SCULPT),
      legRightTissue: buildLoft(insetRings(LEG_RINGS, LIMB_INSET), 48),
      legLeftTissue: buildLoft(insetRings(legLeft, LIMB_INSET), 48),
      footRight: buildFoot(false),
      footLeft: buildFoot(true),
      contours: buildHeadContours(),
      skull: buildLoft(SKULL_RINGS, 72),
      spine: new THREE.TubeGeometry(spine, 56, 0.036, 12, false),
      /**
       * The arc's opening is rotated into the geometry rather than onto the mesh.
       *
       * A mesh's scale applies to its vertices before its rotation, so spinning
       * the ring on the mesh to move the gap would rotate the ellipse's axes with
       * it and leave the ribcage wider than it is deep. Baking the spin here
       * leaves the mesh free to carry the ellipse and the forward tilt.
       */
      rib: new THREE.TorusGeometry(1, 0.013, 8, 44, RIB_ARC)
        .rotateZ(-Math.PI / 2 - RIB_ARC / 2),
      pelvis: new THREE.TorusGeometry(1, AXIAL_BONES.pelvis.radius, 10, 48),
      blob: new THREE.SphereGeometry(1, 24, 16),
      armBoneRight: buildLoft(ARM_BONES, 24),
      armBoneLeft: buildLoft(mirrorRings(ARM_BONES), 24),
      legBoneRight: buildLoft(LEG_BONES, 28),
      legBoneLeft: buildLoft(mirrorRings(LEG_BONES), 28),
    };
  }, []);

  useEffect(() => () => {
    for (const buffer of Object.values(geometry)) buffer.dispose();
  }, [geometry]);

  return geometry;
}


/**
 * The consultation figure: a faceless, gender-neutral standing body.
 *
 * Head to toe in one scene graph, at canonical 7.5-head proportions. The trunk
 * is one lofted surface; the limbs are their own lofts whose first rings start
 * inside the trunk, so a shoulder and a hip have no visible joint ring. What
 * describes the head is the contour set — there is no face to describe it.
 */
function Figure({
  layer, reducedMotion, environment,
}: {
  layer: LayerId;
  reducedMotion: boolean;
  environment: THREE.Texture | null;
}) {
  const geometry = useFigureGeometry();
  const shell = SHELL_OPACITY[layer];
  const surfaceDepth = layer === "surface";

  const limbs = [
    {
      key: "right", side: 1,
      surface: geometry.armRight, tissue: geometry.armRightTissue,
      bone: geometry.armBoneRight, hand: geometry.handRight,
    },
    {
      key: "left", side: -1,
      surface: geometry.armLeft, tissue: geometry.armLeftTissue,
      bone: geometry.armBoneLeft, hand: geometry.handLeft,
    },
  ];
  const legs = [
    {
      key: "right", side: 1,
      surface: geometry.legRight, tissue: geometry.legRightTissue,
      bone: geometry.legBoneRight, foot: geometry.footRight,
    },
    {
      key: "left", side: -1,
      surface: geometry.legLeft, tissue: geometry.legLeftTissue,
      bone: geometry.legBoneLeft, foot: geometry.footLeft,
    },
  ];

  return (
    <group name="consultation-avatar">
      {/* ── Surface ─────────────────────────────────────────────────────── */}
      <FadingMesh geometry={geometry.body} opacity={shell.surface} reducedMotion={reducedMotion}>
        <ClinicalSurface environment={environment} depthWrite={surfaceDepth} />
      </FadingMesh>

      {limbs.map((arm) => (
        <group key={`arm-${arm.key}`}>
          <FadingMesh
            geometry={arm.surface}
            opacity={shell.surface}
            reducedMotion={reducedMotion}
          >
            <ClinicalSurface environment={environment} depthWrite={surfaceDepth} />
          </FadingMesh>
          {/* The hand carries the forearm's angle on, so it hangs in line with
              the arm rather than breaking at the wrist. */}
          <FadingMesh
            geometry={arm.hand}
            opacity={shell.surface}
            reducedMotion={reducedMotion}
            position={[arm.side * HAND_MOUNT.x, HAND_MOUNT.y, HAND_MOUNT.z]}
            rotation={[0, 0, arm.side * HAND_MOUNT.angle]}
          >
            <ClinicalSurface environment={environment} depthWrite={surfaceDepth} />
          </FadingMesh>
        </group>
      ))}

      {legs.map((leg) => (
        <group key={`leg-${leg.key}`}>
          <FadingMesh
            geometry={leg.surface}
            opacity={shell.surface}
            reducedMotion={reducedMotion}
          >
            <ClinicalSurface environment={environment} depthWrite={surfaceDepth} />
          </FadingMesh>
          {/* The foot is authored along +Y and stood up by the renderer, so one
              set of rings serves both feet at either toe-out angle. */}
          <group
            position={[leg.side * FOOT_MOUNT.x, FOOT_MOUNT.y, FOOT_MOUNT.z]}
            rotation={[0, leg.side * FOOT_MOUNT.toeOut, 0]}
          >
            <FadingMesh
              geometry={leg.foot}
              opacity={shell.surface}
              reducedMotion={reducedMotion}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <ClinicalSurface environment={environment} depthWrite={surfaceDepth} />
            </FadingMesh>
          </group>
        </group>
      ))}

      {/**
       * The contour set over the cranium.
       *
       * Lines, not geometry: a one-pixel stroke cannot be mistaken for a
       * feature, which is the whole point — it describes the shape of a skull
       * without asserting a face. They sit a fraction outside the surface and
       * do not write depth, so the far side of the head occludes its own
       * contours instead of showing them through the brow.
       */}
      {shell.surface > 0.5 && (
        <lineSegments geometry={geometry.contours} renderOrder={3}>
          <lineBasicMaterial
            color="#8d5766"
            transparent
            opacity={0.13}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      )}

      {/* ── Structure ───────────────────────────────────────────────────── */}
      <FadingMesh
        geometry={geometry.bodyTissue}
        opacity={shell.structure}
        reducedMotion={reducedMotion}
      >
        <TissueMaterial environment={environment} depthWrite={layer === "structure"} />
      </FadingMesh>

      {limbs.map((arm) => (
        <FadingMesh
          key={`arm-tissue-${arm.key}`}
          geometry={arm.tissue}
          opacity={shell.structure}
          reducedMotion={reducedMotion}
        >
          <TissueMaterial environment={environment} depthWrite={layer === "structure"} />
        </FadingMesh>
      ))}

      {legs.map((leg) => (
        <FadingMesh
          key={`leg-tissue-${leg.key}`}
          geometry={leg.tissue}
          opacity={shell.structure}
          reducedMotion={reducedMotion}
        >
          <TissueMaterial environment={environment} depthWrite={layer === "structure"} />
        </FadingMesh>
      ))}


      {/* ── Skeleton ────────────────────────────────────────────────────── */}
      <FadingMesh geometry={geometry.skull} opacity={shell.skeleton} reducedMotion={reducedMotion}>
        <BoneMaterial environment={environment} depthWrite={layer === "skeleton"} />
      </FadingMesh>

      <FadingMesh geometry={geometry.spine} opacity={shell.skeleton} reducedMotion={reducedMotion}>
        <BoneMaterial environment={environment} depthWrite={layer === "skeleton"} />
      </FadingMesh>

      {/* Each level slopes forward, and the gap in the arc faces the sternum. */}
      {RIB_LEVELS.map((level) => (
        <FadingMesh
          key={`rib-${level.y}`}
          geometry={geometry.rib}
          opacity={shell.skeleton}
          reducedMotion={reducedMotion}
          position={[0, level.y, -0.02]}
          rotation={[Math.PI / 2 + level.tilt, 0, 0]}
          scale={[level.rx, level.rz, 1]}
        >
          <BoneMaterial environment={environment} depthWrite={layer === "skeleton"} />
        </FadingMesh>
      ))}

      <FadingMesh
        geometry={geometry.blob}
        opacity={shell.skeleton}
        reducedMotion={reducedMotion}
        position={[0, AXIAL_BONES.sternum.y, AXIAL_BONES.sternum.z]}
        scale={[
          AXIAL_BONES.sternum.rx,
          AXIAL_BONES.sternum.height / 2,
          AXIAL_BONES.sternum.rz,
        ]}
      >
        <BoneMaterial environment={environment} depthWrite={layer === "skeleton"} />
      </FadingMesh>

      {[-1, 1].map((side) => (
        <FadingMesh
          key={`clavicle-${side}`}
          geometry={geometry.blob}
          opacity={shell.skeleton}
          reducedMotion={reducedMotion}
          position={[side * AXIAL_BONES.clavicle.half, AXIAL_BONES.clavicle.y, AXIAL_BONES.clavicle.z]}
          // Raised at the outer end, as a clavicle is. Two level bars across the
          // top of the ribcage read as a yoke rather than as a shoulder girdle.
          rotation={[0, 0, side * AXIAL_BONES.clavicle.lift]}
          scale={[
            AXIAL_BONES.clavicle.half,
            AXIAL_BONES.clavicle.radius,
            AXIAL_BONES.clavicle.radius,
          ]}
        >
          <BoneMaterial environment={environment} depthWrite={layer === "skeleton"} />
        </FadingMesh>
      ))}

      <FadingMesh
        geometry={geometry.pelvis}
        opacity={shell.skeleton}
        reducedMotion={reducedMotion}
        position={[0, AXIAL_BONES.pelvis.y, -0.01]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[AXIAL_BONES.pelvis.rx, AXIAL_BONES.pelvis.rz, 1]}
      >
        <BoneMaterial environment={environment} depthWrite={layer === "skeleton"} />
      </FadingMesh>

      {limbs.map((arm) => (
        <FadingMesh
          key={`arm-bone-${arm.key}`}
          geometry={arm.bone}
          opacity={shell.skeleton}
          reducedMotion={reducedMotion}
        >
          <BoneMaterial environment={environment} depthWrite={layer === "skeleton"} />
        </FadingMesh>
      ))}

      {legs.map((leg) => (
        <FadingMesh
          key={`leg-bone-${leg.key}`}
          geometry={leg.bone}
          opacity={shell.skeleton}
          reducedMotion={reducedMotion}
        >
          <BoneMaterial environment={environment} depthWrite={layer === "skeleton"} />
        </FadingMesh>
      ))}

      {/**
       * The same arch that the Dental area shows, sitting where a jaw is.
       *
       * This is the join between the five areas: dentistry is not a fifth
       * subject beside four others, it is the part of one body that the other
       * four views are looking past. `tests/carelens-geometry.test.mts` measures
       * the fit, because an arch wider than the jaw holding it is invisible from
       * the front and obvious in profile.
       */}
      {layer === "skeleton" && (
        <group position={NESTED_ARCH.position} scale={NESTED_ARCH.scale}>
          <DentalArch
            layer="skeleton"
            reducedMotion={reducedMotion}
            environment={environment}
            dim
          />
        </group>
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

/**
 * Where the scene opens, before it eases into the first area's framing.
 *
 * A full head-to-toe shot. The figure is a whole body now, and a viewer who
 * arrives already zoomed into a head never learns that — so the model states
 * what it is once, at distance, and then travels in. The `<Canvas>` camera is
 * initialised from these same numbers so the first painted frame already agrees
 * with the rig and there is nothing to jump from.
 */
const OPENING: Framing = { azimuth: -0.58, elevation: 0.05, distance: 11.5, target: 0 };

/** Camera position for a framing, in the orbit's own spherical coordinates. */
function orbitPosition(
  focus: THREE.Vector3,
  azimuth: number,
  elevation: number,
  distance: number,
  into = new THREE.Vector3(),
): THREE.Vector3 {
  const horizontal = Math.cos(elevation) * distance;
  return into.set(
    focus.x + Math.sin(azimuth) * horizontal,
    focus.y + Math.sin(elevation) * distance,
    focus.z + Math.cos(azimuth) * horizontal,
  );
}

export const OPENING_CAMERA_POSITION: [number, number, number] = (() => {
  const position = orbitPosition(
    new THREE.Vector3(0, OPENING.target, 0),
    OPENING.azimuth,
    OPENING.elevation,
    OPENING.distance,
  );
  return [position.x, position.y, position.z];
})();

/**
 * A second-order approach with velocity, rather than exponential decay.
 *
 * `THREE.MathUtils.damp` starts at full speed and slows to a crawl, so a
 * re-frame reads as a lurch followed by a long creep — the two things a
 * premium transition must not do. Carrying a velocity term instead gives an
 * ease-in and an ease-out from one function, and because the velocity survives
 * between frames a target that changes mid-flight bends the path rather than
 * restarting it. That is what lets a viewer click three regions in a row and
 * see one continuous move instead of three collisions.
 *
 * The final clamp is what stops the spring settling asymptotically short of its
 * target and leaving the camera permanently a fraction off the framing.
 */
type Damped = { value: number; velocity: number };

function smoothDamp(state: Damped, target: number, smoothTime: number, delta: number) {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * delta;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = state.value - target;
  const temp = (state.velocity + omega * change) * delta;
  const velocity = (state.velocity - omega * temp) * decay;
  let value = target + (change + temp) * decay;

  if (target - state.value > 0 === value > target) {
    value = target;
    state.velocity = delta > 0 ? (value - state.value) / delta : 0;
  } else {
    state.velocity = velocity;
  }
  state.value = value;
}

/** The equivalent angle nearest `from`, so a turn never takes the long way. */
function nearestAngle(from: number, to: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * How the camera is aimed when a specific region is selected.
 *
 * Derived from the marker rather than authored per region, which is what makes
 * the zoom work "naturally for every supported body region" — including any
 * region added later, since a new entry in `lib/anatomy.ts` needs no camera
 * work at all. A marker's offset from the body's vertical axis *is* the
 * direction the anatomy faces, so `atan2` over that offset points the camera at
 * it: dead-on for a sternum, three-quarters for a flank, profile for an ear.
 *
 * The result is then blended back toward the area's own azimuth. Swinging fully
 * onto the derived angle is correct geometrically and flat photographically —
 * keeping a share of the area framing preserves the raking light that gives the
 * form its shape, and keeps consecutive regions in the same visual family
 * instead of snapping between elevations of the same body.
 */
const AREA_AZIMUTH_SHARE = 0.4;
const MINIMUM_OFFSET = 0.05;

function regionAzimuth(focus: THREE.Vector3, framing: Framing): number {
  const offset = Math.hypot(focus.x, focus.z);
  // A marker on the axis has no direction to face; the area framing is the only
  // meaningful answer there.
  if (offset < MINIMUM_OFFSET) return framing.azimuth;
  const derived = Math.atan2(focus.x, focus.z);
  return derived + (nearestAngle(derived, framing.azimuth) - derived) * AREA_AZIMUTH_SHARE;
}

/**
 * Orbit, and a framing the view travels to.
 *
 * Hand-rolled rather than pulled from `drei`, which is not a dependency here
 * and would cost more than this does. It also lets the two behaviours coexist
 * properly: the camera flies to a framing when the area or region changes, and
 * hands control over the moment the user drags — without the fight for the
 * camera that mixing a tween with a controller usually produces.
 *
 * ## Why the interpolation happens in spherical space
 *
 * The previous version damped the camera's x, y and z toward a destination
 * point. Straight-line travel between two points on an orbit cuts the chord
 * between them, so re-framing from a cheek to the opposite ear drove the camera
 * through the head — and even where it missed, the distance to the subject
 * collapsed and sprang back, which reads as a lurch. Damping the azimuth,
 * elevation, distance and focus separately means the camera arcs at a
 * controlled radius: orientation is continuous, the subject never passes
 * through the near plane, and the move looks like a considered dolly.
 *
 * The listeners live here rather than on the `<Canvas>` element, and the orbit
 * state is a ref owned by this component. An earlier version passed the ref
 * down as a prop and mutated it from the frame loop; the React compiler
 * rejected that, correctly — a component that mutates something it was handed
 * cannot be reasoned about, and the fix was to give the mutation and the state
 * the same owner rather than to silence the rule.
 */
const REFRAME_SECONDS = 0.7;
const DRAG_SECONDS = 0.1;

/**
 * How far below the subject the camera actually looks.
 *
 * Centring the anatomy in the *canvas* is not the same as centring it in what
 * the viewer sees: the depth dock sits over the bottom of the canvas and the
 * safety note over the top, so the visible band runs roughly 2% to 86% and its
 * middle is at 44%, not 50%. Aiming dead centre therefore pushes every subject
 * low — which is why selecting Face & neck put the jaw mid-frame and hid the neck
 * behind the dock entirely.
 *
 * Expressed as a fraction of the frame's own height so it holds at every zoom: a
 * head close-up and a whole-figure shot are biased by the same proportion of what
 * the viewer can see, not by the same number of model units.
 */
const VIEWPORT_BIAS = 0.06;

/** Visible height of the frame at a distance, for a 32° vertical field of view. */
const FRAME_HEIGHT_PER_UNIT = 2 * Math.tan((32 * Math.PI) / 180 / 2);

function CameraRig({
  area, framing, focusRegion, reducedMotion, onEngage,
}: {
  area: AreaId;
  framing: Framing;
  focusRegion: Region | null;
  reducedMotion: boolean;
  onEngage?: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
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

  const orbit = useRef({
    azimuth: { value: OPENING.azimuth, velocity: 0 } as Damped,
    elevation: { value: OPENING.elevation, velocity: 0 } as Damped,
    distance: { value: OPENING.distance, velocity: 0 } as Damped,
    focusX: { value: 0, velocity: 0 } as Damped,
    focusY: { value: OPENING.target, velocity: 0 } as Damped,
    focusZ: { value: 0, velocity: 0 } as Damped,
    engaged: false,
  });

  const target = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3(0, OPENING.target, 0));
  const position = useRef(new THREE.Vector3());

  // Changing area or region re-frames the model. Without this the camera would
  // stay wherever the viewer last left it and the new selection would open
  // off-centre, which reads as a bug rather than as continuity.
  useEffect(() => {
    orbit.current.engaged = false;
    engagedOnce.current = false;
  }, [area, focusRegion?.id]);

  useEffect(() => {
    const element = gl.domElement;
    let pointer: { id: number; x: number } | null = null;

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
      pointer = { id: event.pointerId, x: event.clientX };
      element.setPointerCapture?.(event.pointerId);
    };

    const move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x;
      pointer.x = event.clientX;

      take();
      // The drag owns the azimuth outright. Zeroing the velocity as well stops
      // an in-flight re-frame from continuing to push against the hand.
      orbit.current.azimuth.value -= dx * 0.0045;
      orbit.current.azimuth.velocity = 0;
    };

    const up = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = null;
    };

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);

    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, [gl, invalidate]);

  useFrame((state, delta) => {
    const current = orbit.current;

    // Where the camera should be looking: the selected region if the viewer
    // picked one, otherwise the area's own height on the body axis.
    if (focusRegion) {
      const [x, y, z] = regionWorldPosition(focusRegion);
      target.current.set(x, y, z);
    } else {
      target.current.set(0, framing.target, 0);
    }

    const wantedDistance = focusRegion?.cameraDistance ?? framing.distance;
    const wantedAzimuth = focusRegion
      ? regionAzimuth(target.current, framing)
      : framing.azimuth;

    if (reducedMotion) {
      current.azimuth.value = wantedAzimuth;
      current.elevation.value = framing.elevation;
      current.distance.value = wantedDistance;
      current.focusX.value = target.current.x;
      current.focusY.value = target.current.y;
      current.focusZ.value = target.current.z;
    } else {
      const seconds = current.engaged ? DRAG_SECONDS : REFRAME_SECONDS;

      // A drag owns the azimuth; everything else keeps travelling so that
      // selecting a region mid-orbit still zooms without stealing the angle.
      if (!current.engaged) {
        smoothDamp(
          current.azimuth,
          nearestAngle(current.azimuth.value, wantedAzimuth),
          seconds,
          delta,
        );
        smoothDamp(current.elevation, framing.elevation, seconds, delta);
      }
      smoothDamp(current.distance, wantedDistance, seconds, delta);
      smoothDamp(current.focusX, target.current.x, seconds, delta);
      smoothDamp(current.focusY, target.current.y, seconds, delta);
      smoothDamp(current.focusZ, target.current.z, seconds, delta);
    }

    // The orbit is centred on the anatomy; the aim drops below it by a share of
    // the frame so the subject lands in the middle of the *visible* band rather
    // than the middle of the canvas.
    const frame = current.distance.value * FRAME_HEIGHT_PER_UNIT;
    look.current.set(
      current.focusX.value,
      current.focusY.value - frame * VIEWPORT_BIAS,
      current.focusZ.value,
    );
    orbitPosition(
      look.current,
      current.azimuth.value,
      current.elevation.value,
      current.distance.value,
      position.current,
    );
    state.camera.position.copy(position.current);
    state.camera.lookAt(look.current);
  });

  return null;
}


/* ══ Scene ═════════════════════════════════════════════════════════════════ */

function Scene({
  area, layer, framing, regions, activeRegion, focusRegion, activeTooth, reducedMotion,
  onSelect, onTooth, onEngage,
}: {
  area: AreaId;
  layer: LayerId;
  framing: Framing;
  regions: Region[];
  activeRegion: string | null;
  focusRegion: Region | null;
  activeTooth: string | null;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
  onTooth: (key: string) => void;
  onEngage?: () => void;
}) {
  const environment = useStudioEnvironment();
  const dental = area === "dental";
  // The arch is rendered at its authored size; the figure's head is roughly half
  // the width of the bust the markers were originally drawn against.
  const markerScale = dental ? 1 : 0.42;
  const selected = regions.find((region) => region.id === activeRegion) ?? null;
  const mirroredPosition = (region: Region): [number, number, number] => {
    const origin = ANATOMY_ANCHORS[region.anchor];
    return [origin[0] - region.at[0], origin[1] + region.at[1], origin[2] + region.at[2]];
  };

  return (
    <>
      {/* The environment map does the lighting. These are shaping light on top
          of it — without an IBL underneath they would be doing all the work,
          which is what makes a scene look like a plastic toy. */}
      <ambientLight intensity={0.44} />
      <directionalLight position={[1.8, 5.2, 5.2]} intensity={1.18} color="#fff6ec" />
      <directionalLight position={[-4.4, 1.4, 3.2]} intensity={0.66} color="#e6edf7" />
      <directionalLight position={[-3.2, 0.4, -3.4]} intensity={0.44} color="#a8697a" />

      {/* The figure stands on the shadow; the arch floats above its own. */}
      <ContactShadow y={dental ? -0.72 : FIGURE.sole} size={dental ? 3.6 : 2.9} />

      <group name="anatomy-root">
        {dental ? (
          <DentalArch
            layer={layer}
            reducedMotion={reducedMotion}
            environment={environment}
            activeTooth={activeTooth}
            onTooth={(key) => onTooth(key)}
          />
        ) : (
          <Figure layer={layer} reducedMotion={reducedMotion} environment={environment} />
        )}

        {regions.map((region) => {
          const position = regionWorldPosition(region);
          return (
            <group key={region.id} name={`anchor-${region.anchor}-${region.id}`}>
              <Hotspot
                region={region}
                position={position}
                active={activeRegion === region.id}
                reducedMotion={reducedMotion}
                markerScale={markerScale}
                onSelect={onSelect}
              />
              {region.mirrorX && (
                <Hotspot
                  region={region}
                  position={mirroredPosition(region)}
                  active={activeRegion === region.id}
                  reducedMotion={reducedMotion}
                  markerScale={markerScale}
                  onSelect={onSelect}
                />
              )}
            </group>
          );
        })}

        {selected && (
          <group name={`highlight-${selected.id}`}>
            <RegionHighlight
              region={selected}
              position={regionWorldPosition(selected)}
              reducedMotion={reducedMotion}
            />
            {selected.mirrorX && (
              <RegionHighlight
                region={selected}
                position={mirroredPosition(selected)}
                reducedMotion={reducedMotion}
              />
            )}
          </group>
        )}
      </group>

      <CameraRig
        area={area}
        framing={framing}
        focusRegion={focusRegion}
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
  area, layer, framing, regions, activeRegion, focusRegion, rtl, onSelect, onTooth, onEngage,
}: {
  area: AreaId;
  layer: LayerId;
  framing: Framing;
  regions: Region[];
  activeRegion: string | null;
  /** Explicit user selection. The default described region keeps the wider area framing. */
  focusRegion?: Region | null;
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
   * Whether the scene is anywhere near the viewport.
   *
   * Until this existed the canvas ran `frameloop="always"` from the moment it
   * mounted until the visitor left the site — sixty renders a second for the
   * whole of the rest of the page, competing with scrolling for the main
   * thread and the GPU.
   *
   * It was measurable: on a 4×-throttled Pixel 5, every dropped frame past the
   * first landed at or after the depth where this component mounts, the worst
   * a 217ms freeze two thirds of the page later, in a section made of three
   * text cards that cannot possibly cost that. Suspending the loop off-screen
   * is the fix, and `npm run test:performance:lab` is where it is checked.
   *
   * A 300px margin means the scene is already running by the time it is worth
   * looking at, so nobody sees it start.
   */
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [nearViewport, setNearViewport] = useState(true);

  useEffect(() => {
    if (!canvasElement || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin: "300px 0px" },
    );
    observer.observe(canvasElement);
    return () => observer.disconnect();
  }, [canvasElement]);

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
        camera={{ position: OPENING_CAMERA_POSITION, fov: 32 }}
        /**
         * Capped at 1.75 rather than the device ratio. On a 3× phone the
         * difference is invisible on forms this smooth and costs nine times
         * the fragments of 1×.
         */
        dpr={[1, 1.5]}
        /**
         * Sixty renders a second only while the scene is worth rendering.
         *
         * With motion reduced it is a still image, so the loop runs on demand
         * and interaction invalidates it explicitly below. Scrolled away, it is
         * not even that — a continuous loop behind a section nobody is looking
         * at is pure cost, and was the measured cause of the page's scroll
         * stutter.
         */
        frameloop={reducedMotion || !nearViewport ? "demand" : "always"}
        onCreated={({ gl }) => setCanvasElement(gl.domElement)}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          // Filmic roll-off. Without it the clearcoat highlight clips to a flat
          // white disc, the single most "computer graphics" artefact available.
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.16,
        }}
        /**
         * Vertical gestures remain native page scroll; horizontal gestures are
         * reserved for orbiting. `none` trapped phone users inside this
         * full-height viewport and also suppressed pinch zoom over the model.
         */
        style={{ touchAction: "pan-y" }}
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
        <Suspense fallback={null}>
          <Scene
            area={area}
            layer={layer}
            framing={framing}
            regions={regions}
            activeRegion={activeRegion}
            focusRegion={focusRegion ?? null}
            activeTooth={activeTooth}
            reducedMotion={reducedMotion}
            onSelect={onSelect}
            onTooth={(key) => { setTooth({ key, area, layer }); onTooth?.(); }}
            onEngage={onEngage}
          />
        </Suspense>
      </Canvas>
    </CanvasBoundary>
  );
}
