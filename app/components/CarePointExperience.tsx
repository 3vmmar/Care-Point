"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Globe2,
  HeartPulse,
  MapPin,
  Menu,
  MessageCircle,
  Mic,
  Navigation,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import dynamic from "next/dynamic";
import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ExperienceIntro from "./ExperienceIntro";
import JourneyDesigner from "./JourneyDesigner";
import Modal from "./Modal";
import Turnstile from "./Turnstile";
import {
  BRANCH_IDS,
  BRANCHES,
  CONTACT,
  branchOpenDays,
  SERVICE_CATEGORIES,
  SERVICES,
  WHATSAPP_URL,
  type Branch,
  type Service,
} from "@/lib/clinic";
import { copyFor, LOCALE_PATH, otherLanguage, type Language } from "@/lib/i18n";
import { TREATMENTS, treatmentCopy, treatmentPath } from "@/lib/treatments";

// The CareLens scene pulls in Three.js — roughly 890KB that the hero does not
// need, and that cannot render on the server anyway.
const TreatmentUniverse = dynamic(() => import("./TreatmentUniverse"), {
  ssr: false,
  loading: () => <div className="treatment-universe treatment-universe--loading" aria-hidden />,
});

const OPEN_BOOKING_EVENT = "carepoint:open-booking";

type BookingOpenDetail = { serviceId?: string };

/** Ignore stale or hand-authored service ids instead of opening a broken form. */
function validServiceId(value: unknown): string | undefined {
  return typeof value === "string" && SERVICES.some((service) => service.id === value)
    ? value
    : undefined;
}

/**
 * Booking owns its own render boundary. The patient page is intentionally rich
 * and large; keeping modal state in the page root made one tap reconcile the
 * entire experience before the dialog could paint on a throttled phone.
 */
function BookingLauncher({ language }: { language: Language }) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [initialService, setInitialService] = useState<string>();
  useEffect(() => {
    // Prepare the sizeable form after the hero has settled. A later tap then
    // reveals existing DOM instead of constructing the whole form in the input
    // event on a mid-range phone.
    let prepare: number | undefined;
    const prepareAfterLoad = () => {
      prepare = window.setTimeout(() => setPrepared(true), 700);
    };
    if (document.readyState === "complete") prepareAfterLoad();
    else window.addEventListener("load", prepareAfterLoad, { once: true });
    const show = (event: Event) => {
      const detail = (event as CustomEvent<BookingOpenDetail>).detail;
      setInitialService(validServiceId(detail?.serviceId));
      setPrepared(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_BOOKING_EVENT, show);
    return () => {
      if (prepare) window.clearTimeout(prepare);
      window.removeEventListener("load", prepareAfterLoad);
      window.removeEventListener(OPEN_BOOKING_EVENT, show);
    };
  }, []);
  if (!prepared) return null;
  return (
    <BookingModal
      key={`${generation}:${initialService ?? "default"}`}
      language={language}
      initialService={initialService}
      open={open}
      onClose={() => {
        setOpen(false);
        // Reset completed or half-filled forms away from the close interaction.
        window.setTimeout(() => setGeneration((value) => value + 1), 400);
      }}
    />
  );
}

/**
 * Holds the CareLens chunk back until the section nears the viewport. Without
 * this gate the dynamic import still fires immediately after hydration, which
 * puts the download back in competition with the hero on a slow connection.
 */
function LazyCareLens(props: {
  language: Language;
  /** A CareLens region may nominate the exact consultation it describes. */
  onBook: (serviceId?: string) => void;
  onAsk: () => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  // Without IntersectionObserver there is nothing to wait for, so render the
  // scene straight away. `dynamic(ssr:false)` renders the same placeholder on
  // the server either way, so the hydrated markup still matches.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const node = anchor.current;
    if (!node || inView) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setInView(true);
        observer.disconnect();
      },
      // Start fetching a screen early so the scene is ready on arrival.
      { rootMargin: "700px 0px" },
    );
    observer.observe(node);

    // Backstop: the hero has long since painted by now, so mounting the scene
    // costs nothing on the critical path — and CareLens is too important to
    // depend solely on an observer callback arriving.
    const fallback = window.setTimeout(() => {
      setInView(true);
      observer.disconnect();
    }, 4000);

    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, [inView]);

  return (
    <div ref={anchor}>
      {inView ? (
        <TreatmentUniverse {...props} />
      ) : (
        <div className="treatment-universe treatment-universe--loading" aria-hidden />
      )}
    </div>
  );
}

type AvailabilityDay = {
  date: string;
  weekday: string;
  day: string;
  closure: string | null;
  slots: string[];
};
type NextAvailable = { date: string; time: string; label: string } | null;
type ChatMessage = { role: "assistant" | "user"; text: string };

type SpeechResult = { results: { 0: { 0: { transcript: string } } } };
type SpeechRecognitionLike = {
  lang: string;
  start: () => void;
  abort?: () => void;
  onresult: (event: SpeechResult) => void;
  onerror: () => void;
  onend?: () => void;
};

const INTRO_STORAGE_KEY = "carepoint:intro-seen";

const journey = [
  {
    icon: MessageCircle,
    step: "01",
    title: "Ask",
    ar: "اسأل",
    text: "Start privately with NOOR or reserve a consultation directly.",
    arText: "ابدأ بسؤال نور بخصوصية أو احجز استشارتك مباشرة.",
  },
  {
    icon: HeartPulse,
    step: "02",
    title: "Understand",
    ar: "افهم",
    text: "A detailed assessment turns your goals into clear, realistic options.",
    arText: "تقييم دقيق يحول أهدافك إلى خيارات واضحة وواقعية.",
  },
  {
    icon: Sparkles,
    step: "03",
    title: "Design",
    ar: "صمّم",
    text: "Your treatment and recovery plan is created around your life.",
    arText: "خطة العلاج والتعافي مصممة لتناسب حياتك.",
  },
  {
    icon: ShieldCheck,
    step: "04",
    title: "Stay connected",
    ar: "ابقَ على تواصل",
    text: "Guided preparation and structured follow-up, in one continuous journey.",
    arText: "استعداد مدروس ومتابعة منظمة في رحلة واحدة متصلة.",
  },
];

function NoorOrb({ small = false }: { small?: boolean }) {
  return (
    <span className={`noor-orb ${small ? "noor-orb--small" : ""}`} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/**
 * `language` arrives as a prop from the route rather than living in state: each
 * language has its own URL, so the server already knows which one to render and
 * the markup a crawler receives is correct without running any script.
 */
export default function CarePointExperience({ language }: { language: Language }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [noorOpen, setNoorOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(true);
  const [journeyDesignerOpen, setJourneyDesignerOpen] = useState(false);
  const [heroPassed, setHeroPassed] = useState(false);
  const [footerInView, setFooterInView] = useState(false);
  const [nextAvailable, setNextAvailable] = useState<NextAvailable>(null);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const t = copyFor(language);
  const rtl = language === "ar";
  const altLanguage = otherLanguage(language);

  // Restored before paint so a returning visitor does not see the intro replay.
  // Initial state still matches the server render, so hydration stays clean —
  // which is exactly why this cannot move into a `useState` initialiser, where
  // `localStorage` is unavailable on the server.
  useLayoutEffect(() => {
    try {
      if (window.localStorage.getItem(INTRO_STORAGE_KEY) === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIntroOpen(false);
      }
    } catch {
      // Private browsing can deny storage access; defaults are fine.
    }
  }, []);

  const dismissIntro = useCallback(() => {
    setIntroOpen(false);
    try {
      window.localStorage.setItem(INTRO_STORAGE_KEY, "1");
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  /**
   * The hero used to advertise a hardcoded "Tomorrow · Maadi". It now shows the
   * clinic's real next opening, so the headline claim and the booking modal can
   * never disagree.
   */
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/availability?locale=${language}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as { nextAvailable?: NextAvailable };
      })
      .then((data) => {
        setNextAvailable(data.nextAvailable ?? null);
        setAvailabilityChecked(true);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setAvailabilityChecked(true);
      });
    return () => controller.abort();
  }, [language]);

  /**
   * Smooth scrolling.
   *
   * Lenis and GSAP each want to own a requestAnimationFrame loop; running both
   * means two callbacks per frame reading and writing scroll position, which is
   * where the previous stutter came from. Driving Lenis from GSAP's ticker puts
   * everything on one clock, and disabling lag smoothing stops GSAP from
   * jumping the timeline forward after a dropped frame.
   */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({
      // Lenis handles in-page anchor clicks itself. `html { scroll-behavior:
      // smooth }` used to do it too, and the two easing the same target at once
      // produced a stick-then-jump on every nav click.
      anchors: true,
      // A lerp reads smoother than a fixed duration: it eases toward the target
      // continuously instead of restarting a tween on every wheel event.
      lerp: 0.09,
      smoothWheel: true,
      syncTouch: false,
      touchMultiplier: 1.6,
      wheelMultiplier: 1,
    });

    const syncScroll = () => ScrollTrigger.update();
    const drive = (time: number) => lenis.raf(time * 1000);

    lenis.on("scroll", syncScroll);
    gsap.ticker.add(drive);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(drive);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.off("scroll", syncScroll);
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    const hero = document.querySelector(".hero");
    if (!hero) return;

    const observer = new IntersectionObserver(
      ([entry]) => setHeroPassed(!entry.isIntersecting),
      { threshold: 0.08 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  /**
   * The floating NOOR button sits in the same corner as the footer's Clinic OS
   * link and used to cover it outright at the bottom of the page. Docking it
   * out of the way once the footer arrives keeps both reachable, and reads as
   * intentional rather than as an overlap.
   */
  useEffect(() => {
    const footer = document.querySelector(".site-footer");
    if (!footer) return;

    const observer = new IntersectionObserver(
      ([entry]) => setFooterInView(entry.isIntersecting),
      { rootMargin: "0px 0px -12% 0px", threshold: 0 },
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    if (
      introOpen ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const context = gsap.context(() => {
      // force3D keeps transformed elements on their own compositor layer for
      // the length of the tween, which is what removes the edge shimmer on the
      // portrait and the section reveals.
      gsap.config({ force3D: true });

      gsap.fromTo(
        ".portrait-frame",
        { clipPath: "inset(0 0 100% 0)" },
        {
          clipPath: "inset(0 0 0% 0)",
          duration: 1.5,
          delay: 0.08,
          ease: "expo.out",
        },
      );

      gsap.fromTo(
        ".portrait-chrome, .portrait-footer",
        { autoAlpha: 0, y: 14 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.85,
          delay: 0.75,
          stagger: 0.1,
          ease: "power2.out",
        },
      );

      gsap.to(".scroll-progress span", {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
      });

      /**
       * The hero's hold and exit, choreographed across the sticky stage.
       *
       * The stage (`.hero-stage`, CSS `position: sticky`) provides the hold as
       * static layout; this timeline is only the choreography inside it. The
       * scrub runs from the moment the hero docks under the header to the moment
       * the stage releases it, so every phase below is a fraction of the hold:
       *
       *   0.00–0.30  the scroll cue retires; the portrait starts to breathe in
       *   0.30–0.70  the copy settles back and dims — the visitor has committed
       *   0.70–1.00  the whole hero eases upward slightly, handing off to the
       *              portal section with momentum instead of a hard edge
       *
       * One timeline, not three triggers, so the phases cannot drift apart at
       * different scrub rates. A ScrollTrigger `pin:` is deliberately not used —
       * its injected spacer re-measures on every async settle and broke the
       * site's in-page anchor navigation; sticky has nothing to re-measure.
       */
      const heroTimeline = gsap.timeline({
        scrollTrigger: {
          trigger: ".hero-stage",
          start: "top 104px",
          end: "bottom bottom",
          scrub: 1.05,
          invalidateOnRefresh: true,
        },
        defaults: { ease: "none" },
      });

      heroTimeline
        .to(".hero-rail", { autoAlpha: 0, y: 18, duration: 0.18 }, 0)
        .to(".portrait-frame img", { yPercent: 6, scale: 1.06, duration: 1 }, 0)
        // The dim lives on the two children that already fade rather than on
        // `.hero` itself. An opacity below 1 on the parent forces the whole
        // subtree into an offscreen buffer for the entire sticky hold — the
        // longest-held moment on the page — and the hero contains a portrait,
        // a clip-path frame and a translucent card. The children reach the
        // same visual result compositing in place.
        .to(".hero-copy", { yPercent: 10, opacity: 0.32, duration: 0.4 }, 0.3)
        .to(".hero-visual", { yPercent: -3, opacity: 0.82, duration: 0.4 }, 0.34)
        .to(".hero", { yPercent: -5, duration: 0.3 }, 0.7);

      /**
       * Two reveal families, so the page has cadence instead of a single verb.
       *
       * Headings announce: they rise out of a clip with their index line, a
       * touch slower, always alone. Content answers: cards and panels lift in
       * a stagger with a hint of scale, so a section reads as "statement, then
       * evidence" rather than one undifferentiated fade repeated down the page
       * — the exact repetition the brief calls out.
       *
       * Batching (rather than per-element triggers) keeps the stagger honest:
       * whatever genuinely enters together animates together.
       */
      ScrollTrigger.batch(".section-heading, .proof-intro", {
        start: "top 86%",
        once: true,
        onEnter: (batch) =>
          gsap.fromTo(
            batch,
            { autoAlpha: 0, y: 44, clipPath: "inset(0 0 26% 0)" },
            {
              autoAlpha: 1,
              y: 0,
              clipPath: "inset(0 0 0% 0)",
              duration: 1.15,
              ease: "power3.out",
              overwrite: true,
            },
          ),
      });

      /**
       * What is LEFT in the shared batch.
       *
       * This selector used to carry seven groups, which meant one 30px fade-up
       * was the entire vocabulary for most of the page — the mechanical reason
       * it read as generic. CareLens, Journey, Locations and the final CTA have
       * their own signatures below; only the stat row and the NOOR panel still
       * want a plain arrival, because both sit inside sections whose character
       * is carried by something else (the counters, the orbiting orb).
       */
      ScrollTrigger.batch(
        ".proof-stats article, .noor-feature > *",
        {
          start: "top 88%",
          once: true,
          onEnter: (batch) =>
            gsap.fromTo(
              batch,
              { autoAlpha: 0, y: 30, scale: 0.988 },
              {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                duration: 0.95,
                stagger: 0.09,
                ease: "power2.out",
                overwrite: true,
              },
            ),
        },
      );

      /* ------------------------------------------------------------------ */
      /* Per-section signatures                                              */
      /* ------------------------------------------------------------------ */
      /**
       * One distinct, scroll-linked gesture per section.
       *
       * The point is not more motion — the page already had two genuinely
       * authored instruments in its first two screens. The point is that
       * everything after them shared a single fade-up and then froze, so the
       * bottom half of the page read as a still image. Each signature below is
       * driven by scroll position, so it is legible while scrolling and in a
       * screenshot taken mid-scroll, which hover effects are not.
       */

      /**
       * CareLens: an instrument powers on. A centre-out wipe rather than a
       * fade — the one gesture on the page that says "device", which is what
       * this is.
       *
       * clip-path and opacity ONLY, never scale: this element is the ancestor
       * of five backdrop-filter children, and a transform on a backdrop-filter
       * ancestor moves the backdrop root mid-tween and makes the docks flicker.
       */
      gsap.fromTo(
        ".treatment-universe",
        // autoAlpha 0, not a partial wash: the closed clip already hides
        // everything, and a resting opacity between 0 and 1 makes axe measure
        // every colour in the un-scrolled instrument against a blended
        // background — 32 contrast violations from a section nobody had
        // scrolled to yet. Fully hidden is skipped; partially hidden is judged.
        { clipPath: "inset(0 50% 0 50%)", autoAlpha: 0 },
        {
          clipPath: "inset(0 0% 0 0%)",
          autoAlpha: 1,
          duration: 1.25,
          ease: "power3.inOut",
          scrollTrigger: { trigger: ".treatment-universe", start: "top 82%", once: true },
        },
      );

      /** The CARELENS watermark finally gets the parallax its own comment
       *  promised — the same device as BEYOND, treated the same way. */
      gsap.fromTo(
        ".carelens-word",
        { yPercent: 10 },
        {
          yPercent: -10,
          ease: "none",
          scrollTrigger: {
            trigger: ".carelens",
            start: "top bottom",
            end: "bottom top",
            scrub: 1.2,
          },
        },
      );

      /**
       * Journey: the content IS a sequence, so the cards assemble in order,
       * keyed to scroll position rather than firing together. You watch the
       * four steps arrive as you scroll them.
       */
      gsap.fromTo(
        ".journey-grid article",
        { autoAlpha: 0, y: 54, clipPath: "inset(0 0 40% 0)" },
        {
          autoAlpha: 1,
          y: 0,
          clipPath: "inset(0 0 0% 0)",
          ease: "power2.out",
          stagger: 0.18,
          duration: 0.9,
          scrollTrigger: { trigger: ".journey-grid", start: "top 88%", once: true },
        },
      );

      /**
       * Locations: the content is geography — three places across a city — so
       * the cards arrive laterally from outside the measure rather than rising.
       * Mirrored under RTL, where "outside" is the other way round.
       */
      const lateral = document.dir === "rtl" ? -1 : 1;
      // One tween per card rather than a single call with a function-based
      // from-state: GSAP resolves a per-index from lazily and will not apply
      // it up front even with immediateRender, so the cards sat at rest and
      // then popped when the trigger fired instead of travelling in.
      gsap.utils.toArray<HTMLElement>(".location-card").forEach((card, index) => {
        const middle = index === 1;
        gsap.fromTo(
          card,
          {
            autoAlpha: 0,
            xPercent: middle ? 0 : (index === 0 ? -20 : 20) * lateral,
            yPercent: middle ? 16 : 0,
          },
          {
            autoAlpha: 1,
            xPercent: 0,
            yPercent: 0,
            ease: "power3.out",
            duration: 1.05,
            delay: index * 0.12,
            scrollTrigger: { trigger: ".locations-grid", start: "top 86%", once: true },
          },
        );
      });

      gsap.fromTo(
        ".locations-word",
        { yPercent: -8 },
        {
          yPercent: 8,
          ease: "none",
          scrollTrigger: {
            trigger: ".locations",
            start: "top bottom",
            end: "bottom top",
            scrub: 1.2,
          },
        },
      );

      /**
       * Final CTA: the closing statement resolves out of a mask while the two
       * decorative rings — previously completely static — converge behind it.
       */
      gsap.fromTo(
        ".final-cta > div",
        { autoAlpha: 0, clipPath: "inset(0 0 100% 0)", y: 26 },
        {
          autoAlpha: 1,
          clipPath: "inset(0 0 0% 0)",
          y: 0,
          duration: 1.2,
          ease: "expo.out",
          scrollTrigger: { trigger: ".final-cta", start: "top 84%", once: true },
        },
      );

      gsap.fromTo(
        ".final-cta .final-actions",
        { autoAlpha: 0, y: 24 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.8,
          ease: "power2.out",
          scrollTrigger: { trigger: ".final-cta", start: "top 76%", once: true },
        },
      );

      gsap.to(".final-cta", {
        "--final-ring-shift": "1",
        ease: "none",
        scrollTrigger: {
          trigger: ".final-cta",
          start: "top bottom",
          end: "bottom bottom",
          scrub: 1,
        },
      });

      /**
       * Footer: the one section on the page that had no scroll motion at all —
       * no batch selector reached it, no attribute, no trigger. A champagne
       * hairline draws across its top edge, then the three blocks rise behind
       * it.
       */
      gsap.fromTo(
        ".footer-rule",
        { scaleX: 0 },
        {
          scaleX: 1,
          duration: 1.1,
          ease: "power2.inOut",
          scrollTrigger: { trigger: ".site-footer", start: "top 92%", once: true },
        },
      );

      gsap.fromTo(
        [".footer-brand", ".site-footer > p", ".footer-links"],
        { autoAlpha: 0, y: 22 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.85,
          stagger: 0.13,
          ease: "power2.out",
          scrollTrigger: { trigger: ".site-footer", start: "top 88%", once: true },
        },
      );

      /**
       * The portal's giant BEYOND drifts against the scenes in front of it.
       *
       * Type as scenery: the one purely cinematic gesture in the section, and
       * cheap — a single transform on an aria-hidden element, scrubbed on the
       * compositor like every other scroll effect here.
       */
      gsap.fromTo(
        ".portal-word",
        { yPercent: 14 },
        {
          yPercent: -14,
          ease: "none",
          scrollTrigger: {
            trigger: ".experience-portal",
            start: "top bottom",
            end: "bottom top",
            scrub: 1.2,
          },
        },
      );

      /**
       * Counters, driven off the value already in the DOM.
       *
       * The target is read from the rendered text rather than passed in, so the
       * markup stays the single source of truth — a stat that changes in the JSX
       * cannot drift from the number that counts up to it. `snap` keeps every
       * intermediate frame a whole number; without it a "years of experience"
       * figure spends a second reading 18.4372.
       */
      gsap.utils.toArray<HTMLElement>(".stat-count").forEach((node) => {
        const target = Number(node.textContent?.replace(/\D/g, "") ?? 0);
        if (!Number.isFinite(target) || target === 0) return;
        const counter = { value: Number(node.dataset.countFrom ?? 0) };

        gsap.to(counter, {
          value: target,
          duration: 1.5,
          ease: "power2.out",
          snap: { value: 1 },
          onUpdate: () => { node.textContent = String(Math.round(counter.value)); },
          scrollTrigger: { trigger: node, start: "top 88%", once: true },
        });
      });

      /** The dividers draw just ahead of the counters, so the table rules
       *  itself and then fills in — assembly, not apparition. */
      gsap.fromTo(
        ".stat-rule",
        { scaleY: 0 },
        {
          scaleY: 1,
          duration: 0.9,
          stagger: 0.14,
          ease: "power2.inOut",
          scrollTrigger: { trigger: ".proof-stats", start: "top 90%", once: true },
        },
      );

      const scenes = gsap.utils.toArray<HTMLElement>(".portal-scene");
      /**
       * Scenes travel LATERALLY: each exits toward the leading edge while its
       * successor arrives from the trailing edge, mirrored under RTL.
       *
       * They used to cross-fade vertically — but vertical is what the page
       * itself does, so inside a pinned viewport the transition read as more
       * scrolling rather than as a scene change. The one motion axis the page
       * never uses is the one that makes "you are somewhere else now" legible.
       * The BEYOND watermark keeps its vertical drift, so the two axes play
       * against each other.
       */
      const exit = document.dir === "rtl" ? 34 : -34;
      gsap.set(scenes, { autoAlpha: 0, xPercent: -exit });
      gsap.set(scenes[0], { autoAlpha: 1, xPercent: 0 });

      const portalTimeline = gsap.timeline({
        scrollTrigger: {
          trigger: ".experience-portal",
          start: "top top",
          end: "bottom bottom",
          scrub: 0.9,
        },
        defaults: { ease: "power2.inOut" },
      });

      portalTimeline
        .to(scenes[0], { autoAlpha: 0, xPercent: exit, duration: 0.7 }, 0.55)
        .fromTo(
          scenes[1],
          { autoAlpha: 0, xPercent: -exit },
          { autoAlpha: 1, xPercent: 0, duration: 0.8 },
          0.75,
        )
        .to(scenes[1], { autoAlpha: 0, xPercent: exit, duration: 0.7 }, 1.7)
        .fromTo(
          scenes[2],
          { autoAlpha: 0, xPercent: -exit },
          { autoAlpha: 1, xPercent: 0, duration: 0.8 },
          1.9,
        );

      gsap.to(".portal-orb-core", {
        rotate: 290,
        scale: 1.5,
        ease: "none",
        scrollTrigger: {
          trigger: ".experience-portal",
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
        },
      });

      gsap.to(".portal-track span", {
        scaleY: 1,
        ease: "none",
        scrollTrigger: {
          trigger: ".experience-portal",
          start: "top top",
          end: "bottom bottom",
          scrub: 0.3,
        },
      });

      /**
       * The orbit rings counter-rotate on scrub; the orb itself is left alone.
       *
       * The orb used to carry this scrub with a `scale` — but it is a stack of
       * blurred layers, and scaling a blurred subtree re-rasterises it on
       * every scrubbed frame. The rings are two outlined shapes with a
       * satellite dot each: pure transforms, and a far better fit for what
       * NOOR is — something in orbit, attentive. Direction flips under RTL so
       * the movement leads the reading eye in both languages.
       */
      const spin = document.dir === "rtl" ? -1 : 1;
      gsap.fromTo(
        ".orbit-one",
        { rotate: -18 * spin },
        {
          rotate: 24 * spin,
          ease: "none",
          scrollTrigger: {
            trigger: ".noor-feature",
            start: "top bottom",
            end: "bottom top",
            scrub: 1.1,
          },
        },
      );
      gsap.fromTo(
        ".orbit-two",
        // 24deg is the ellipse's designed resting tilt — the scrub plays
        // around it rather than replacing it.
        { rotate: 24 + 14 * spin },
        {
          rotate: 24 - 18 * spin,
          ease: "none",
          scrollTrigger: {
            trigger: ".noor-feature",
            start: "top bottom",
            end: "bottom top",
            scrub: 1.1,
          },
        },
      );
    });

    // Late-loading fonts and the CareLens canvas both change layout height;
    // without this the triggers keep firing against stale positions.
    const refresh = () => ScrollTrigger.refresh();
    const fontsReady = document.fonts?.ready;
    void fontsReady?.then(refresh);
    window.addEventListener("load", refresh);

    return () => {
      window.removeEventListener("load", refresh);
      context.revert();
    };
  }, [introOpen, language]);

  const openBooking = useCallback((serviceId?: string) => {
    const selected = validServiceId(serviceId);
    window.dispatchEvent(
      new CustomEvent<BookingOpenDetail>(OPEN_BOOKING_EVENT, {
        detail: selected ? { serviceId: selected } : {},
      }),
    );
    setMobileOpen(false);
  }, []);

  /**
   * Deep link into booking from anywhere off the home page.
   *
   * Every treatment page's primary call to action pointed at `/#book`, and no
   * element with that id has ever existed — so the main conversion path on eight
   * search-landing pages scrolled to the top of the home page and did nothing.
   * Those pages exist precisely to capture "rhinoplasty Maadi" traffic, which
   * made this the most expensive broken link on the site.
   *
   * Handled here rather than by adding an anchor, because booking is a modal and
   * there is nothing to scroll to.
   *
   * `?book=<service>` carries the requested consultation through the same event
   * used by CareLens. Unknown or retired ids safely fall back to the default
   * option instead of leaving the form in an impossible state.
   */
  useEffect(() => {
    // A deep-linked dialog should appear after the welcome layer, not underneath
    // it. Dismissing the introduction re-runs this effect with the URL intact.
    if (introOpen) return;

    const open = () => {
      const url = new URL(window.location.href);
      const service = url.searchParams.get("book");
      if (url.hash !== "#book" && !service) return;
      openBooking(service ?? undefined);

      // Clear it so a refresh, or a back-navigation, does not reopen the modal
      // over content the visitor has moved on to.
      url.hash = "";
      url.searchParams.delete("book");
      window.history.replaceState(null, "", url.pathname + url.search);
    };

    // Deferred past the intro overlay, which otherwise sits on top of the modal.
    const timer = window.setTimeout(open, 350);
    window.addEventListener("hashchange", open);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", open);
    };
  }, [introOpen, openBooking]);

  const heroAvailability = !availabilityChecked
    ? t.heroAvailabilityLoading
    : nextAvailable
      ? `${nextAvailable.label} · ${nextAvailable.time}`
      : t.heroAvailabilityEmpty;

  return (
    <main
      className="site-shell"
      dir={rtl ? "rtl" : "ltr"}
      id="patient-content"
      tabIndex={-1}
    >
      {introOpen && <ExperienceIntro language={language} onEnter={dismissIntro} />}
      <div className="grain" aria-hidden />
      <div className="scroll-progress" aria-hidden><span /></div>
      <a className="skip-link" href="#patient-content">
        {rtl ? "تخطي إلى المحتوى" : "Skip to content"}
      </a>
      <header className={heroPassed ? "site-header site-header--afloat" : "site-header"}>
        <Link className="brand" href="#top" aria-label={t.homeLabel}>
          <Image src="/logo.png" alt="" width={52} height={52} priority unoptimized />
          <span>
            <strong>{t.brandName}</strong>
            <small>{t.brandRole}</small>
          </span>
        </Link>
        <nav className={mobileOpen ? "nav nav--open" : "nav"} id="site-nav">
          {[
            { href: "#expertise", label: t.nav[0] },
            { href: "#carelens", label: t.nav[1] },
            {
              href: treatmentPath("dental-care", language),
              label: t.nav[2],
            },
            { href: "#journey", label: t.nav[3] },
            { href: "#locations", label: t.nav[4] },
          ].map((item) => (
            <a href={item.href} key={item.href} onClick={() => setMobileOpen(false)}>
              {item.label}
            </a>
          ))}
          {/*
            A real link, not a state toggle: each language is its own indexable
            URL, and `hrefLang` lets a crawler follow the pair.
          */}
          <Link
            className="language-button mobile-language"
            href={LOCALE_PATH[altLanguage]}
            hrefLang={altLanguage}
            onClick={() => setMobileOpen(false)}
          >
            <Globe2 size={15} />
            {t.languageShort}
          </Link>
          <button className="button button--dark nav-book" onClick={() => openBooking()}>
            {t.book}
            <ArrowRight size={16} />
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="experience-replay"
            onClick={() => setIntroOpen(true)}
            aria-label={t.replayLabel}
          >
            <Sparkles size={14} />
            <span>{t.replay}</span>
          </button>
          <Link
            className="language-button"
            href={LOCALE_PATH[altLanguage]}
            hrefLang={altLanguage}
            aria-label={t.languageSwitch}
          >
            <Globe2 size={15} />
            {t.languageShort}
          </Link>
          <button className="button button--dark desktop-book" onClick={() => openBooking()}>
            {t.book}
            <ArrowRight size={16} />
          </button>
          <button
            className="menu-button"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label={mobileOpen ? t.closeMenu : t.openMenu}
            aria-expanded={mobileOpen}
            aria-controls="site-nav"
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {/**
       * The stage is the scroll distance; the hero inside it is sticky.
       *
       * This is the "hero holds until you mean to leave" requirement, built from
       * static layout instead of a ScrollTrigger pin. The stage is one hero
       * height plus ~85svh of hold; the hero sticks below the header while the
       * stage scrolls past, so the browser resolves everything and there is no
       * injected spacer to re-measure when the canvas, fonts or hero image
       * settle — which is what broke in-page anchor jumps when this was a pin.
       * `id="top"` moves to the stage so the logo's anchor still lands here.
       */}
      <div className="hero-stage" id="top">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow reveal-item">
            <span />
            {t.eyebrow}
          </div>
          {/* Each line rises out of its own mask instead of the whole block
              nudging up 16px — this is the one animation every visitor sees,
              and it is pure CSS so it plays before hydration and without JS. */}
          <h1>
            <span>{t.titleA}</span>
            <em>{t.titleB}</em>
          </h1>
          <p className="hero-intro reveal-item reveal-delay-2">{t.intro}</p>
          <div className="hero-actions reveal-item reveal-delay-3">
            <button className="button button--burgundy" onClick={() => openBooking()}>
              <CalendarDays size={18} />
              {t.book}
            </button>
            <div className="hero-secondary-actions">
              <button className="text-button" onClick={() => setNoorOpen(true)}>
                <NoorOrb small />
                <span>{t.ask}</span>
                <ArrowRight size={16} />
              </button>
              <button
                className="text-button journey-launch"
                onClick={() => setJourneyDesignerOpen(true)}
              >
                <Sparkles size={15} />
                <span>{t.designJourney}</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="credential reveal-item reveal-delay-3">
            <ShieldCheck size={19} />
            <span>{t.trust}</span>
          </div>
        </div>

        <div className="hero-visual reveal-item reveal-delay-2">
          <div className="portrait-frame">
            <Image
              src="/doctor-hero.webp"
              alt="Dr. Ashraf Metwally in a modern clinic"
              fill
              sizes="(max-width: 900px) 92vw, 48vw"
              priority
              unoptimized
            />
            <div className="portrait-wash" />
            <div className="portrait-chrome" aria-hidden>
              <span>CARE POINT / CAIRO</span>
              <span>01 — CONSULTATION</span>
            </div>
            <div className="portrait-footer">
              <div className="doctor-mark">
                <span>{t.signature}</span>
                <small>{t.signatureRole}</small>
              </div>
              <button
                className="availability-card"
                onClick={() => openBooking()}
                aria-label={t.viewAvailability}
              >
                <span className="live-dot" />
                <span className="availability-copy">
                  <small>{t.heroDate}</small>
                  <strong>{heroAvailability}</strong>
                </span>
                <span className="availability-arrow" aria-hidden>
                  <ChevronRight size={18} />
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="hero-rail" aria-hidden>
          <span>{t.scrollToDiscover}</span>
          <i />
        </div>
      </section>
      </div>

      <section className="experience-portal" aria-label={t.portalLabel}>
        <div className="portal-sticky">
          <div className="portal-word" aria-hidden>BEYOND</div>
          <div className="portal-heading">
            <span>{t.portalKicker}</span>
            <strong>{t.portalTitle}</strong>
          </div>
          <div className="portal-track" aria-hidden><span /></div>
          <div className="portal-orb" aria-hidden>
            <div className="portal-orb-core"><span /><span /><span /></div>
          </div>

          <article className="portal-scene portal-scene--one">
            <span className="portal-index">01 / 03 · CARELENS</span>
            <h2>
              {t.portalOneTitle}
              <em>{t.portalOneEm}</em>
            </h2>
            <p>{t.portalOneBody}</p>
            <a className="portal-action" href="#carelens">
              {t.portalOneAction}
              <ArrowRight size={17} />
            </a>
          </article>

          <article className="portal-scene portal-scene--two">
            <span className="portal-index">02 / 03 · NOOR</span>
            <h2>
              {t.portalTwoTitle}
              <em>{t.portalTwoEm}</em>
            </h2>
            <p>{t.portalTwoBody}</p>
            <button className="portal-action" onClick={() => setNoorOpen(true)}>
              <NoorOrb small />
              {t.portalTwoAction}
            </button>
          </article>

          <article className="portal-scene portal-scene--three">
            <span className="portal-index">03 / 03 · LIVE ACCESS</span>
            <h2>
              {t.portalThreeTitle}
              <em>{t.portalThreeEm}</em>
            </h2>
            <p>{t.portalThreeBody}</p>
            <button className="portal-action portal-action--solid" onClick={() => openBooking()}>
              <CalendarDays size={17} />
              {t.portalThreeAction}
              <ArrowRight size={17} />
            </button>
          </article>

          <div className="portal-footnote">
            <span>{t.portalFootnote}</span>
            <span>CARE LENS · NOOR · BOOKING · CLINIC OS</span>
          </div>
        </div>
      </section>

      <section className="proof-strip" id="expertise">
        <div className="proof-intro">
          <span className="section-index">01 — PHILOSOPHY</span>
          <h2>{t.proofTitle}</h2>
          <p>{t.proofBody}</p>
        </div>
        {/**
          * Counters, written so the number is correct without JavaScript.
          *
          * Each value is rendered as itself and `data-count-from` only tells the
          * tween where to start. Nothing here depends on the script running: no
          * script, reduced motion, or a failed hydration all leave the real figure
          * on screen. The counting span is hidden from assistive technology and
          * paired with a static one, because a screen reader that happens to read
          * mid-count would otherwise announce "7 Cairo locations".
          */}
        <div className="proof-stats">
          {/* The dividers are elements rather than border-left so the scroll
              can draw them — a ledger rules itself before the figures land. */}
          <article>
            <i className="stat-rule" aria-hidden />
            <strong>
              <span className="stat-count" data-count-from="0" aria-hidden>25</span>
              <span className="stat-static">25</span>
              <sup>+</sup>
            </strong>
            <span>{t.statYears}</span>
          </article>
          <article>
            <i className="stat-rule" aria-hidden />
            <strong>
              <span className="stat-count" data-count-from="0" aria-hidden>{BRANCHES.length}</span>
              <span className="stat-static">{BRANCHES.length}</span>
            </strong>
            <span>{t.statClinics}</span>
          </article>
          <article>
            <i className="stat-rule" aria-hidden />
            <strong>
              <span className="stat-count" data-count-from="0" aria-hidden>360</span>
              <span className="stat-static">360</span>°
            </strong>
            <span>{t.statJourney}</span>
          </article>
        </div>
      </section>

      <section className="carelens section-pad" id="carelens">
        <div className="carelens-word" aria-hidden>CARELENS</div>
        <div className="section-heading">
          <div>
            <span className="section-index">02 — {t.careLensKicker}</span>
            <h2>{t.careLensTitle}</h2>
          </div>
          <p>{t.careLensBody}</p>
        </div>

        <LazyCareLens
          language={language}
          onBook={openBooking}
          onAsk={() => setNoorOpen(true)}
        />

        {/*
          Real links out to the treatment pages. The CareLens scene itself is a
          canvas, so without these the whole treatment library is invisible to
          a crawler — and to anyone who prefers reading to exploring.
        */}
        <nav className="treatment-links" aria-label={t.careLensKicker}>
          {TREATMENTS.map((item) => (
            <Link key={item.slug} href={treatmentPath(item.slug, language)}>
              <span>{item.number}</span>
              <strong>{treatmentCopy(item, language).title}</strong>
              <ArrowRight size={15} />
            </Link>
          ))}
        </nav>
      </section>

      <section className="noor-feature section-pad">
        <div className="noor-atmosphere">
          <NoorOrb />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
        </div>
        <div className="noor-copy">
          <span className="section-index section-index--light">03 — {t.noorKicker}</span>
          <h2>{t.noorTitle}</h2>
          <p>{t.noorBody}</p>
          <div className="prompt-chips">
            {t.noorPrompts.map((prompt) => (
              <button key={prompt} onClick={() => setNoorOpen(true)}>
                <Sparkles size={14} />
                {prompt}
              </button>
            ))}
          </div>
          <button className="button button--ivory" onClick={() => setNoorOpen(true)}>
            <MessageCircle size={17} />
            {t.ask}
          </button>
          <small className="disclaimer">{t.aiDisclaimer}</small>
        </div>
      </section>

      <section className="journey section-pad" id="journey">
        <div className="section-heading">
          <div>
            <span className="section-index">04 — {t.journeyKicker}</span>
            <h2>{t.journeyTitle}</h2>
          </div>
          <p>{t.journeyBody}</p>
        </div>
        <div className="journey-grid">
          {journey.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.step}>
                <span className="journey-number">{item.step}</span>
                <Icon size={23} strokeWidth={1.5} />
                <h3>{rtl ? item.ar : item.title}</h3>
                <p>{rtl ? item.arText : item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="locations section-pad" id="locations">
        {/* The site's watermark device, used a third time. It bleeds off the
            LEFT edge so it does not echo CARELENS, which bleeds off the right. */}
        <div className="locations-word" aria-hidden>
          CAIRO
        </div>
        <div className="section-heading">
          <div>
            <span className="section-index">05 — {t.locationsKicker}</span>
            <h2>{t.locationsTitle}</h2>
          </div>
          <p>{t.locationsBody}</p>
        </div>
        <div className="locations-grid">
          {BRANCHES.map((branch) => (
            <article className="location-card" key={branch.id}>
              <div className="location-mark" aria-hidden>
                <MapPin size={18} strokeWidth={1.5} />
              </div>
              <h3>{rtl ? branch.ar : branch.en}</h3>
              <p>{rtl ? branch.addressAr : branch.addressEn}</p>
              <div className="location-hours">
                <span>{t.consultingHours}</span>
                <strong>{branchOpenDays(branch, language).join(" · ")}</strong>
              </div>
              <div className="location-actions">
                <a href={branch.mapUrl} target="_blank" rel="noopener noreferrer">
                  <Navigation size={15} />
                  {t.directions}
                </a>
                <button onClick={() => openBooking()}>
                  <CalendarDays size={15} />
                  {t.book}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <div>
          <span className="section-index">{t.finalKicker}</span>
          <h2>{t.finalTitle}</h2>
          <p>{t.finalBody}</p>
        </div>
        <div className="final-actions">
          <button
            className="button button--dark button--large"
            onClick={() => setJourneyDesignerOpen(true)}
          >
            <Sparkles size={18} />
            {t.designYourJourney}
          </button>
          <button className="button button--burgundy button--large" onClick={() => openBooking()}>
            <CalendarDays size={19} />
            {t.book}
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      <footer className="site-footer">
        {/* Drawn on scroll. The footer was the one section on the page with no
            scroll motion of any kind — not a reveal, not an attribute. */}
        <i className="footer-rule" aria-hidden />
        <div className="footer-brand">
          <Image src="/logo.png" alt="" width={42} height={42} unoptimized />
          <span>
            <strong>{t.brandName}</strong>
            <small>{t.brandRole}</small>
          </span>
        </div>
        <p>{t.footerLocations}</p>
        <div className="footer-links">
          <a href={`tel:${CONTACT.phone}`}>{t.callClinic}</a>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          <a href="#locations">{t.directions}</a>
          <Link href={rtl ? "/ar/privacy" : "/privacy"}>{t.privacy}</Link>
          <Link href={rtl ? "/ar/terms" : "/terms"}>{t.terms}</Link>
          {/* Deliberately last and unemphasised. Staff need to find it; patients
              need never wonder whether it is for them. */}
          <Link href="/login" className="footer-staff-link">
            {t.staffSignIn}
          </Link>
        </div>
      </footer>

      {heroPassed && (
        <button
          className={`floating-noor${footerInView ? " floating-noor--docked" : ""}`}
          onClick={() => setNoorOpen(true)}
          aria-label={t.floatingAria}
          // While docked the button is inert: hidden from assistive technology
          // and out of the tab order, so it cannot be reached by a route the
          // pointer no longer has either. The footer's own links take over.
          aria-hidden={footerInView || undefined}
          tabIndex={footerInView ? -1 : 0}
        >
          <NoorOrb small />
          <span className="floating-noor-copy">
            <small>{t.floatingKicker}</small>
            <strong>{t.floatingAction}</strong>
          </span>
        </button>
      )}

      {noorOpen && (
        <NoorPanel
          language={language}
          onClose={() => setNoorOpen(false)}
          onBook={() => {
            setNoorOpen(false);
            openBooking();
          }}
        />
      )}
      <BookingLauncher language={language} />
      {journeyDesignerOpen && (
        <JourneyDesigner
          language={language}
          onClose={() => setJourneyDesignerOpen(false)}
          onBook={() => openBooking()}
        />
      )}
    </main>
  );
}

function NoorPanel({
  language,
  onClose,
  onBook,
}: {
  language: Language;
  onClose: () => void;
  onBook: () => void;
}) {
  const t = copyFor(language);
  const rtl = language === "ar";
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: t.noorGreeting },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const replyTimer = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  // Speech and timers outlive the component unless they are torn down: a reply
  // timer would set state after unmount, and speech synthesis would keep talking
  // over a closed panel.
  useEffect(() => {
    return () => {
      window.clearTimeout(replyTimer.current);
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  /**
   * Keyword routing over a fixed, clinician-reviewable answer set. There is no
   * language model behind this — the "Guided answers" label in the header says
   * so rather than implying a capability the panel does not have.
   */
  function answerFor(question: string) {
    const normalized = question.toLowerCase();
    const answers = t.noorAnswers;
    if (/book|appointment|available|موعد|حجز/.test(normalized)) return answers.booking;
    if (/where|location|address|branch|direction|map|فرع|عنوان|مكان|خريطة/.test(normalized))
      return answers.location;
    if (/nose|rhino|أنف|تجميل الأنف/.test(normalized)) return answers.nose;
    if (
      /dental|dentist|tooth|teeth|gum|smile|veneer|implant|whiten|أسنان|السن|اللثة|ابتسامة|فينير|زراعة|تبييض/.test(
        normalized,
      )
    )
      return answers.dental;
    if (/recover|healing|recovery|تعافي|نقاهة/.test(normalized)) return answers.recovery;
    if (/price|cost|تكلفة|سعر/.test(normalized)) return answers.cost;
    if (/prepare|consult|استعد|استشارة/.test(normalized)) return answers.prepare;
    return answers.fallback;
  }

  function submit(question: string) {
    const clean = question.trim();
    if (!clean || thinking) return;
    setMessages((current) => [...current, { role: "user", text: clean }]);
    setInput("");
    setThinking(true);
    replyTimer.current = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: answerFor(clean) },
      ]);
      setThinking(false);
    }, 650);
  }

  function startVoice() {
    const speechWindow = window as typeof window & {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: t.noorNoVoice },
      ]);
      return;
    }
    recognitionRef.current?.abort?.();
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = rtl ? "ar-EG" : "en-US";
    recognition.onresult = (event) => submit(event.results[0][0].transcript);
    recognition.onerror = () => {
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      recognitionRef.current = null;
    };
    recognition.start();
  }

  function speakLast() {
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    if (!last || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(last.text);
    utterance.lang = rtl ? "ar-EG" : "en-US";
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <Modal onClose={onClose} label={t.noorPanelLabel}>
      <aside className="noor-panel" dir={rtl ? "rtl" : "ltr"}>
        <div className="noor-panel-header">
          <div>
            <NoorOrb small />
            <span>
              <strong>NOOR</strong>
              <small>
                <i />
                {t.noorOnline}
              </small>
            </span>
          </div>
          <button onClick={onClose} aria-label={t.noorClose}>
            <X />
          </button>
        </div>
        <div className="chat-log" role="log" aria-live="polite">
          <div className="chat-date">{t.noorToday}</div>
          {messages.map((message, index) => (
            <div className={`chat-message chat-message--${message.role}`} key={index}>
              {message.role === "assistant" && <NoorOrb small />}
              <p>{message.text}</p>
            </div>
          ))}
          {thinking && (
            <div className="chat-message chat-message--assistant">
              <NoorOrb small />
              <p className="typing"><span /><span /><span /></p>
            </div>
          )}
          <div ref={chatEnd} />
        </div>
        <div className="quick-prompts">
          <button onClick={() => submit(t.noorAskNext)}>{t.noorQuickNext}</button>
          <button onClick={() => submit(t.noorAskPrepare)}>{t.noorQuickPrepare}</button>
          <button onClick={onBook}>{t.noorQuickTimes}</button>
        </div>
        <form
          className="chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            submit(input);
          }}
        >
          <button type="button" onClick={startVoice} aria-label={t.noorSpeak}>
            <Mic size={18} />
          </button>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t.noorPlaceholder}
          />
          <button type="submit" aria-label={t.noorSend}>
            <ArrowRight size={18} />
          </button>
        </form>
        <button className="listen-button" onClick={speakLast}>
          <Zap size={13} />
          {t.noorListen}
        </button>
        <p className="noor-legal">
          <ShieldCheck size={13} />
          {t.noorLegal}
        </p>
      </aside>
    </Modal>
  );
}

function BookingModal({
  language,
  initialService,
  open = true,
  onClose,
}: {
  language: Language;
  /** Service requested by a treatment page, CareLens region, or deep link. */
  initialService?: string;
  open?: boolean;
  onClose: () => void;
}) {
  const t = copyFor(language);
  const rtl = language === "ar";
  const [step, setStep] = useState<"slots" | "details" | "success">("slots");
  const [service, setService] = useState(
    () => validServiceId(initialService) ?? SERVICES[0].id,
  );
  const [branch, setBranch] = useState(BRANCHES[0].id);
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [holdToken, setHoldToken] = useState("");
  const [holdExpiresAt, setHoldExpiresAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [availableBranchIds, setAvailableBranchIds] = useState<readonly string[]>(BRANCH_IDS);
  const [liveBranches, setLiveBranches] = useState<Branch[]>(BRANCHES);
  const [liveServices, setLiveServices] = useState<Service[]>(SERVICES);
  const [bookingPaused, setBookingPaused] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    reference: string;
    manageToken: string | null;
  } | null>(null);
  const selectedDay = useMemo(
    () => days.find((day) => day.date === selectedDate),
    [days, selectedDate],
  );
  const branchDetail = liveBranches.find((item) => item.id === branch);
  const serviceDetail = liveServices.find((item) => item.id === service);

  useEffect(() => {
    const controller = new AbortController();
    // Entering the loading state is the point of re-running this effect when the
    // branch, service or retry key changes.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setLoadFailed(false);
    /* eslint-enable react-hooks/set-state-in-effect */

    fetch(
      `/api/availability?branch=${encodeURIComponent(branch)}&service=${encodeURIComponent(
        service,
      )}&locale=${language}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as {
          branch: string;
          service: string;
          dates: AvailabilityDay[];
          turnstileSiteKey?: string | null;
          availableBranchIds?: string[];
          bookingPaused?: boolean;
          catalogue?: {
            revision: string;
            branches: Branch[];
            services: Service[];
          };
        };
      })
      .then((data) => {
        if (data.branch && data.branch !== branch) {
          setBranch(data.branch as typeof branch);
        }
        if (data.service && data.service !== service) setService(data.service);
        if (data.catalogue?.branches.length) setLiveBranches(data.catalogue.branches);
        if (data.catalogue?.services.length) setLiveServices(data.catalogue.services);
        setDays(data.dates ?? []);
        setTurnstileSiteKey(data.turnstileSiteKey ?? null);
        setAvailableBranchIds(data.availableBranchIds ?? BRANCH_IDS);
        setBookingPaused(Boolean(data.bookingPaused));
        // Land on the first day that actually has a free slot.
        setSelectedDate(
          (data.dates ?? []).find((day) => day.slots.length > 0)?.date ??
            data.dates?.[0]?.date ??
            "",
        );
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        // Showing invented times here would let patients pick slots that do not
        // exist, so the failure is surfaced instead.
        setDays([]);
        setLoadFailed(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [branch, service, language, reloadKey]);

  // The server releases a hold after five minutes. Counting down in the UI means
  // the patient is told before the confirmation fails, rather than after. The
  // opening value is set when the hold is taken, so this effect only ticks.
  useEffect(() => {
    if (!holdExpiresAt) return;
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.round((holdExpiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setHoldToken("");
        setHoldExpiresAt(0);
        setStep("slots");
        setSelectedTime("");
        setReloadKey((key) => key + 1);
        setError(t.holdExpired);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [holdExpiresAt, t.holdExpired]);

  async function holdSlot() {
    if (!selectedTime || !selectedDate) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          service,
          slotDate: selectedDate,
          slotTime: selectedTime,
          turnstileToken,
        }),
      });
      const data = (await response.json()) as {
        holdToken?: string;
        expiresAt?: string;
        message?: string;
      };
      if (!response.ok || !data.holdToken) {
        throw new Error(data.message || "Unable to hold this time.");
      }
      const expiresAt = data.expiresAt ? Date.parse(data.expiresAt) : 0;
      setHoldToken(data.holdToken);
      setHoldExpiresAt(expiresAt);
      setSecondsLeft(
        expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 1000)) : 0,
      );
      setStep("details");
    } catch (caught) {
      // Any failure — including another visitor taking the slot first — means
      // the offered times are stale, so they are refetched.
      setError(caught instanceof Error ? caught.message : "Please choose another time.");
      setReloadKey((key) => key + 1);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdToken,
          patientName: form.get("name"),
          patientPhone: form.get("phone"),
          patientEmail: form.get("email"),
          patientNote: form.get("note"),
          consent: form.get("consent") === "on",
          language,
        }),
      });
      const data = (await response.json()) as {
        booking?: { reference?: string; manageToken?: string | null };
        message?: string;
      };
      if (!response.ok) throw new Error(data.message || "Unable to confirm.");
      setConfirmation({
        reference: data.booking?.reference ?? "",
        manageToken: data.booking?.manageToken ?? null,
      });
      setHoldExpiresAt(0);
      setStep("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm.");
    } finally {
      setSubmitting(false);
    }
  }

  const releaseCurrentHold = useCallback(
    (refreshAvailability = false) => {
      if (!holdToken) return;
      const token = holdToken;
      setHoldToken("");
      setHoldExpiresAt(0);
      setSecondsLeft(0);
      void fetch("/api/availability", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdToken: token }),
        keepalive: true,
      }).finally(() => {
        if (refreshAvailability) setReloadKey((key) => key + 1);
      });
    },
    [holdToken],
  );

  const closeBooking = useCallback(() => {
    if (step !== "success") releaseCurrentHold();
    onClose();
  }, [onClose, releaseCurrentHold, step]);

  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <Modal onClose={closeBooking} labelledBy="booking-modal-title" active={open}>
      <section className="booking-modal" dir={rtl ? "rtl" : "ltr"}>
        <div className="booking-top">
          <div>
            <span className="section-index">
              {step === "slots" ? "01" : step === "details" ? "02" : "03"} — {t.bookingStepLabel}
            </span>
            <h2 id="booking-modal-title">
              {step === "success" ? t.bookingSuccessTitle : t.bookingTitle}
            </h2>
          </div>
          <button onClick={closeBooking} aria-label={t.bookingClose}>
            <X />
          </button>
        </div>

        {step === "slots" && (
          <div className="booking-content">
            <div className="booking-fields">
              <label>
                <span>{t.consultationType}</span>
                {/*
                  Grouped by line of care — the practice runs surgical,
                  non-surgical and dental, and a flat list of ten makes a
                  patient scan for theirs.
                */}
                <select
                  value={service}
                  onChange={(event) => {
                    setSelectedTime("");
                    setService(event.target.value);
                  }}
                >
                  {SERVICE_CATEGORIES.map((category) => (
                    <optgroup
                      key={category.id}
                      label={rtl ? category.ar : category.en}
                    >
                      {liveServices
                        .filter((item) => item.category === category.id)
                        .map((item) => (
                        <option key={item.id} value={item.id}>
                          {rtl ? item.ar : item.en}
                        </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                <span>{t.clinic}</span>
                <select
                  value={branch}
                  onChange={(event) => {
                    setSelectedTime("");
                    setBranch(event.target.value as typeof branch);
                  }}
                >
                  {liveBranches.filter((item) => availableBranchIds.includes(item.id)).map((item) => (
                    <option key={item.id} value={item.id}>
                      {rtl ? item.ar : item.en}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {branchDetail && (
              <a
                className="booking-map-link"
                href={branchDetail.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MapPin size={14} />
                {rtl ? branchDetail.addressAr : branchDetail.addressEn}
                <span>{t.openInMaps} ↗</span>
              </a>
            )}

            {loadFailed || bookingPaused ? (
              <div className="booking-unavailable">
                <p>
                  {bookingPaused
                    ? rtl
                      ? "الحجز الإلكتروني متوقف مؤقتًا. يرجى الاتصال بالعيادة."
                      : "Online booking is temporarily paused. Please call the clinic."
                    : t.loadFailed}
                </p>
                <div className="booking-unavailable-actions">
                  {!bookingPaused && (
                    <button
                      className="button button--dark"
                      onClick={() => setReloadKey((key) => key + 1)}
                    >
                      {t.tryAgain}
                    </button>
                  )}
                  <a href={`tel:${CONTACT.phone}`}>{t.callTheClinic}</a>
                  <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                    WhatsApp
                  </a>
                </div>
              </div>
            ) : (
              <>
                <div className="date-tabs" role="group" aria-label={t.availableTimes}>
                  {days.map((day) => (
                    <button
                      key={day.date}
                      className={selectedDate === day.date ? "active" : ""}
                      disabled={day.slots.length === 0}
                      aria-pressed={selectedDate === day.date}
                      title={day.closure ?? undefined}
                      onClick={() => {
                        setSelectedDate(day.date);
                        setSelectedTime("");
                      }}
                    >
                      <small>{day.weekday}</small>
                      <strong>{day.day}</strong>
                    </button>
                  ))}
                </div>
                <div className="slot-heading">
                  <span>
                    <Clock3 size={16} />
                    {t.availableTimes}
                  </span>
                  <small>
                    <i />
                    {loading ? t.refreshing : t.live}
                  </small>
                </div>
                <div className="slots" role="group" aria-label={t.availableTimes} aria-busy={loading}>
                  {(selectedDay?.slots ?? []).map((time) => (
                    <button
                      className={selectedTime === time ? "active" : ""}
                      key={time}
                      aria-pressed={selectedTime === time}
                      onClick={() => setSelectedTime(time)}
                    >
                      {time}
                    </button>
                  ))}
                </div>
                {!loading && (selectedDay?.slots.length ?? 0) === 0 && (
                  <p className="slots-empty">{t.noTimesToday}</p>
                )}
              </>
            )}

            {/*
              Shown only once a time is chosen, so the patient is not asked to
              prove anything before they have expressed any intent — and only
              when the server actually has bot protection configured.
            */}
            {turnstileSiteKey && selectedTime && (
              <Turnstile
                siteKey={turnstileSiteKey}
                language={language}
                onToken={setTurnstileToken}
              />
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="booking-footer">
              <p>
                <ShieldCheck size={15} />
                {t.holdNotice}
              </p>
              <button
                className="button button--burgundy"
                onClick={holdSlot}
                disabled={
                  !selectedTime ||
                  submitting ||
                  loading ||
                  // Only gates when a widget is actually on screen.
                  Boolean(turnstileSiteKey && !turnstileToken)
                }
              >
                {submitting ? t.holding : t.continue}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {step === "details" && (
          <form className="booking-content details-form" onSubmit={confirm}>
            <div className="held-slot">
              <div>
                <CalendarDays size={20} />
                <span>
                  <small>{rtl ? serviceDetail?.ar : serviceDetail?.en}</small>
                  <strong>{selectedDay?.day} · {selectedTime}</strong>
                </span>
              </div>
              <span>
                <MapPin size={14} />
                {rtl ? branchDetail?.ar : branchDetail?.en}
              </span>
            </div>
            {secondsLeft > 0 && (
              <p className="hold-countdown" role="status">
                <Clock3 size={14} />
                {t.heldFor(countdown)}
              </p>
            )}
            <div className="form-grid">
              <label>
                <span>{t.fullName}</span>
                <input
                  name="name"
                  required
                  maxLength={120}
                  autoComplete="name"
                  placeholder={t.yourName}
                />
              </label>
              <label>
                <span>{t.mobileNumber}</span>
                <input
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  pattern="[+()\d\s-]{7,20}"
                  placeholder="+20"
                />
              </label>
              <label className="full">
                <span>{t.emailOptional}</span>
                <input
                  name="email"
                  type="email"
                  maxLength={200}
                  autoComplete="email"
                  placeholder="name@example.com"
                />
              </label>
              <label className="full">
                <span>{t.noteOptional}</span>
                <textarea
                  name="note"
                  rows={2}
                  maxLength={500}
                  placeholder={t.notePlaceholder}
                />
              </label>
            </div>
            <label className="consent">
              <input type="checkbox" name="consent" required />
              <span>{t.consentLabel}</span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="booking-footer">
              <button
                type="button"
                className="back-button"
                onClick={() => {
                  releaseCurrentHold(true);
                  setSelectedTime("");
                  setStep("slots");
                }}
              >
                {t.back}
              </button>
              <button className="button button--burgundy" disabled={submitting}>
                {submitting ? t.confirming : t.confirmAppointment}
                <Check size={16} />
              </button>
            </div>
          </form>
        )}

        {step === "success" && (
          <div className="booking-success">
            <div className="success-mark"><Check size={32} /></div>
            {confirmation?.reference && (
              <span className="confirmation-id">REF · {confirmation.reference}</span>
            )}
            <h3>
              {selectedDay?.day} {t.at} {selectedTime}
            </h3>
            <p>{t.bookingSuccessBody((rtl ? branchDetail?.ar : branchDetail?.en) ?? "")}</p>

            <div className="success-links">
              {confirmation?.manageToken && (
                <a
                  className="success-primary"
                  href={`/api/appointments/${confirmation.manageToken}/calendar`}
                >
                  <CalendarDays size={16} />
                  {t.addToCalendar}
                </a>
              )}
              {branchDetail && (
                <a href={branchDetail.mapUrl} target="_blank" rel="noopener noreferrer">
                  <Navigation size={16} />
                  {t.directions}
                </a>
              )}
              {confirmation?.manageToken && (
                <a href={`/appointment/${confirmation.manageToken}`}>
                  <Clock3 size={16} />
                  {t.manageBooking}
                </a>
              )}
            </div>

            <div className="success-actions">
              <button className="button button--dark" onClick={closeBooking}>
                {t.done}
              </button>
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} />
                WhatsApp
              </a>
            </div>
          </div>
        )}
      </section>
    </Modal>
  );
}
