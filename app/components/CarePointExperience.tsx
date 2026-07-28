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
import { BRANCHES, CONTACT, SERVICES, WHATSAPP_URL } from "@/lib/clinic";

// The CareLens scene pulls in Three.js — roughly 890KB that the hero does not
// need, and that cannot render on the server anyway.
const TreatmentUniverse = dynamic(() => import("./TreatmentUniverse"), {
  ssr: false,
  loading: () => <div className="treatment-universe treatment-universe--loading" aria-hidden />,
});

/**
 * Holds the CareLens chunk back until the section nears the viewport. Without
 * this gate the dynamic import still fires immediately after hydration, which
 * puts the download back in competition with the hero on a slow connection.
 */
function LazyCareLens(props: {
  language: Language;
  onBook: () => void;
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

type Language = "en" | "ar";
type AvailabilityDay = {
  date: string;
  weekday: string;
  day: string;
  slots: string[];
};
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

const LANGUAGE_STORAGE_KEY = "carepoint:language";
const INTRO_STORAGE_KEY = "carepoint:intro-seen";

const copy = {
  en: {
    nav: ["Expertise", "CareLens", "Journey"],
    book: "Reserve a visit",
    eyebrow: "Consultant Plastic Surgeon · Cairo",
    titleA: "Aesthetic care,",
    titleB: "designed around you.",
    intro:
      "Precision-led plastic surgery with an experience that begins long before the consultation.",
    explore: "Explore your options",
    ask: "Ask NOOR",
    trust: "FRCS · EBOPRAS · Over 25 years of surgical experience",
    available: "Next consultation",
    heroDate: "Live availability",
    signature: "Dr. Ashraf Metwally",
    signatureRole: "Consultant Plastic Surgeon",
    proofTitle: "Natural results. Clinical precision.",
    proofBody:
      "Every treatment plan starts with listening, rigorous assessment, and a shared definition of what feels right for you.",
    careLensKicker: "Introducing CareLens",
    careLensTitle: "Start with what you feel, not a procedure name.",
    careLensBody:
      "Choose an area and discover the questions, options, and recovery considerations worth discussing in consultation.",
    journeyKicker: "Your care journey",
    journeyTitle: "Clarity at every stage.",
    journeyBody:
      "From your first question to long-term follow-up, every touchpoint is designed to feel calm, personal, and informed.",
    aiDisclaimer: "Educational guidance only — never a diagnosis.",
    finalTitle: "Your questions deserve a thoughtful answer.",
    finalBody:
      "Meet Dr. Ashraf and leave with a plan built around your anatomy, priorities, and pace.",
  },
  ar: {
    nav: ["الخبرات", "كير لِنز", "رحلتك"],
    book: "احجز زيارتك",
    eyebrow: "استشاري جراحات التجميل · القاهرة",
    titleA: "رعاية تجميلية،",
    titleB: "مصممة خصيصاً لك.",
    intro:
      "دقة جراحية وخبرة إنسانية تبدأ قبل الاستشارة وتستمر بعدها.",
    explore: "اكتشف خياراتك",
    ask: "اسأل نور",
    trust: "زمالة الكلية الملكية · البورد الأوروبي · أكثر من ٢٥ عاماً من الخبرة",
    available: "أقرب استشارة",
    heroDate: "مواعيد متاحة الآن",
    signature: "د. أشرف متولي",
    signatureRole: "استشاري جراحات التجميل",
    proofTitle: "نتائج طبيعية. دقة طبية.",
    proofBody:
      "كل خطة علاج تبدأ بالاستماع والتقييم الدقيق والاتفاق على النتيجة الأنسب لك.",
    careLensKicker: "نقدم لك كير لِنز",
    careLensTitle: "ابدأ بما تشعر به، وليس باسم الإجراء.",
    careLensBody:
      "اختر المنطقة واكتشف الأسئلة والخيارات وتفاصيل التعافي التي تستحق النقاش أثناء الاستشارة.",
    journeyKicker: "رحلة رعايتك",
    journeyTitle: "وضوح في كل خطوة.",
    journeyBody:
      "من أول سؤال وحتى المتابعة، صممنا كل لحظة لتكون هادئة وشخصية ومدروسة.",
    aiDisclaimer: "معلومات تثقيفية فقط — وليست تشخيصاً طبياً.",
    finalTitle: "أسئلتك تستحق إجابة مدروسة.",
    finalBody:
      "قابل د. أشرف واخرج بخطة تناسب تكوينك وأولوياتك والوقت المناسب لك.",
  },
};

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

export default function CarePointExperience() {
  const [language, setLanguage] = useState<Language>("en");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [noorOpen, setNoorOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(true);
  const [journeyDesignerOpen, setJourneyDesignerOpen] = useState(false);
  const [heroPassed, setHeroPassed] = useState(false);
  const t = copy[language];
  const rtl = language === "ar";

  // Restored before paint so a returning visitor does not see the intro replay
  // or a flash of English. Initial state still matches the server render, so
  // hydration stays clean — which is exactly why this cannot move into a
  // `useState` initialiser, where `localStorage` is unavailable on the server.
  useLayoutEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      /* eslint-disable react-hooks/set-state-in-effect */
      if (storedLanguage === "ar" || storedLanguage === "en") {
        setLanguage(storedLanguage);
      }
      if (window.localStorage.getItem(INTRO_STORAGE_KEY) === "1") {
        setIntroOpen(false);
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Private browsing can deny storage access; defaults are fine.
    }
  }, []);

  const chooseLanguage = useCallback((next: Language) => {
    setLanguage(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
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

  // Screen readers and search engines read the document element, not `main`,
  // so the language switch has to reach it.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = rtl ? "rtl" : "ltr";
  }, [language, rtl]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({
      duration: 1.05,
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 0.9,
    });
    const syncScroll = () => ScrollTrigger.update();
    let animationFrame = 0;
    const animate = (time: number) => {
      lenis.raf(time);
      animationFrame = requestAnimationFrame(animate);
    };

    lenis.on("scroll", syncScroll);
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
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

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    if (
      introOpen ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        ".portrait-frame",
        { clipPath: "inset(0 0 100% 0)" },
        {
          clipPath: "inset(0 0 0% 0)",
          duration: 1.35,
          delay: 0.08,
          ease: "power4.inOut",
        },
      );

      gsap.fromTo(
        ".portrait-chrome, .portrait-footer",
        { autoAlpha: 0, y: 18 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.75,
          delay: 0.82,
          stagger: 0.12,
          ease: "power3.out",
        },
      );

      gsap.to(".scroll-progress span", {
        scaleX: 1,
        ease: "none",
        scrollTrigger: {
          start: 0,
          end: "max",
          scrub: 0.25,
        },
      });

      gsap.to(".portrait-frame img", {
        yPercent: 8,
        scale: 1.08,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: 1,
        },
      });

      gsap.to(".hero-copy", {
        yPercent: 16,
        opacity: 0.3,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "45% center",
          end: "bottom top",
          scrub: 1,
        },
      });

      gsap.utils
        .toArray<HTMLElement>(
          ".proof-intro, .proof-stats article, .section-heading, .treatment-universe, .journey-grid article, .final-cta > div, .final-cta > button",
        )
        .forEach((element, index) => {
          gsap.fromTo(
            element,
            { autoAlpha: 0, y: 54 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.9,
              delay: (index % 4) * 0.04,
              ease: "power3.out",
              scrollTrigger: {
                trigger: element,
                start: "top 88%",
                once: true,
              },
            },
          );
        });

      const scenes = gsap.utils.toArray<HTMLElement>(".portal-scene");
      gsap.set(scenes, { autoAlpha: 0, y: 60 });
      gsap.set(scenes[0], { autoAlpha: 1, y: 0 });

      const portalTimeline = gsap.timeline({
        scrollTrigger: {
          trigger: ".experience-portal",
          start: "top top",
          end: "bottom bottom",
          scrub: 0.75,
        },
      });

      portalTimeline
        .to(scenes[0], { autoAlpha: 0, y: -55, duration: 0.7 }, 0.55)
        .fromTo(
          scenes[1],
          { autoAlpha: 0, y: 65 },
          { autoAlpha: 1, y: 0, duration: 0.8 },
          0.75,
        )
        .to(scenes[1], { autoAlpha: 0, y: -55, duration: 0.7 }, 1.7)
        .fromTo(
          scenes[2],
          { autoAlpha: 0, y: 65 },
          { autoAlpha: 1, y: 0, duration: 0.8 },
          1.9,
        );

      gsap.to(".portal-orb-core", {
        rotate: 290,
        scale: 1.55,
        ease: "none",
        scrollTrigger: {
          trigger: ".experience-portal",
          start: "top top",
          end: "bottom bottom",
          scrub: 0.8,
        },
      });

      gsap.to(".portal-track span", {
        scaleY: 1,
        ease: "none",
        scrollTrigger: {
          trigger: ".experience-portal",
          start: "top top",
          end: "bottom bottom",
          scrub: 0.2,
        },
      });

      gsap.to(".noor-atmosphere .noor-orb", {
        rotate: 210,
        scale: 1.12,
        ease: "none",
        scrollTrigger: {
          trigger: ".noor-feature",
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      });
    });

    return () => context.revert();
  }, [introOpen, language]);

  function openBooking() {
    setBookingOpen(true);
    setMobileOpen(false);
  }

  return (
    <main className="site-shell" dir={rtl ? "rtl" : "ltr"}>
      {introOpen && <ExperienceIntro language={language} onEnter={dismissIntro} />}
      <div className="grain" aria-hidden />
      <div className="scroll-progress" aria-hidden><span /></div>
      <header className="site-header">
        <Link className="brand" href="#top" aria-label="Dr. Ashraf Metwally home">
          <Image
            src="/logo.png"
            alt=""
            width={52}
            height={52}
            priority
            unoptimized
          />
          <span>
            <strong>{rtl ? "د. أشرف متولي" : "ASHRAF METWALLY"}</strong>
            <small>{rtl ? "جراحات التجميل" : "PLASTIC SURGERY"}</small>
          </span>
        </Link>
        <nav className={mobileOpen ? "nav nav--open" : "nav"}>
          {["expertise", "carelens", "journey"].map((id, index) => (
            <a href={`#${id}`} key={id} onClick={() => setMobileOpen(false)}>
              {t.nav[index]}
            </a>
          ))}
          <button
            className="language-button mobile-language"
            onClick={() => chooseLanguage(rtl ? "en" : "ar")}
          >
            <Globe2 size={15} />
            {rtl ? "EN" : "عربي"}
          </button>
          <button className="button button--dark nav-book" onClick={openBooking}>
            {t.book}
            <ArrowRight size={16} />
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="experience-replay"
            onClick={() => setIntroOpen(true)}
            aria-label={rtl ? "أعد تشغيل المقدمة" : "Replay introduction"}
          >
            <Sparkles size={14} />
            <span>{rtl ? "المقدمة" : "REPLAY"}</span>
          </button>
          <button
            className="language-button"
            onClick={() => chooseLanguage(rtl ? "en" : "ar")}
            aria-label={rtl ? "التبديل إلى الإنجليزية" : "Switch to Arabic"}
          >
            <Globe2 size={15} />
            {rtl ? "EN" : "عربي"}
          </button>
          <button className="button button--dark desktop-book" onClick={openBooking}>
            {t.book}
            <ArrowRight size={16} />
          </button>
          <button
            className="menu-button"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label="Open menu"
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow reveal-item">
            <span />
            {t.eyebrow}
          </div>
          <h1 className="reveal-item reveal-delay-1">
            <span>{t.titleA}</span>
            <em>{t.titleB}</em>
          </h1>
          <p className="hero-intro reveal-item reveal-delay-2">{t.intro}</p>
          <div className="hero-actions reveal-item reveal-delay-3">
            <button className="button button--burgundy" onClick={openBooking}>
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
                <span>{rtl ? "صمّم رحلتك" : "Design my journey"}</span>
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
                onClick={openBooking}
                aria-label="View live appointment availability"
              >
                <span className="live-dot" />
                <span className="availability-copy">
                  <small>{t.heroDate}</small>
                  <strong>{rtl ? "غداً · المعادي" : "Tomorrow · Maadi"}</strong>
                </span>
                <span className="availability-arrow" aria-hidden>
                  <ChevronRight size={18} />
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="hero-rail" aria-hidden>
          <span>SCROLL TO DISCOVER</span>
          <i />
        </div>
      </section>

      <section className="experience-portal" aria-label="Explore the experience">
        <div className="portal-sticky">
          <div className="portal-word" aria-hidden>BEYOND</div>
          <div className="portal-heading">
            <span>{rtl ? "مرّر لاكتشاف التجربة" : "SCROLL INTO THE EXPERIENCE"}</span>
            <strong>{rtl ? "الرعاية، بشكل مختلف." : "Care, reimagined."}</strong>
          </div>
          <div className="portal-track" aria-hidden><span /></div>
          <div className="portal-orb" aria-hidden>
            <div className="portal-orb-core"><span /><span /><span /></div>
          </div>

          <article className="portal-scene portal-scene--one">
            <span className="portal-index">01 / 03 · CARELENS</span>
            <h2>
              {rtl ? "لا تبدأ باسم الإجراء." : "Don’t start with a procedure."}
              <em>{rtl ? "ابدأ بما تريد أن تشعر به." : "Start with how you want to feel."}</em>
            </h2>
            <p>
              {rtl
                ? "تجربة بصرية تحوّل إحساسك وأهدافك إلى حوار طبي أوضح."
                : "A visual discovery tool that turns feelings and goals into a clearer clinical conversation."}
            </p>
            <a className="portal-action" href="#carelens">
              {rtl ? "جرّب كير لِنز" : "Try CareLens"}
              <ArrowRight size={17} />
            </a>
          </article>

          <article className="portal-scene portal-scene--two">
            <span className="portal-index">02 / 03 · NOOR</span>
            <h2>
              {rtl ? "اسأل السؤال الذي يشغلك." : "Ask the question you keep thinking about."}
              <em>{rtl ? "بخصوصية. وبدون أحكام." : "Privately. Without judgement."}</em>
            </h2>
            <p>
              {rtl
                ? "نور تشرح الخيارات والاستعداد والتعافي بالعربية أو الإنجليزية."
                : "NOOR explains options, preparation, and recovery in Arabic or English."}
            </p>
            <button className="portal-action" onClick={() => setNoorOpen(true)}>
              <NoorOrb small />
              {rtl ? "تحدث مع نور" : "Talk to NOOR"}
            </button>
          </article>

          <article className="portal-scene portal-scene--three">
            <span className="portal-index">03 / 03 · LIVE ACCESS</span>
            <h2>
              {rtl ? "شاهد المواعيد الحقيقية." : "See real availability."}
              <em>{rtl ? "واحجز خلال ثوانٍ." : "Reserve in seconds."}</em>
            </h2>
            <p>
              {rtl
                ? "اختر الفرع والموعد، وسيحتفظ النظام بالوقت أثناء إكمال بياناتك."
                : "Choose a clinic and time; the system protects your slot while you complete the details."}
            </p>
            <button className="portal-action portal-action--solid" onClick={openBooking}>
              <CalendarDays size={17} />
              {rtl ? "اعرض المواعيد الآن" : "View live times"}
              <ArrowRight size={17} />
            </button>
          </article>

          <div className="portal-footnote">
            <span>{rtl ? "تجربة رقمية متصلة" : "ONE CONNECTED EXPERIENCE"}</span>
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
        <div className="proof-stats">
          <article>
            <strong>25<sup>+</sup></strong>
            <span>{rtl ? "عاماً من الخبرة" : "Years of experience"}</span>
          </article>
          <article>
            <strong>3</strong>
            <span>{rtl ? "عيادات في القاهرة" : "Cairo locations"}</span>
          </article>
          <article>
            <strong>360°</strong>
            <span>{rtl ? "رحلة رعاية متكاملة" : "Connected care journey"}</span>
          </article>
        </div>
      </section>

      <section className="carelens section-pad" id="carelens">
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
      </section>

      <section className="noor-feature section-pad">
        <div className="noor-atmosphere">
          <NoorOrb />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
        </div>
        <div className="noor-copy">
          <span className="section-index section-index--light">03 — NOOR AI CONCIERGE</span>
          <h2>
            {rtl ? "اسأل، افهم، ثم قرر." : "Ask. Understand. Then decide."}
          </h2>
          <p>
            {rtl
              ? "نور تساعدك على استكشاف الخيارات، فهم الاستعداد والتعافي، والوصول للاستشارة المناسبة — بالعربية أو الإنجليزية."
              : "NOOR helps you explore options, understand preparation and recovery, and reach the right consultation — in Arabic or English."}
          </p>
          <div className="prompt-chips">
            {(rtl
              ? ["ماذا أتوقع بعد تجميل الأنف؟", "ما أقرب موعد؟", "كيف أستعد للاستشارة؟"]
              : [
                  "What is rhinoplasty recovery like?",
                  "Show me the next appointment",
                  "How should I prepare?",
                ]
            ).map((prompt) => (
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

      <section className="final-cta">
        <div>
          <span className="section-index">BEGIN YOUR JOURNEY</span>
          <h2>{t.finalTitle}</h2>
          <p>{t.finalBody}</p>
        </div>
        <div className="final-actions">
          <button
            className="button button--dark button--large"
            onClick={() => setJourneyDesignerOpen(true)}
          >
            <Sparkles size={18} />
            {rtl ? "صمّم رحلتك" : "Design your journey"}
          </button>
          <button className="button button--burgundy button--large" onClick={openBooking}>
            <CalendarDays size={19} />
            {t.book}
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      <footer>
        <div className="footer-brand">
          <Image src="/logo.png" alt="" width={42} height={42} unoptimized />
          <span>
            <strong>{rtl ? "د. أشرف متولي" : "ASHRAF METWALLY"}</strong>
            <small>{rtl ? "جراحات التجميل" : "PLASTIC SURGERY"}</small>
          </span>
        </div>
        <p>Maadi · Mohandessin · Fifth Settlement</p>
        <div className="footer-links">
          <a href={`tel:${CONTACT.phone}`}>{rtl ? "اتصل بالعيادة" : "Call clinic"}</a>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          <Link href="/command-center">Clinic OS</Link>
        </div>
      </footer>

      {heroPassed && (
        <button
          className="floating-noor"
          onClick={() => setNoorOpen(true)}
          aria-label={rtl ? "اسأل نور" : "Ask NOOR, the AI concierge"}
        >
          <NoorOrb small />
          <span className="floating-noor-copy">
            <small>{rtl ? "مساعدة ذكية" : "AI CONCIERGE"}</small>
            <strong>{rtl ? "اسأل نور" : "Ask NOOR"}</strong>
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
      {bookingOpen && (
        <BookingModal language={language} onClose={() => setBookingOpen(false)} />
      )}
      {journeyDesignerOpen && (
        <JourneyDesigner
          language={language}
          onClose={() => setJourneyDesignerOpen(false)}
          onBook={openBooking}
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
  const rtl = language === "ar";
  const initial = rtl
    ? "أهلاً، أنا نور. أستطيع مساعدتك في فهم الخيارات، الاستعداد، التعافي أو العثور على موعد مناسب. ما الذي يشغل بالك؟"
    : "Hello, I’m NOOR. I can help you understand options, preparation, recovery, or find a suitable appointment. What’s on your mind?";
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: initial },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const replyTimer = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
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

  function answerFor(question: string) {
    const normalized = question.toLowerCase();
    if (/book|appointment|available|موعد|حجز/.test(normalized)) {
      return rtl
        ? "أستطيع عرض المواعيد المتاحة الآن في المعادي أو المهندسين أو التجمع. اضغط «عرض المواعيد» وسأكمل معك."
        : "I can show live availability in Maadi, Mohandessin, or Fifth Settlement now. Select “View times” and I’ll take you there.";
    }
    if (/nose|rhino|أنف|تجميل الأنف/.test(normalized)) {
      return rtl
        ? "في استشارة تجميل الأنف، يقيّم د. أشرف التناسق والتنفس وسُمك الجلد والتوقعات معاً. يختلف التعافي من شخص لآخر، لكن التورم والكدمات الأولية غالباً تتحسن تدريجياً خلال الأسابيع الأولى. القرار النهائي يحتاج كشفاً طبياً."
        : "In a rhinoplasty consultation, Dr. Ashraf considers facial balance, breathing, skin thickness, and expectations together. Early swelling and bruising commonly ease over the first weeks, while refinement continues longer. Your exact plan requires an in-person assessment.";
    }
    if (/recover|healing|recovery|تعافي|نقاهة/.test(normalized)) {
      return rtl
        ? "مدة التعافي تعتمد على الإجراء وصحتك وطبيعة عملك. سنناقش العودة للنشاط، العناية بالجرح، المتابعة والعلامات التي تستدعي التواصل قبل تحديد الموعد."
        : "Recovery depends on the procedure, your health, and your daily routine. Before scheduling, we’ll clarify time away from work, wound care, follow-up, movement, and when to contact the clinic.";
    }
    if (/price|cost|تكلفة|سعر/.test(normalized)) {
      return rtl
        ? "التكلفة تتحدد بعد التقييم لأنها تعتمد على الخطة، المستشفى، التخدير والمتابعة. يمكنني حجز استشارة تحصل بعدها على عرض واضح ومفصل."
        : "Cost is confirmed after assessment because it depends on the plan, facility, anaesthesia, and follow-up. I can reserve a consultation so you receive a clear, itemised proposal.";
    }
    if (/prepare|consult|استعد|استشارة/.test(normalized)) {
      return rtl
        ? "اكتب أهدافك وأسئلتك، وأحضر تاريخك الطبي وقائمة الأدوية وصوراً مرجعية إن وجدت. الأهم أن تكون واضحاً بشأن النتيجة التي تريدها وما لا تريده."
        : "Bring your goals, questions, medical history, medication list, and optional reference images. Most importantly, be clear about what you want to feel different—and what you do not want changed.";
    }
    return rtl
      ? "أفهمك. أفضل خطوة هي تحديد المنطقة أو الهدف الذي تفكر فيه، ثم أشرح لك ما يمكن مناقشته في الاستشارة بدون افتراض تشخيص. هل تسأل عن الوجه، الأنف، القوام أم التعافي؟"
      : "I understand. A useful next step is to name the area or change you’re considering, and I’ll explain what can be explored in consultation without assuming a diagnosis. Is this about the face, nose, body, or recovery?";
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
        {
          role: "assistant",
          text: rtl
            ? "الاستماع الصوتي غير متاح في هذا المتصفح، لكن يمكنك كتابة سؤالك هنا."
            : "Voice listening is not available in this browser, but you can type your question here.",
        },
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
    <Modal onClose={onClose} label={rtl ? "نور، المساعدة الذكية" : "NOOR, the AI concierge"}>
      <aside className="noor-panel" dir={rtl ? "rtl" : "ltr"}>
        <div className="noor-panel-header">
          <div>
            <NoorOrb small />
            <span>
              <strong>NOOR</strong>
              <small>
                <i />
                {rtl ? "متصلة الآن" : "Online now"}
              </small>
            </span>
          </div>
          <button onClick={onClose} aria-label="Close NOOR">
            <X />
          </button>
        </div>
        <div className="chat-log">
          <div className="chat-date">{rtl ? "اليوم" : "TODAY"}</div>
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
          <button onClick={() => submit(rtl ? "ما أقرب موعد؟" : "What is the next available time?")}>
            {rtl ? "أقرب موعد" : "Next appointment"}
          </button>
          <button onClick={() => submit(rtl ? "كيف أستعد؟" : "How should I prepare?")}>
            {rtl ? "الاستعداد" : "Prepare"}
          </button>
          <button onClick={onBook}>{rtl ? "عرض المواعيد" : "View times"}</button>
        </div>
        <form
          className="chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            submit(input);
          }}
        >
          <button type="button" onClick={startVoice} aria-label="Speak">
            <Mic size={18} />
          </button>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={rtl ? "اكتب سؤالك هنا..." : "Ask anything about your care..."}
          />
          <button type="submit" aria-label="Send">
            <ArrowRight size={18} />
          </button>
        </form>
        <button className="listen-button" onClick={speakLast}>
          <Zap size={13} />
          {rtl ? "استمع لآخر إجابة" : "Listen to the last answer"}
        </button>
        <p className="noor-legal">
          <ShieldCheck size={13} />
          {rtl
            ? "معلومات تثقيفية فقط. الحالات العاجلة تحتاج تواصلاً طبياً مباشراً."
            : "Educational guidance only. Urgent concerns require direct medical care."}
        </p>
      </aside>
    </Modal>
  );
}

function BookingModal({
  language,
  onClose,
}: {
  language: Language;
  onClose: () => void;
}) {
  const rtl = language === "ar";
  const [step, setStep] = useState<"slots" | "details" | "success">("slots");
  const [service, setService] = useState(SERVICES[0].id);
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [bookingId, setBookingId] = useState("");
  const selectedDay = useMemo(
    () => days.find((day) => day.date === selectedDate),
    [days, selectedDate],
  );
  const branchLabel = BRANCHES.find((item) => item.id === branch);
  const serviceLabel = SERVICES.find((item) => item.id === service);

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
        return (await response.json()) as { dates: AvailabilityDay[] };
      })
      .then((data) => {
        setDays(data.dates ?? []);
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
        setError(
          rtl
            ? "انتهت مدة حجز الموعد المؤقت. اختر وقتاً جديداً."
            : "Your held time expired. Please choose a new time.",
        );
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [holdExpiresAt, rtl]);

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
      // Another visitor may have taken a slot while this one was choosing.
      if (response.status === 409) setReloadKey((key) => key + 1);
    } catch (caught) {
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
          consent: form.get("consent") === "on",
          language,
        }),
      });
      const data = (await response.json()) as {
        booking?: { id?: string };
        message?: string;
      };
      if (!response.ok) throw new Error(data.message || "Unable to confirm.");
      setBookingId(data.booking?.id?.slice(0, 8).toUpperCase() || "");
      setHoldExpiresAt(0);
      setStep("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm.");
    } finally {
      setSubmitting(false);
    }
  }

  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <Modal onClose={onClose} labelledBy="booking-modal-title">
      <section className="booking-modal" dir={rtl ? "rtl" : "ltr"}>
        <div className="booking-top">
          <div>
            <span className="section-index">
              {step === "slots" ? "01" : step === "details" ? "02" : "03"} — LIVE BOOKING
            </span>
            <h2 id="booking-modal-title">
              {step === "success"
                ? rtl
                  ? "تم حجز زيارتك."
                  : "Your visit is reserved."
                : rtl
                  ? "اختر الموعد المناسب."
                  : "Choose a time that fits."}
            </h2>
          </div>
          <button onClick={onClose} aria-label={rtl ? "إغلاق الحجز" : "Close booking"}>
            <X />
          </button>
        </div>

        {step === "slots" && (
          <div className="booking-content">
            <div className="booking-fields">
              <label>
                <span>{rtl ? "نوع الاستشارة" : "Consultation type"}</span>
                <select
                  value={service}
                  onChange={(event) => {
                    setSelectedTime("");
                    setService(event.target.value);
                  }}
                >
                  {SERVICES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {rtl ? item.ar : item.en}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{rtl ? "الفرع" : "Clinic"}</span>
                <select
                  value={branch}
                  onChange={(event) => {
                    setSelectedTime("");
                    setBranch(event.target.value as typeof branch);
                  }}
                >
                  {BRANCHES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {rtl ? item.ar : item.en}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {loadFailed ? (
              <div className="booking-unavailable">
                <p>
                  {rtl
                    ? "تعذر تحميل المواعيد المتاحة الآن."
                    : "We could not load live availability right now."}
                </p>
                <div className="booking-unavailable-actions">
                  <button
                    className="button button--dark"
                    onClick={() => setReloadKey((key) => key + 1)}
                  >
                    {rtl ? "إعادة المحاولة" : "Try again"}
                  </button>
                  <a href={`tel:${CONTACT.phone}`}>
                    {rtl ? "اتصل بالعيادة" : "Call the clinic"}
                  </a>
                  <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                    WhatsApp
                  </a>
                </div>
              </div>
            ) : (
              <>
                <div className="date-tabs">
                  {days.map((day) => (
                    <button
                      key={day.date}
                      className={selectedDate === day.date ? "active" : ""}
                      disabled={day.slots.length === 0}
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
                    {rtl ? "المواعيد المتاحة" : "Available times"}
                  </span>
                  <small>
                    <i />
                    {loading ? (rtl ? "جاري التحديث" : "Refreshing") : rtl ? "مباشر" : "Live"}
                  </small>
                </div>
                <div className="slots" aria-busy={loading}>
                  {(selectedDay?.slots ?? []).map((time) => (
                    <button
                      className={selectedTime === time ? "active" : ""}
                      key={time}
                      onClick={() => setSelectedTime(time)}
                    >
                      {time}
                    </button>
                  ))}
                </div>
                {!loading && (selectedDay?.slots.length ?? 0) === 0 && (
                  <p className="slots-empty">
                    {rtl
                      ? "لا توجد مواعيد متاحة في هذا اليوم. جرّب يوماً أو فرعاً آخر."
                      : "No times left on this day. Try another day or clinic."}
                  </p>
                )}
              </>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="booking-footer">
              <p>
                <ShieldCheck size={15} />
                {rtl
                  ? "يُحفظ الموعد لمدة ٥ دقائق أثناء إكمال البيانات."
                  : "Your time is held for 5 minutes while you complete the details."}
              </p>
              <button
                className="button button--burgundy"
                onClick={holdSlot}
                disabled={!selectedTime || submitting || loading}
              >
                {submitting ? (rtl ? "لحظة..." : "Holding...") : rtl ? "متابعة" : "Continue"}
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
                  <small>{rtl ? serviceLabel?.ar : serviceLabel?.en}</small>
                  <strong>{selectedDay?.day} · {selectedTime}</strong>
                </span>
              </div>
              <span>
                <MapPin size={14} />
                {rtl ? branchLabel?.ar : branchLabel?.en}
              </span>
            </div>
            {secondsLeft > 0 && (
              <p className="hold-countdown" role="status">
                <Clock3 size={14} />
                {rtl
                  ? `هذا الموعد محجوز لك لمدة ${countdown}`
                  : `This time is held for you for ${countdown}`}
              </p>
            )}
            <div className="form-grid">
              <label>
                <span>{rtl ? "الاسم بالكامل" : "Full name"}</span>
                <input
                  name="name"
                  required
                  maxLength={120}
                  autoComplete="name"
                  placeholder={rtl ? "اكتب اسمك" : "Your name"}
                />
              </label>
              <label>
                <span>{rtl ? "رقم الهاتف" : "Mobile number"}</span>
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
                <span>{rtl ? "البريد الإلكتروني (اختياري)" : "Email (optional)"}</span>
                <input
                  name="email"
                  type="email"
                  maxLength={200}
                  autoComplete="email"
                  placeholder="name@example.com"
                />
              </label>
            </div>
            <label className="consent">
              <input type="checkbox" name="consent" required />
              <span>
                {rtl
                  ? "أوافق على تواصل العيادة لتأكيد الموعد."
                  : "I agree to be contacted by the clinic to confirm my appointment."}
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="booking-footer">
              <button type="button" className="back-button" onClick={() => setStep("slots")}>
                {rtl ? "العودة" : "Back"}
              </button>
              <button className="button button--burgundy" disabled={submitting}>
                {submitting
                  ? rtl ? "جاري التأكيد..." : "Confirming..."
                  : rtl ? "تأكيد الموعد" : "Confirm appointment"}
                <Check size={16} />
              </button>
            </div>
          </form>
        )}

        {step === "success" && (
          <div className="booking-success">
            <div className="success-mark"><Check size={32} /></div>
            {bookingId && <span className="confirmation-id">REF · {bookingId}</span>}
            <h3>
              {selectedDay?.day} {rtl ? "الساعة" : "at"} {selectedTime}
            </h3>
            <p>
              {rtl
                ? `تم حجز الموعد في فرع ${branchLabel?.ar}. سيتواصل معك فريق العيادة لتأكيد التفاصيل.`
                : `Your ${branchLabel?.en} visit is in the calendar. The clinic team will contact you to confirm the details.`}
            </p>
            <div className="success-actions">
              <button className="button button--dark" onClick={onClose}>
                {rtl ? "تم" : "Done"}
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
