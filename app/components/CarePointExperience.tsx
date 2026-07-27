"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
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
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Language = "en" | "ar";
type AvailabilityDay = {
  date: string;
  weekday: string;
  day: string;
  slots: string[];
};
type ChatMessage = { role: "assistant" | "user"; text: string };

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

const services = [
  "Aesthetic consultation",
  "Face & neck consultation",
  "Rhinoplasty consultation",
  "Body contouring consultation",
  "Breast surgery consultation",
  "Non-surgical aesthetics",
];

const branches = ["Maadi", "Mohandessin", "Fifth Settlement"];

const careAreas = [
  {
    id: "face",
    number: "01",
    title: "Face & neck",
    ar: "الوجه والرقبة",
    prompt: "I want to look fresher, without looking different.",
    arPrompt: "أريد مظهراً أكثر حيوية بدون تغيير ملامحي.",
    options: ["Facelift", "Eyelid surgery", "Fat grafting"],
    detail:
      "We assess skin, volume, muscle support, and facial balance before discussing any procedure.",
  },
  {
    id: "nose",
    number: "02",
    title: "Nose & profile",
    ar: "الأنف وتناسق الوجه",
    prompt: "I want better balance from every angle.",
    arPrompt: "أريد تناسقاً أفضل من كل زاوية.",
    options: ["Rhinoplasty", "Septorhinoplasty", "Profile balancing"],
    detail:
      "Form and breathing are considered together, with a plan grounded in your individual anatomy.",
  },
  {
    id: "body",
    number: "03",
    title: "Body",
    ar: "القوام",
    prompt: "My shape no longer reflects how I feel.",
    arPrompt: "قوامي لم يعد يعكس إحساسي بنفسي.",
    options: ["Tummy tuck", "Liposculpture", "Post-weight-loss surgery"],
    detail:
      "Your skin quality, muscle support, proportions, and lifestyle shape the right conversation.",
  },
  {
    id: "breast",
    number: "04",
    title: "Breast",
    ar: "الثدي",
    prompt: "I want proportion, comfort, and confidence.",
    arPrompt: "أبحث عن التناسق والراحة والثقة.",
    options: ["Lift", "Reduction", "Augmentation"],
    detail:
      "We explore size, position, symmetry, scarring, and long-term goals with complete discretion.",
  },
];

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

const fallbackDays: AvailabilityDay[] = Array.from({ length: 5 }, (_, index) => {
  const date = new Date();
  date.setDate(date.getDate() + index + 1);
  return {
    date: date.toISOString().slice(0, 10),
    weekday: new Intl.DateTimeFormat("en", { weekday: "short" }).format(date),
    day: new Intl.DateTimeFormat("en", {
      day: "2-digit",
      month: "short",
    }).format(date),
    slots: ["11:00", "14:00", "17:30"],
  };
});

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
  const [activeArea, setActiveArea] = useState("face");
  const t = copy[language];
  const rtl = language === "ar";

  function openBooking() {
    setBookingOpen(true);
    setMobileOpen(false);
  }

  return (
    <main className="site-shell" dir={rtl ? "rtl" : "ltr"}>
      <div className="grain" aria-hidden />
      <header className="site-header">
        <Link className="brand" href="#top" aria-label="Dr. Ashraf Metwally home">
          <Image src="/logo.png" alt="" width={52} height={52} priority />
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
            onClick={() => setLanguage(rtl ? "en" : "ar")}
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
            className="language-button"
            onClick={() => setLanguage(rtl ? "en" : "ar")}
            aria-label="Change language"
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
            {t.titleA}
            <em>{t.titleB}</em>
          </h1>
          <p className="hero-intro reveal-item reveal-delay-2">{t.intro}</p>
          <div className="hero-actions reveal-item reveal-delay-3">
            <button className="button button--burgundy" onClick={openBooking}>
              <CalendarDays size={18} />
              {t.book}
            </button>
            <button className="text-button" onClick={() => setNoorOpen(true)}>
              <NoorOrb small />
              {t.ask}
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="credential reveal-item reveal-delay-3">
            <ShieldCheck size={19} />
            <span>{t.trust}</span>
          </div>
        </div>

        <div className="hero-visual reveal-item reveal-delay-2">
          <div className="portrait-frame">
            <Image
              src="/doctor-hero.png"
              alt="Dr. Ashraf Metwally in a modern clinic"
              fill
              sizes="(max-width: 900px) 92vw, 48vw"
              priority
            />
            <div className="portrait-wash" />
          </div>
          <div className="availability-card">
            <span className="live-dot" />
            <div>
              <small>{t.heroDate}</small>
              <strong>{rtl ? "غداً · المعادي" : "Tomorrow · Maadi"}</strong>
            </div>
            <button onClick={openBooking} aria-label="View availability">
              <ChevronRight size={19} />
            </button>
          </div>
          <div className="doctor-mark">
            <span>{t.signature}</span>
            <small>{t.signatureRole}</small>
          </div>
        </div>

        <div className="hero-rail" aria-hidden>
          <span>SCROLL TO DISCOVER</span>
          <i />
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

        <div className="carelens-stage">
          <div className="area-list">
            {careAreas.map((area) => (
              <button
                key={area.id}
                className={activeArea === area.id ? "area-row active" : "area-row"}
                onClick={() => setActiveArea(area.id)}
              >
                <span>{area.number}</span>
                <strong>{rtl ? area.ar : area.title}</strong>
                <p>{rtl ? area.arPrompt : area.prompt}</p>
                <ChevronRight size={20} />
              </button>
            ))}
          </div>
          <CareLensPanel
            area={careAreas.find((area) => area.id === activeArea) ?? careAreas[0]}
            language={language}
            onBook={openBooking}
            onAsk={() => setNoorOpen(true)}
          />
        </div>
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
        <button className="button button--burgundy button--large" onClick={openBooking}>
          <CalendarDays size={19} />
          {t.book}
          <ArrowRight size={18} />
        </button>
      </section>

      <footer>
        <div className="footer-brand">
          <Image src="/logo.png" alt="" width={42} height={42} />
          <span>
            <strong>{rtl ? "د. أشرف متولي" : "ASHRAF METWALLY"}</strong>
            <small>{rtl ? "جراحات التجميل" : "PLASTIC SURGERY"}</small>
          </span>
        </div>
        <p>Maadi · Mohandessin · Fifth Settlement</p>
        <div className="footer-links">
          <a href="tel:+201000000000">Call clinic</a>
          <a href="https://wa.me/201000000000">WhatsApp</a>
          <Link href="/command-center">Clinic OS</Link>
        </div>
      </footer>

      <button className="floating-noor" onClick={() => setNoorOpen(true)}>
        <NoorOrb small />
        <span>
          <small>{rtl ? "مساعدة ذكية" : "AI CONCIERGE"}</small>
          <strong>{rtl ? "اسأل نور" : "Ask NOOR"}</strong>
        </span>
      </button>

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
    </main>
  );
}

function CareLensPanel({
  area,
  language,
  onBook,
  onAsk,
}: {
  area: (typeof careAreas)[number];
  language: Language;
  onBook: () => void;
  onAsk: () => void;
}) {
  const rtl = language === "ar";
  return (
    <div className="carelens-panel" key={area.id}>
      <div className={`anatomy-shape anatomy-shape--${area.id}`}>
        <span />
        <span />
        <span />
      </div>
      <div className="carelens-panel-content">
        <small>{rtl ? "نقطة بداية للنقاش" : "A starting point for your conversation"}</small>
        <h3>“{rtl ? area.arPrompt : area.prompt}”</h3>
        <p>
          {rtl
            ? "خلال الاستشارة نقيّم التكوين والتناسق والأهداف قبل مناقشة أي إجراء."
            : area.detail}
        </p>
        <div className="option-tags">
          {area.options.map((option) => (
            <span key={option}>{option}</span>
          ))}
        </div>
        <div className="panel-actions">
          <button onClick={onAsk}>
            <Bot size={16} />
            {rtl ? "اسأل نور" : "Ask NOOR"}
          </button>
          <button onClick={onBook}>
            {rtl ? "احجز استشارة" : "Book a consultation"}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
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

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

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
    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: answerFor(clean) },
      ]);
      setThinking(false);
    }, 650);
  }

  function startVoice() {
    type SpeechResult = { results: { 0: { 0: { transcript: string } } } };
    type SpeechRecognitionLike = {
      lang: string;
      start: () => void;
      onresult: (event: SpeechResult) => void;
      onerror: () => void;
    };
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
    const recognition = new Recognition();
    recognition.lang = rtl ? "ar-EG" : "en-US";
    recognition.onresult = (event) => submit(event.results[0][0].transcript);
    recognition.onerror = () => undefined;
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
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-scrim" onClick={onClose} aria-label="Close" />
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
    </div>
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
  const [service, setService] = useState(services[0]);
  const [branch, setBranch] = useState(branches[0]);
  const [days, setDays] = useState<AvailabilityDay[]>(fallbackDays);
  const [selectedDate, setSelectedDate] = useState(fallbackDays[0].date);
  const [selectedTime, setSelectedTime] = useState("");
  const [holdToken, setHoldToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [bookingId, setBookingId] = useState("");
  const selectedDay = useMemo(
    () => days.find((day) => day.date === selectedDate) ?? days[0],
    [days, selectedDate],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/availability?branch=${encodeURIComponent(branch)}&service=${encodeURIComponent(service)}`,
    )
      .then((response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<{ dates: AvailabilityDay[] }>;
      })
      .then((data) => {
        if (cancelled || !data.dates?.length) return;
        setDays(data.dates);
        setSelectedDate(data.dates[0].date);
      })
      .catch(() => {
        if (!cancelled) setDays(fallbackDays);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branch, service]);

  async function holdSlot() {
    if (!selectedTime) return;
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
      const data = (await response.json()) as { holdToken?: string; message?: string };
      if (!response.ok || !data.holdToken) {
        throw new Error(data.message || "Unable to hold this time.");
      }
      setHoldToken(data.holdToken);
      setStep("details");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Please choose another time.");
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
          language,
        }),
      });
      const data = (await response.json()) as {
        booking?: { id?: string };
        message?: string;
      };
      if (!response.ok) throw new Error(data.message || "Unable to confirm.");
      setBookingId(data.booking?.id?.slice(0, 8).toUpperCase() || "CARE-01");
      setStep("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-scrim" onClick={onClose} aria-label="Close" />
      <section className="booking-modal" dir={rtl ? "rtl" : "ltr"}>
        <div className="booking-top">
          <div>
            <span className="section-index">
              {step === "slots" ? "01" : step === "details" ? "02" : "03"} — LIVE BOOKING
            </span>
            <h2>
              {step === "success"
                ? rtl
                  ? "تم حجز زيارتك."
                  : "Your visit is reserved."
                : rtl
                  ? "اختر الموعد المناسب."
                  : "Choose a time that fits."}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close booking">
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
                    setLoading(true);
                    setSelectedTime("");
                    setService(event.target.value);
                  }}
                >
                  {services.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>{rtl ? "الفرع" : "Clinic"}</span>
                <select
                  value={branch}
                  onChange={(event) => {
                    setLoading(true);
                    setSelectedTime("");
                    setBranch(event.target.value);
                  }}
                >
                  {branches.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <div className="date-tabs">
              {days.map((day) => (
                <button
                  key={day.date}
                  className={selectedDate === day.date ? "active" : ""}
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
            <div className="slots">
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
            {error && <p className="form-error">{error}</p>}
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
                disabled={!selectedTime || submitting}
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
                  <small>{service}</small>
                  <strong>{selectedDay?.day} · {selectedTime}</strong>
                </span>
              </div>
              <span><MapPin size={14} />{branch}</span>
            </div>
            <div className="form-grid">
              <label>
                <span>{rtl ? "الاسم بالكامل" : "Full name"}</span>
                <input name="name" required placeholder={rtl ? "اكتب اسمك" : "Your name"} />
              </label>
              <label>
                <span>{rtl ? "رقم الهاتف" : "Mobile number"}</span>
                <input name="phone" type="tel" required placeholder="+20" />
              </label>
              <label className="full">
                <span>{rtl ? "البريد الإلكتروني (اختياري)" : "Email (optional)"}</span>
                <input name="email" type="email" placeholder="name@example.com" />
              </label>
            </div>
            <label className="consent">
              <input type="checkbox" required />
              <span>
                {rtl
                  ? "أوافق على تواصل العيادة لتأكيد الموعد."
                  : "I agree to be contacted by the clinic to confirm my appointment."}
              </span>
            </label>
            {error && <p className="form-error">{error}</p>}
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
            <span className="confirmation-id">REF · {bookingId}</span>
            <h3>{selectedDay?.day} at {selectedTime}</h3>
            <p>
              {rtl
                ? `تم حجز الموعد في فرع ${branch}. سيتواصل معك فريق العيادة لتأكيد التفاصيل.`
                : `Your ${branch} visit is in the calendar. The clinic team will contact you to confirm the details.`}
            </p>
            <div className="success-actions">
              <button className="button button--dark" onClick={onClose}>
                {rtl ? "تم" : "Done"}
              </button>
              <a href="https://wa.me/201000000000">
                <MessageCircle size={16} />
                WhatsApp
              </a>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
