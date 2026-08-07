"use client";

// CareLens's own styling, in CareLens's own chunk. Imported here — never from
// a page — so the ~1,500 lines that style this explorer download only when
// the explorer itself does. Importing it at page level is how 47KB of Clinic
// OS styling once shipped to every patient, and the rule from that incident
// applies unchanged.
import "./carelens.css";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Info,
  Rotate3D,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Modal from "./Modal";
import AnatomySystemToolbar from "./carelens/AnatomySystemToolbar";
import LayerSelectorDock from "./carelens/LayerSelectorDock";
import ModelLoadingFallback from "./carelens/ModelLoadingFallback";
import {
  AREAS,
  TOOTH_REGION,
  findArea,
  layerHint,
  layersFor,
  regionsVisibleAt,
  type AreaId,
  type LayerId,
} from "@/lib/anatomy";
import { SERVICES } from "@/lib/clinic";

type Language = "en" | "ar";

const MOBILE_CARELENS_QUERY = "(max-width: 768px)";
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const TreatmentDirectionContext = createContext(false);

function TreatmentCanvasLoadingFallback() {
  return <ModelLoadingFallback rtl={useContext(TreatmentDirectionContext)} />;
}

const TreatmentCanvas = dynamic(() => import("./TreatmentCanvas"), {
  ssr: false,
  loading: TreatmentCanvasLoadingFallback,
});

function subscribeToMobileCareLens(callback: () => void) {
  const media = window.matchMedia(MOBILE_CARELENS_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function mobileCareLensSnapshot() {
  return window.matchMedia(MOBILE_CARELENS_QUERY).matches;
}

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
    <TreatmentDirectionContext.Provider value={props.rtl}>
      <div ref={anchor} className="universe-canvas-mount">
        {ready ? <TreatmentCanvas {...props} /> : <ModelLoadingFallback rtl={props.rtl} />}
      </div>
    </TreatmentDirectionContext.Provider>
  );
}

export default function TreatmentUniverse({
  language,
  onBook,
  onAsk,
}: {
  language: Language;
  onBook: (serviceId?: string) => void;
  onAsk: () => void;
}) {
  const rtl = language === "ar";
  const [areaId, setAreaId] = useState<AreaId>("face");
  const [layer, setLayer] = useState<LayerId>("surface");
  const [regionId, setRegionId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [hasOrbited, setHasOrbited] = useState(false);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const infoTriggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileCareLens,
    mobileCareLensSnapshot,
    () => false,
  );
  const mobileSheetVisible = isMobileViewport && mobileInfoOpen;
  // The consultation map is its own modal. Suspending this trap while it is
  // open prevents Tab and Escape from being handled by two dialogs at once.
  const mobileSheetActive = mobileSheetVisible && !detailOpen;

  const area = findArea(areaId);
  const available = useMemo(() => layersFor(area), [area]);
  const visible = useMemo(() => regionsVisibleAt(area, layer), [area, layer]);

  // The region rail is the keyboard path into the model, so a selection always
  // has to exist and always has to be one of the regions currently on screen.
  // Cutting to a deeper layer must never leave the panel describing something
  // the viewer can no longer see.
  const region = visible.find((candidate) => candidate.id === regionId) ?? visible[0] ?? null;
  const selectedServiceId = region
    ? SERVICES.find((service) => region.procedures.includes(service.en))?.id
    : undefined;

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

  const openMobileInfo = () => {
    if (!isMobileViewport) return;
    const focused = document.activeElement;
    returnFocusRef.current = focused instanceof HTMLElement && focused !== document.body
      ? focused
      : infoTriggerRef.current;
    setMobileInfoOpen(true);
  };

  useEffect(() => {
    if (!mobileSheetActive) return;
    const panel = infoPanelRef.current;
    const returnTarget = returnFocusRef.current ?? infoTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.tabIndex >= 0 && element.offsetParent !== null,
      );

    // The sheet changes from `visibility: hidden` in the same commit. Waiting
    // one frame lets that style settle; focusing while it is still hidden is
    // ignored by browsers and leaves focus on the newly inert canvas.
    const focusFrame = window.requestAnimationFrame(() => {
      (focusables()[0] ?? panel)?.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileInfoOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, [mobileSheetActive]);

  return (
    <>
      <div className={`treatment-universe${mobileSheetVisible ? " mobile-info-open" : ""}`}>
        <div
          className="universe-canvas"
          aria-hidden={mobileSheetVisible || undefined}
          inert={mobileSheetVisible || undefined}
        >
          <LazyTreatmentCanvas
            area={areaId}
            layer={layer}
            framing={area.view}
            regions={visible}
            activeRegion={region?.id ?? null}
            focusRegion={regionId ? region : null}
            rtl={rtl}
            onSelect={(id) => {
              setRegionId(id);
              openMobileInfo();
            }}
            /* Clicking a tooth opens whatever that tooth means at this
               depth: its crown, its root, or the bone it is anchored in. */
            onTooth={() => {
              setRegionId(TOOTH_REGION[layer]);
              openMobileInfo();
            }}
            onEngage={() => setHasOrbited(true)}
          />
          <div className="universe-rings" aria-hidden><i /><i /><i /></div>

          <AnatomySystemToolbar
            activeArea={areaId}
            rtl={rtl}
            onSelect={selectArea}
          />

          {/* The hint retires once it has been obeyed. A prompt that keeps
              asking for something already done reads as an animation, not an
              instruction. */}
          {!hasOrbited && (
            <div className="universe-rotate">
              <Rotate3D size={14} />
              <span>{rtl ? "اسحب للتدوير" : "DRAG TO ROTATE"}</span>
            </div>
          )}

          <button
            ref={infoTriggerRef}
            type="button"
            className="universe-info-trigger"
            aria-expanded={mobileSheetVisible}
            aria-controls="carelens-information"
            onClick={openMobileInfo}
          >
            <Info size={16} />
            <span>{region ? (rtl ? region.ar : region.en) : (rtl ? area.ar : area.en)}</span>
          </button>

          <LayerSelectorDock
            available={available}
            activeLayer={layer}
            rtl={rtl}
            onSelect={selectLayer}
          />

          <div className="universe-safety-note" role="note">
            <ShieldCheck size={14} />
            <span>
              {rtl
                ? "للتثقيف ودعم الاستشارة فقط — ليس تشخيصاً طبياً ولا ضماناً للنتيجة النهائية. تعتمد النتائج الفعلية على المريض والإجراء والتعافي وتقييم الطبيب."
                : "For education and consultation support only — not a medical diagnosis or a guaranteed final result. Actual results depend on the patient, procedure, healing process, and doctor’s assessment."}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="universe-sheet-backdrop"
          tabIndex={-1}
          aria-hidden
          onClick={() => setMobileInfoOpen(false)}
        />

        <div
          ref={infoPanelRef}
          className="universe-interface"
          id="carelens-information"
          role={mobileSheetActive ? "dialog" : undefined}
          aria-modal={mobileSheetActive ? "true" : undefined}
          aria-label={mobileSheetActive
            ? (rtl ? "معلومات المنطقة التشريحية" : "Anatomy information")
            : undefined}
          aria-hidden={isMobileViewport && !mobileSheetActive ? true : undefined}
          inert={isMobileViewport && !mobileSheetActive ? true : undefined}
          tabIndex={mobileSheetActive ? -1 : undefined}
        >
          <div className="universe-sheet-handle" aria-hidden />
          <button
            type="button"
            className="universe-sheet-close"
            onClick={() => setMobileInfoOpen(false)}
            aria-label={rtl ? "إغلاق معلومات التشريح" : "Close anatomy information"}
          >
            <X size={19} />
          </button>
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
              <button onClick={() => {
                // NOOR opens a separate modal owned by the page. Retire this
                // sheet first so two focus traps never compete.
                setMobileInfoOpen(false);
                onAsk();
              }}>
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
                      ? "هذا النموذج التعليمي يدعم الاستشارة، وليس تشخيصاً طبياً أو ضماناً للنتيجة النهائية. تعتمد النتائج الفعلية على المريض والإجراء وعملية التعافي وتقييم الطبيب."
                      : "This educational model supports consultation; it is not a medical diagnosis or a guaranteed final outcome. Actual results depend on the patient, procedure, healing process, and doctor’s assessment."}
                  </p>
                </div>

                <button
                  className="button button--burgundy button--large"
                  onClick={() => {
                    // Booking is another page-level modal. Do not reactivate
                    // the mobile anatomy dialog underneath it.
                    setMobileInfoOpen(false);
                    setDetailOpen(false);
                    onBook(selectedServiceId);
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
