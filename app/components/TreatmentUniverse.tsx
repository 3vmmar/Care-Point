"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Rotate3D,
  ScanLine,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import * as THREE from "three";

type Language = "en" | "ar";
type AreaId = "face" | "nose" | "body" | "breast";

const areas: Array<{
  id: AreaId;
  number: string;
  title: string;
  ar: string;
  feeling: string;
  arFeeling: string;
  description: string;
  arDescription: string;
  options: string[];
  consultation: string[];
  recovery: Array<{ label: string; text: string }>;
}> = [
  {
    id: "face",
    number: "01",
    title: "Face & neck",
    ar: "الوجه والرقبة",
    feeling: "I want to look fresher, without looking different.",
    arFeeling: "أريد مظهراً أكثر حيوية بدون تغيير ملامحي.",
    description:
      "Explore the relationship between skin, volume, muscle support, and facial balance.",
    arDescription: "استكشف العلاقة بين البشرة والحجم ودعم العضلات وتناسق الوجه.",
    options: ["Facial rejuvenation", "Eyelid surgery", "Fat grafting"],
    consultation: ["Facial proportions", "Skin and volume assessment", "Scar and recovery planning"],
    recovery: [
      { label: "Phase 01", text: "Protection and early healing" },
      { label: "Phase 02", text: "Return to social rhythm" },
      { label: "Phase 03", text: "Progressive refinement" },
    ],
  },
  {
    id: "nose",
    number: "02",
    title: "Nose & profile",
    ar: "الأنف وتناسق الوجه",
    feeling: "I want balance from every angle—and to breathe well.",
    arFeeling: "أريد تناسقاً من كل زاوية وتنفساً أفضل.",
    description:
      "Profile, structure, skin, and breathing are considered as one connected system.",
    arDescription: "يُناقش التناسق والتكوين والبشرة والتنفس كنظام واحد متكامل.",
    options: ["Rhinoplasty", "Septorhinoplasty", "Profile balancing"],
    consultation: ["Breathing and structure", "Profile relationships", "Long-term refinement"],
    recovery: [
      { label: "Phase 01", text: "Support, swelling, and rest" },
      { label: "Phase 02", text: "Early return to routine" },
      { label: "Phase 03", text: "Gradual definition" },
    ],
  },
  {
    id: "body",
    number: "03",
    title: "Body architecture",
    ar: "هندسة القوام",
    feeling: "My shape no longer reflects how I feel.",
    arFeeling: "قوامي لم يعد يعكس إحساسي بنفسي.",
    description:
      "Proportion, skin quality, muscle support, and lifestyle shape the conversation.",
    arDescription: "التناسق وجودة الجلد ودعم العضلات ونمط الحياة تشكل خطة الحوار.",
    options: ["Tummy tuck", "Liposculpture", "Post-weight-loss care"],
    consultation: ["Body proportions", "Skin and muscle support", "Mobility and lifestyle plan"],
    recovery: [
      { label: "Phase 01", text: "Rest and protected movement" },
      { label: "Phase 02", text: "Progressive mobility" },
      { label: "Phase 03", text: "Return to full rhythm" },
    ],
  },
  {
    id: "breast",
    number: "04",
    title: "Breast proportion",
    ar: "تناسق الثدي",
    feeling: "I want proportion, comfort, and confidence.",
    arFeeling: "أبحث عن التناسق والراحة والثقة.",
    description:
      "A private conversation about size, position, symmetry, scars, and long-term goals.",
    arDescription: "حوار بخصوصية حول الحجم والموضع والتماثل والندبات والأهداف طويلة المدى.",
    options: ["Lift", "Reduction", "Augmentation"],
    consultation: ["Proportion and symmetry", "Technique and scar placement", "Lifestyle and future plans"],
    recovery: [
      { label: "Phase 01", text: "Support and early comfort" },
      { label: "Phase 02", text: "Gradual activity" },
      { label: "Phase 03", text: "Settling and follow-up" },
    ],
  },
];

const rotations: Record<AreaId, [number, number, number]> = {
  face: [0.02, -0.22, 0],
  nose: [0.02, 0.82, 0],
  body: [-0.14, -0.14, 0],
  breast: [-0.1, -0.55, 0],
};

function AnatomicalSignal({ selected }: { selected: AreaId }) {
  const group = useRef<THREE.Group>(null);
  const signal = useRef<THREE.Mesh>(null);
  const { pointer } = useThree();

  useFrame((state, delta) => {
    if (!group.current) return;
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

  const hotspotPosition: Record<AreaId, [number, number, number]> = {
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

function UniverseCanvas({ selected }: { selected: AreaId }) {
  return (
    <Canvas
      camera={{ position: [0, 0.15, 5.5], fov: 34 }}
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 4, 5]} intensity={3.2} color="#fff3e5" />
      <pointLight position={[-3, 0, 3]} intensity={2.2} color="#a84e69" />
      <pointLight position={[2, -2, 2]} intensity={1.7} color="#c9af86" />
      <AnatomicalSignal selected={selected} />
    </Canvas>
  );
}

export default function TreatmentUniverse({
  language,
  onBook,
  onAsk,
}: {
  language: Language;
  onBook: () => void;
  onAsk: () => void;
}) {
  const rtl = language === "ar";
  const [selected, setSelected] = useState<AreaId>("face");
  const [detailOpen, setDetailOpen] = useState(false);
  const active = areas.find((area) => area.id === selected) ?? areas[0];

  return (
    <>
      <div className="treatment-universe">
        <div className="universe-canvas">
          <UniverseCanvas selected={selected} />
          <div className="universe-scan-line" aria-hidden />
          <div className="universe-corner universe-corner--one" aria-hidden />
          <div className="universe-corner universe-corner--two" aria-hidden />
          <div className="universe-canvas-label">
            <ScanLine size={15} />
            <span>{rtl ? "نموذج الاستكشاف التفاعلي" : "INTERACTIVE DISCOVERY MODEL"}</span>
          </div>
          <div className="universe-rotate">
            <Rotate3D size={14} />
            <span>{rtl ? "حرّك المؤشر" : "MOVE TO EXPLORE"}</span>
          </div>
        </div>

        <div className="universe-interface">
          <div className="universe-tabs">
            {areas.map((area) => (
              <button
                key={area.id}
                className={selected === area.id ? "active" : ""}
                onClick={() => setSelected(area.id)}
              >
                <span>{area.number}</span>
                <strong>{rtl ? area.ar : area.title}</strong>
              </button>
            ))}
          </div>

          <div className="universe-detail" key={selected}>
            <span className="universe-signal"><i />{rtl ? "منطقة محددة" : "AREA SELECTED"}</span>
            <h3>“{rtl ? active.arFeeling : active.feeling}”</h3>
            <p>{rtl ? active.arDescription : active.description}</p>
            <div className="universe-tags">
              {active.options.map((option) => <span key={option}>{option}</span>)}
            </div>
            <div className="universe-actions">
              <button className="universe-primary" onClick={() => setDetailOpen(true)}>
                {rtl ? "افتح خريطة الاستشارة" : "Open consultation map"}
                <ArrowRight size={16} />
              </button>
              <button onClick={onAsk}>
                <Sparkles size={15} />
                {rtl ? "اسأل نور" : "Ask NOOR"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {detailOpen && (
        <div className="specialty-layer" role="dialog" aria-modal="true">
          <button className="modal-scrim" onClick={() => setDetailOpen(false)} aria-label="Close" />
          <section className="specialty-deep-dive" dir={rtl ? "rtl" : "ltr"}>
            <header>
              <button onClick={() => setDetailOpen(false)}>
                <ArrowLeft size={16} />
                {rtl ? "العودة إلى كير لِنز" : "Back to CareLens"}
              </button>
              <span>CARE MAP · {active.number}</span>
              <button onClick={() => setDetailOpen(false)} aria-label="Close"><X /></button>
            </header>
            <div className="deep-dive-grid">
              <div className="deep-dive-intro">
                <span>{rtl ? "خريطة استشارتك" : "YOUR CONSULTATION MAP"}</span>
                <h2>{rtl ? active.ar : active.title}</h2>
                <p>{rtl ? active.arDescription : active.description}</p>
                <div className="deep-dive-orb" aria-hidden><i /><i /><i /></div>
              </div>
              <div className="deep-dive-content">
                <div className="deep-dive-block">
                  <span>01 · {rtl ? "ما سنناقشه" : "WHAT WE WILL EXPLORE"}</span>
                  <div className="deep-checks">
                    {active.consultation.map((item) => (
                      <p key={item}><Check size={14} />{item}</p>
                    ))}
                  </div>
                </div>
                <div className="deep-dive-block">
                  <span>02 · {rtl ? "إيقاع التعافي" : "RECOVERY RHYTHM"}</span>
                  <div className="recovery-rhythm">
                    {active.recovery.map((phase, index) => (
                      <article key={phase.label}>
                        <strong>0{index + 1}</strong>
                        <small>{phase.label}</small>
                        <p>{phase.text}</p>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="deep-dive-note">
                  <ShieldCheck size={17} />
                  <p>
                    {rtl
                      ? "كل خطة ومدة تعافٍ تختلف حسب الفحص والإجراء والصحة العامة."
                      : "Every plan and recovery timeline is individual and depends on assessment, procedure, and overall health."}
                  </p>
                </div>
                <button
                  className="button button--burgundy button--large"
                  onClick={() => {
                    setDetailOpen(false);
                    onBook();
                  }}
                >
                  <CalendarDays size={17} />
                  {rtl ? "احجز استشارة متخصصة" : "Reserve a specialist consultation"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
