"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bone,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  Droplets,
  GitBranch,
  ImageIcon,
  Layers3,
  Link2,
  Rotate3D,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import {
  AREAS,
  TOOTH_REGION,
  findArea,
  type AreaId,
  type LayerId,
} from "@/lib/anatomy";

type Language = "en" | "ar";
type AnatomyLayerId =
  | "skin"
  | "muscles"
  | "fat"
  | "vessels"
  | "ligaments"
  | "nerves"
  | "skeleton";

type AnatomyLayer = {
  id: AnatomyLayerId;
  en: string;
  ar: string;
  depth: LayerId;
  icon: LucideIcon;
};

const ANATOMY_LAYERS: AnatomyLayer[] = [
  { id: "skin", en: "Skin", ar: "الجلد", depth: "surface", icon: ScanFace },
  { id: "muscles", en: "Muscles", ar: "العضلات", depth: "structure", icon: Activity },
  { id: "fat", en: "Fat Pads", ar: "الوسائد الدهنية", depth: "structure", icon: CircleDashed },
  { id: "vessels", en: "Vessels", ar: "الأوعية", depth: "structure", icon: GitBranch },
  { id: "ligaments", en: "Ligaments", ar: "الأربطة", depth: "structure", icon: Link2 },
  { id: "nerves", en: "Nerves", ar: "الأعصاب", depth: "structure", icon: Waves },
  { id: "skeleton", en: "Skeleton", ar: "الهيكل", depth: "skeleton", icon: Bone },
];

const DOCK_LAYER_IDS: AnatomyLayerId[] = ["skin", "fat", "skeleton", "vessels", "nerves"];
const CARE_AREA_IDS: AreaId[] = ["face", "body", "breast", "dental", "dermatology"];

const CARE_AREA_LABELS: Record<AreaId, { en: string; ar: string }> = {
  face: { en: "Face & Neck", ar: "الوجه والرقبة" },
  nose: { en: "Nose", ar: "الأنف" },
  body: { en: "Body", ar: "الجسم" },
  breast: { en: "Breast", ar: "الثدي" },
  dental: { en: "Dental", ar: "الأسنان" },
  dermatology: { en: "Dermatology", ar: "الأمراض الجلدية" },
};

const BENEFITS = [
  { icon: Droplets, en: "Restores Volume", ar: "استعادة الحجم" },
  { icon: CircleDashed, en: "Improves Contours", ar: "تحسين التناسق" },
  { icon: Sparkles, en: "Natural Rejuvenation", ar: "تجدد طبيعي" },
  { icon: Clock3, en: "Long Lasting Results", ar: "نتائج طويلة الأمد" },
];

const MIDFACE_PROCEDURES = [
  "Mid-Facelift",
  "Fat Transfer",
  "Buccal Fat Removal",
  "Cheek Augmentation",
];

const TreatmentCanvas = dynamic(() => import("./TreatmentCanvas"), {
  ssr: false,
  loading: () => <div className="universe-canvas-placeholder" aria-hidden />,
});

/** Keep the sizeable WebGL scene out of the critical page load. */
function LazyTreatmentCanvas(props: React.ComponentProps<typeof TreatmentCanvas>) {
  const anchor = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => typeof IntersectionObserver === "undefined");

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
      {ready ? <TreatmentCanvas {...props} /> : <div className="universe-canvas-placeholder" aria-hidden />}
    </div>
  );
}

function LayerButton({
  entry,
  active,
  rtl,
  compact = false,
  onSelect,
}: {
  entry: AnatomyLayer;
  active: boolean;
  rtl: boolean;
  compact?: boolean;
  onSelect: (id: AnatomyLayerId) => void;
}) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-pressed={active}
      aria-label={rtl ? entry.ar : entry.en}
      onClick={() => onSelect(entry.id)}
    >
      <span className={compact ? "layer-thumb" : "layer-icon"}><Icon size={compact ? 17 : 19} /></span>
      <small>{rtl ? entry.ar : entry.en}</small>
    </button>
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
  const [areaId, setAreaId] = useState<AreaId>("face");
  const [layerId, setLayerId] = useState<AnatomyLayerId>("skin");
  const [regionId, setRegionId] = useState("midface");
  const [detailOpen, setDetailOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [hasOrbited, setHasOrbited] = useState(false);

  const area = findArea(areaId);
  const activeLayer = ANATOMY_LAYERS.find((entry) => entry.id === layerId) ?? ANATOMY_LAYERS[0];
  const region = area.regions.find((entry) => entry.id === regionId) ?? area.regions[0];
  const displayedAreas = useMemo(
    () => CARE_AREA_IDS.map((id) => AREAS.find((entry) => entry.id === id)).filter(Boolean),
    [],
  );

  const selectArea = (next: AreaId) => {
    const nextArea = findArea(next);
    setAreaId(next);
    setRegionId(next === "face" ? "midface" : nextArea.regions[0]?.id ?? "");
    setLayerId("skin");
    setHasOrbited(false);
    setComparisonOpen(false);
  };

  const commonProcedures = region.id === "midface"
    ? MIDFACE_PROCEDURES
    : (region.discussed?.length ? region.discussed : region.procedures).slice(0, 4);

  return (
    <>
      <div className="treatment-universe">
        <div className="universe-canvas">
          <LazyTreatmentCanvas
            area={areaId}
            layer={activeLayer.depth}
            tissue={activeLayer.id}
            framing={area.view}
            regions={area.regions}
            activeRegion={region.id}
            rtl={rtl}
            onSelect={setRegionId}
            onTooth={() => setRegionId(TOOTH_REGION[activeLayer.depth])}
            onEngage={() => setHasOrbited(true)}
          />

          <div className="universe-anatomy-rail" role="group" aria-label={rtl ? "طبقات التشريح" : "Anatomy layers"}>
            {ANATOMY_LAYERS.map((entry) => (
              <LayerButton
                key={entry.id}
                entry={entry}
                active={entry.id === layerId}
                rtl={rtl}
                onSelect={setLayerId}
              />
            ))}
          </div>

          <div className="universe-model-status">
            <span>{rtl ? "نموذج تشريحي تفاعلي" : "INTERACTIVE ANATOMY"}</span>
            <strong>{rtl ? activeLayer.ar : activeLayer.en}</strong>
          </div>

          {!hasOrbited && (
            <div className="universe-rotate">
              <Rotate3D size={15} />
              <span>{rtl ? "اسحب للتدوير" : "DRAG TO ROTATE"}</span>
            </div>
          )}

          <div className="universe-layer-dock" role="group" aria-label={rtl ? "اختيار طبقة النموذج" : "Model layer selector"}>
            <button type="button" className="layer-dock-menu" aria-label={rtl ? "كل الطبقات" : "All layers"}>
              <Layers3 size={17} />
              <span>{rtl ? "الطبقات" : "Layers"}</span>
            </button>
            <button type="button" className="layer-dock-arrow" aria-label={rtl ? "الطبقة السابقة" : "Previous layer"}>
              <ChevronLeft size={15} />
            </button>
            {DOCK_LAYER_IDS.map((id) => {
              const entry = ANATOMY_LAYERS.find((candidate) => candidate.id === id)!;
              return (
                <LayerButton
                  key={id}
                  entry={entry}
                  active={entry.id === layerId}
                  rtl={rtl}
                  compact
                  onSelect={setLayerId}
                />
              );
            })}
            <button type="button" className="layer-dock-arrow" aria-label={rtl ? "الطبقة التالية" : "Next layer"}>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        <div className="universe-interface">
          <div className="universe-tabs" role="group" aria-label={rtl ? "مناطق الرعاية" : "Care areas"}>
            {displayedAreas.map((entry) => entry && (
              <button
                key={entry.id}
                type="button"
                aria-pressed={areaId === entry.id}
                className={areaId === entry.id ? "active" : ""}
                onClick={() => selectArea(entry.id)}
              >
                {rtl ? CARE_AREA_LABELS[entry.id].ar : CARE_AREA_LABELS[entry.id].en}
              </button>
            ))}
          </div>

          <div className="universe-detail" key={areaId}>
            <div className="universe-heading">
              <span className="universe-signal"><i />{rtl ? "منطقة محددة" : "AREA SELECTED"}</span>
              <h3>{rtl ? region.ar : region.en}</h3>
              <p>{rtl ? region.arOverview : region.overview}</p>
            </div>

            <div className="universe-region-picker" role="group" aria-label={rtl ? "المناطق التشريحية" : "Anatomical regions"}>
              {area.regions.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={region.id === entry.id ? "active" : ""}
                  aria-pressed={region.id === entry.id}
                  onClick={() => setRegionId(entry.id)}
                >
                  {rtl ? entry.ar : entry.en}
                </button>
              ))}
            </div>

            <div className="universe-information-grid">
              <section className="universe-structures" aria-labelledby="structures-heading">
                <h4 id="structures-heading">{rtl ? "التراكيب" : "Structures"}</h4>
                <div>
                  {ANATOMY_LAYERS.slice(0, 6).map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <button
                        type="button"
                        key={entry.id}
                        className={layerId === entry.id ? "active" : ""}
                        onClick={() => setLayerId(entry.id)}
                      >
                        <Icon size={16} />
                        <span>{rtl ? entry.ar : entry.en}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div className="universe-procedure-column">
                <section className="universe-procedure-card">
                  <span>{rtl ? "إجراءات شائعة" : "COMMON PROCEDURES"}</span>
                  {commonProcedures.map((item) => (
                    <button type="button" key={item} onClick={() => setDetailOpen(true)}>
                      <span>{item}</span><ArrowRight size={15} />
                    </button>
                  ))}
                </section>

                <button
                  type="button"
                  className="universe-before-after"
                  aria-expanded={comparisonOpen}
                  onClick={() => setComparisonOpen((value) => !value)}
                >
                  <ImageIcon size={17} />
                  <strong>{rtl ? "عرض قبل وبعد" : "View before & after"}</strong>
                  <ArrowRight size={16} />
                </button>
                {comparisonOpen && (
                  <p className="universe-comparison-note">
                    {rtl
                      ? "تُعرض الأمثلة السريرية المناسبة بصورة خاصة أثناء الاستشارة وبعد موافقة المريض."
                      : "Relevant clinical examples are reviewed privately during consultation and only with patient consent."}
                  </p>
                )}
              </div>
            </div>

            <section className="universe-benefits" aria-labelledby="benefits-heading">
              <h4 id="benefits-heading">{rtl ? "الفوائد الرئيسية" : "Key Benefits"}</h4>
              <div>
                {BENEFITS.map((benefit) => {
                  const Icon = benefit.icon;
                  return (
                    <article key={benefit.en}>
                      <Icon size={18} />
                      <span>{rtl ? benefit.ar : benefit.en}</span>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className="universe-actions">
              <button className="universe-primary" type="button" onClick={() => setDetailOpen(true)}>
                {rtl ? "افتح خريطة الاستشارة" : "Open consultation map"}
                <ArrowRight size={16} />
              </button>
              <button type="button" onClick={onAsk}>
                <Sparkles size={15} />
                {rtl ? "اسأل نور" : "Ask NOOR"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {detailOpen && (
        <Modal onClose={() => setDetailOpen(false)} layerClassName="specialty-layer" labelledBy="care-map-title">
          <section className="specialty-deep-dive" dir={rtl ? "rtl" : "ltr"}>
            <header>
              <button type="button" onClick={() => setDetailOpen(false)}>
                <ArrowLeft size={16} />
                {rtl ? "العودة إلى كير لِنز" : "Back to CareLens"}
              </button>
              <span>CARE MAP · {area.number}</span>
              <button type="button" onClick={() => setDetailOpen(false)} aria-label={rtl ? "إغلاق" : "Close"}><X /></button>
            </header>

            <div className="deep-dive-grid">
              <div className="deep-dive-intro">
                <span>{rtl ? "خريطة استشارتك" : "YOUR CONSULTATION MAP"}</span>
                <h2 id="care-map-title">{rtl ? region.ar : region.en}</h2>
                <p>{rtl ? region.arOverview : region.overview}</p>
                <div className="deep-dive-orb" aria-hidden><i /><i /><i /></div>
              </div>

              <div className="deep-dive-content">
                <div className="deep-dive-block">
                  <span>01 · {rtl ? "التراكيب المعنية" : "STRUCTURES INVOLVED"}</span>
                  <div className="deep-checks">
                    {(rtl ? region.arStructures : region.structures).map((item) => (
                      <p key={item}><Check size={14} />{item}</p>
                    ))}
                  </div>
                </div>

                <div className="deep-dive-block">
                  <span>02 · {rtl ? "نناقشه في الاستشارة" : "DISCUSSED AT CONSULTATION"}</span>
                  <div className="deep-checks deep-checks--muted">
                    {commonProcedures.map((item) => <p key={item}><Check size={14} />{item}</p>)}
                  </div>
                </div>

                <div className="deep-dive-block">
                  <span>03 · {rtl ? "إيقاع التعافي" : "RECOVERY RHYTHM"}</span>
                  <p className="deep-dive-copy">{rtl ? region.arRecovery : region.recovery}</p>
                </div>

                <div className="deep-dive-note">
                  <ShieldCheck size={17} />
                  <p>{rtl
                    ? "هذا النموذج تعليمي وليس تشخيصياً. يحدد الفحص السريري ما يناسب كل حالة."
                    : "This model is educational, not diagnostic. An in-person assessment determines what is appropriate for each patient."}</p>
                </div>

                <button
                  className="button button--burgundy button--large"
                  type="button"
                  onClick={() => { setDetailOpen(false); onBook(); }}
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
