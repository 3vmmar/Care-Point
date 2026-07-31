"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

export type CareLensArea = "face" | "nose" | "body" | "breast";

const rotations: Record<CareLensArea, [number, number, number]> = {
  face: [0.02, -0.22, 0],
  nose: [0.02, 0.82, 0],
  body: [-0.14, -0.14, 0],
  breast: [-0.1, -0.55, 0],
};

function AnatomicalSignal({
  selected,
  reducedMotion,
}: {
  selected: CareLensArea;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const signal = useRef<THREE.Mesh>(null);
  const { pointer } = useThree();

  useFrame((state, delta) => {
    if (!group.current || reducedMotion) return;
    const target = rotations[selected];
    group.current.rotation.x = THREE.MathUtils.lerp(
      group.current.rotation.x,
      target[0] + pointer.y * 0.06,
      0.045,
    );
    group.current.rotation.y = THREE.MathUtils.lerp(
      group.current.rotation.y,
      target[1] + pointer.x * 0.18,
      0.045,
    );
    group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, target[2], 0.045);
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.7) * 0.035;
    if (signal.current) signal.current.rotation.z += delta * 0.18;
  });

  const hotspotPosition: Record<CareLensArea, [number, number, number]> = {
    face: [-0.42, 0.42, 0.72],
    nose: [0.01, 0.25, 0.89],
    body: [0.33, -1.02, 0.51],
    breast: [-0.32, -0.64, 0.61],
  };

  return (
    <group ref={group}>
      <mesh scale={[0.82, 1.07, 0.76]} position={[0, 0.25, 0]}>
        <sphereGeometry args={[0.86, 48, 48]} />
        <meshPhysicalMaterial
          color="#9a5368"
          roughness={0.32}
          metalness={0.08}
          clearcoat={0.9}
          clearcoatRoughness={0.22}
          transparent
          opacity={0.96}
        />
      </mesh>
      <mesh scale={[0.825, 1.075, 0.765]} position={[0, 0.25, 0]}>
        <sphereGeometry args={[0.86, 22, 22]} />
        <meshBasicMaterial color="#e4b9c4" wireframe transparent opacity={0.12} />
      </mesh>
      <mesh position={[0, 0.18, 0.78]} rotation={[Math.PI / 2, 0, 0]} scale={[0.16, 0.23, 0.38]}>
        <coneGeometry args={[0.55, 1.2, 24]} />
        <meshPhysicalMaterial color="#bd7c8e" roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.92, 0]} scale={[0.52, 0.7, 0.48]}>
        <cylinderGeometry args={[0.62, 0.82, 1.5, 36]} />
        <meshPhysicalMaterial color="#713144" roughness={0.42} />
      </mesh>
      <mesh position={[0, -1.6, 0.02]} scale={[1.15, 0.68, 0.56]}>
        <sphereGeometry args={[0.88, 40, 40]} />
        <meshPhysicalMaterial color="#5b2636" roughness={0.48} />
      </mesh>
      <mesh ref={signal} position={hotspotPosition[selected]}>
        <torusGeometry args={[0.13, 0.012, 12, 48]} />
        <meshBasicMaterial color="#f1dcc0" />
      </mesh>
      <mesh position={hotspotPosition[selected]}>
        <sphereGeometry args={[0.055, 18, 18]} />
        <meshBasicMaterial color="#fff4df" />
      </mesh>
    </group>
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
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
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
        camera={{ position: [0, 0.15, 5.5], fov: 34 }}
        dpr={[1, 1.6]}
        frameloop={reducedMotion ? "demand" : "always"}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        aria-hidden
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[3, 4, 5]} intensity={3.2} color="#fff3e5" />
        <pointLight position={[-3, 0, 3]} intensity={2.2} color="#a84e69" />
        <pointLight position={[2, -2, 2]} intensity={1.7} color="#c9af86" />
        <AnatomicalSignal selected={selected} reducedMotion={reducedMotion} />
      </Canvas>
    </CanvasBoundary>
  );
}
