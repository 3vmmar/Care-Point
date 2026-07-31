"use client";

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
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import type { CareLensArea } from "./TreatmentCanvas";

type Language = "en" | "ar";
type AreaId = CareLensArea;

const TreatmentCanvas = dynamic(() => import("./TreatmentCanvas"), {
  ssr: false,
  loading: () => <div className="universe-canvas-placeholder" aria-hidden />,
});

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

/**
 * The text controls arrive before the WebGL engine. This second viewport gate
 * keeps Three.js out of the 700px CareLens prefetch window until the actual
 * canvas is close enough to be seen.
 */
function LazyTreatmentCanvas({ selected, rtl }: { selected: AreaId; rtl: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const node = anchor.current;
    if (!node || ready) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "250px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div ref={anchor} className="universe-canvas-mount">
      {ready ? (
        <TreatmentCanvas selected={selected} rtl={rtl} />
      ) : (
        <div className="universe-canvas-placeholder" aria-hidden />
      )}
    </div>
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
          <LazyTreatmentCanvas selected={selected} rtl={rtl} />
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
        <Modal
          onClose={() => setDetailOpen(false)}
          layerClassName="specialty-layer"
          labelledBy="care-map-title"
        >
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
                <h2 id="care-map-title">{rtl ? active.ar : active.title}</h2>
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
        </Modal>
      )}
    </>
  );
}
