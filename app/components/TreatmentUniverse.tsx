"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Layers,
  Rotate3D,
  ScanLine,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import {
  AREAS,
  LAYERS,
  TOOTH_REGION,
  findArea,
  layerHint,
  layersFor,
  regionsVisibleAt,
  type AreaId,
  type LayerId,
} from "@/lib/anatomy";

type Language = "en" | "ar";

const TreatmentCanvas = dynamic(() => import("./TreatmentCanvas"), {
  ssr: false,
  loading: () => <div className="universe-canvas-placeholder" aria-hidden />,
});

/**
 * The text controls arrive before the WebGL engine. This second viewport gate
 * keeps Three.js out of the 700px CareLens prefetch window until the canvas is
 * close enough to be seen.
 */
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
  const [layer, setLayer] = useState<LayerId>("surface");
  const [regionId, setRegionId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [hasOrbited, setHasOrbited] = useState(false);

  const area = findArea(areaId);
  const available = useMemo(() => layersFor(area), [area]);
  const visible = useMemo(() => regionsVisibleAt(area, layer), [area, layer]);

  // The region rail is the keyboard path into the model, so a selection always
  // has to exist and always has to be one of the regions currently on screen.
  // Cutting to a deeper layer must never leave the panel describing something
  // the viewer can no longer see.
  const region = visible.find((candidate) => candidate.id === regionId) ?? visible[0] ?? null;

  const selectArea = (next: AreaId) => {
    setAreaId(next);
    setLayer("surface");
    setRegionId(null);
    setHasOrbited(false);
  };

  const selectLayer = (next: LayerId) => {
    setLayer(next);
    // Cutting deeper should reveal what is newly available, not keep the panel
    // on the skin region the viewer just looked past.
    const deeper = area.regions.find((candidate) => candidate.layer === next);
    if (deeper) setRegionId(deeper.id);
  };

  return (
    <>
      <div className="treatment-universe">
        <div className="universe-canvas">
          <LazyTreatmentCanvas
            area={areaId}
            layer={layer}
            framing={area.view}
            regions={visible}
            activeRegion={region?.id ?? null}
            rtl={rtl}
            onSelect={setRegionId}
            /* Clicking a tooth opens whatever that tooth means at this
               depth: its crown, its root, or the bone it is anchored in. */
            onTooth={() => setRegionId(TOOTH_REGION[layer])}
            onEngage={() => setHasOrbited(true)}
          />
          <div className="universe-scan-line" aria-hidden />
          <div className="universe-corner universe-corner--one" aria-hidden />
          <div className="universe-corner universe-corner--two" aria-hidden />

          <div className="universe-canvas-label">
            <ScanLine size={15} />
            <span>{rtl ? "نموذج توضيحي للاستكشاف" : "ILLUSTRATIVE STUDY MODEL"}</span>
          </div>

          {/* The hint retires once it has been obeyed. A prompt that keeps
              asking for something already done reads as an animation, not an
              instruction. */}
          {!hasOrbited && (
            <div className="universe-rotate">
              <Rotate3D size={14} />
              <span>{rtl ? "اسحب للتدوير" : "DRAG TO ROTATE"}</span>
            </div>
          )}

          <div className="universe-depth" role="group" aria-label={rtl ? "عمق العرض" : "View depth"}>
            <span className="universe-depth-tag">
              <Layers size={13} />
              {rtl ? "العمق" : "DEPTH"}
            </span>
            {available.map((id) => {
              const entry = LAYERS.find((candidate) => candidate.id === id)!;
              return (
                <button
                  key={id}
                  type="button"
                  className={layer === id ? "active" : ""}
                  aria-pressed={layer === id}
                  onClick={() => selectLayer(id)}
                >
                  {rtl ? entry.ar : entry.en}
                </button>
              );
            })}
          </div>
        </div>

        <div className="universe-interface">
          {/**
           * Buttons, not a tablist.
           *
           * An earlier version declared `role="tablist"` / `role="tab"`, which
           * promises a contract this markup does not keep: no `aria-controls`,
           * no `role="tabpanel"`, and no arrow-key navigation between tabs. A
           * screen reader announces "tab, 1 of 5" and the user reaches for
           * arrow keys that do nothing — worse than plain buttons, which behave
           * exactly as announced. `aria-pressed` carries the selected state and
           * matches the region rail below, so both controls work the same way.
           */}
          <div className="universe-tabs" role="group" aria-label={rtl ? "مناطق الرعاية" : "Care areas"}>
            {AREAS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={areaId === entry.id}
                className={areaId === entry.id ? "active" : ""}
                onClick={() => selectArea(entry.id)}
              >
                <span>{entry.number}</span>
                <strong>{rtl ? entry.ar : entry.en}</strong>
              </button>
            ))}
          </div>

          <div className="universe-detail" key={`${areaId}-${layer}`}>
            <span className="universe-signal"><i />{rtl ? "منطقة محددة" : "AREA SELECTED"}</span>
            <h3>“{rtl ? area.arFeeling : area.feeling}”</h3>
            <p>{rtl ? area.arDescription : area.description}</p>
            <p className="universe-depth-hint">{layerHint(area, layer, rtl)}</p>

            {/**
             * The accessible path into the model.
             *
             * Every marker on the canvas is one of these buttons. The canvas is
             * `aria-hidden` because it cannot describe itself, so this rail is
             * not a convenience — it is the only way a keyboard or a screen
             * reader reaches the same content.
             */}
            <div className="universe-regions" role="group" aria-label={rtl ? "المناطق التشريحية" : "Anatomical regions"}>
              {visible.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={region?.id === entry.id ? "active" : ""}
                  aria-pressed={region?.id === entry.id}
                  onClick={() => setRegionId(entry.id)}
                >
                  {rtl ? entry.ar : entry.en}
                </button>
              ))}
            </div>

            {region && (
              <div className="universe-region-card" key={region.id}>
                <h4>{rtl ? region.ar : region.en}</h4>
                <p>{rtl ? region.arOverview : region.overview}</p>

                <div className="universe-region-meta">
                  <span>{rtl ? "التكوين" : "STRUCTURES"}</span>
                  <div className="universe-tags">
                    {(rtl ? region.arStructures : region.structures).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>

                {region.procedures.length > 0 && (
                  <div className="universe-region-meta">
                    <span>{rtl ? "متاح للحجز الآن" : "AVAILABLE TO BOOK"}</span>
                    <div className="universe-tags universe-tags--offer">
                      {(rtl ? region.arProcedures : region.procedures).map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

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

      {detailOpen && region && (
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
              <span>CARE MAP · {area.number}</span>
              <button onClick={() => setDetailOpen(false)} aria-label={rtl ? "إغلاق" : "Close"}><X /></button>
            </header>

            <div className="deep-dive-grid">
              <div className="deep-dive-intro">
                <span>{rtl ? "خريطة استشارتك" : "YOUR CONSULTATION MAP"}</span>
                <h2 id="care-map-title">{rtl ? area.ar : area.en}</h2>
                <p>{rtl ? area.arDescription : area.description}</p>
                <div className="deep-dive-orb" aria-hidden><i /><i /><i /></div>
              </div>

              <div className="deep-dive-content">
                <div className="deep-dive-block">
                  <span>01 · {rtl ? "المنطقة" : "THE REGION"}</span>
                  <h3 className="deep-dive-region">{rtl ? region.ar : region.en}</h3>
                  <p className="deep-dive-copy">{rtl ? region.arOverview : region.overview}</p>
                </div>

                <div className="deep-dive-block">
                  <span>02 · {rtl ? "ما يشمله" : "STRUCTURES INVOLVED"}</span>
                  <div className="deep-checks">
                    {(rtl ? region.arStructures : region.structures).map((item) => (
                      <p key={item}><Check size={14} />{item}</p>
                    ))}
                  </div>
                </div>

                {region.procedures.length > 0 && (
                  <div className="deep-dive-block">
                    <span>03 · {rtl ? "متاح للحجز الآن" : "AVAILABLE TO BOOK"}</span>
                    <div className="deep-checks">
                      {(rtl ? region.arProcedures : region.procedures).map((item) => (
                        <p key={item}><Check size={14} />{item}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/**
                 * Kept separate from the bookable list on purpose.
                 *
                 * These are topics the surgeon raises, not services the booking
                 * form can take. Merging the two lists would advertise
                 * treatments the clinic does not offer — a dead end for the
                 * patient, and an advertising problem under the Medical
                 * Syndicate's rules.
                 */}
                {region.discussed && region.discussed.length > 0 && (
                  <div className="deep-dive-block">
                    <span>04 · {rtl ? "نناقشه في الاستشارة" : "DISCUSSED AT CONSULTATION"}</span>
                    <div className="deep-checks deep-checks--muted">
                      {(rtl ? region.arDiscussed ?? [] : region.discussed).map((item) => (
                        <p key={item}><Check size={14} />{item}</p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="deep-dive-block">
                  <span>05 · {rtl ? "إيقاع التعافي" : "RECOVERY RHYTHM"}</span>
                  <p className="deep-dive-copy">{rtl ? region.arRecovery : region.recovery}</p>
                </div>

                <div className="deep-dive-note">
                  <ShieldCheck size={17} />
                  <p>
                    {rtl
                      ? "هذا النموذج توضيحي وليس تشخيصياً. كل خطة ومدة تعافٍ تختلف حسب الفحص والإجراء والصحة العامة."
                      : "This model is illustrative, not diagnostic. Every plan and recovery timeline is individual and depends on assessment, procedure, and overall health."}
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
