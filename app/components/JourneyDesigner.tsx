"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type Language = "en" | "ar";

const questions = [
  {
    key: "focus",
    title: "What would you like to explore?",
    ar: "ما المنطقة التي تريد استكشافها؟",
    options: [
      { value: "face", label: "Face & neck", ar: "الوجه والرقبة" },
      { value: "nose", label: "Nose & profile", ar: "الأنف وتناسق الوجه" },
      { value: "body", label: "Body contour", ar: "تنسيق القوام" },
      { value: "breast", label: "Breast", ar: "الثدي" },
    ],
  },
  {
    key: "priority",
    title: "What matters most to you?",
    ar: "ما الأولوية الأهم بالنسبة لك؟",
    options: [
      { value: "natural", label: "A subtle, natural change", ar: "تغيير طبيعي وهادئ" },
      { value: "restore", label: "Restoring what changed", ar: "استعادة ما تغير" },
      { value: "structural", label: "A structural improvement", ar: "تحسين واضح في التكوين" },
      { value: "clarity", label: "I need expert clarity first", ar: "أحتاج رأي الخبير أولاً" },
    ],
  },
  {
    key: "timing",
    title: "Where are you in your decision?",
    ar: "أين أنت الآن في قرارك؟",
    options: [
      { value: "exploring", label: "Quietly exploring", ar: "أستكشف بهدوء" },
      { value: "months", label: "Considering the next 3–6 months", ar: "أفكر خلال ٣–٦ أشهر" },
      { value: "ready", label: "Ready to meet the doctor", ar: "مستعد لمقابلة الطبيب" },
    ],
  },
];

const recommendations: Record<string, { title: string; ar: string; note: string; arNote: string }> = {
  face: {
    title: "Facial balance consultation",
    ar: "استشارة تناسق الوجه",
    note: "A complete assessment of skin, volume, support, and facial harmony.",
    arNote: "تقييم متكامل للبشرة والحجم والدعم وتناسق ملامح الوجه.",
  },
  nose: {
    title: "Functional profile consultation",
    ar: "استشارة الأنف والتناسق الوظيفي",
    note: "A combined conversation about profile balance, structure, and breathing.",
    arNote: "حوار متكامل حول تناسق الملامح والتكوين والتنفس.",
  },
  body: {
    title: "Body architecture consultation",
    ar: "استشارة هندسة القوام",
    note: "An assessment of proportions, skin, muscle support, and lifestyle.",
    arNote: "تقييم للتناسق والجلد ودعم العضلات ونمط الحياة.",
  },
  breast: {
    title: "Breast proportion consultation",
    ar: "استشارة تناسق الثدي",
    note: "A discreet conversation around proportion, comfort, symmetry, and goals.",
    arNote: "حوار بخصوصية حول التناسق والراحة والتماثل والأهداف.",
  },
};

export default function JourneyDesigner({
  language,
  onClose,
  onBook,
}: {
  language: Language;
  onClose: () => void;
  onBook: () => void;
}) {
  const rtl = language === "ar";
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const complete = step >= questions.length;
  const question = questions[step];
  const recommendation = useMemo(
    () => recommendations[answers.focus || "face"],
    [answers.focus],
  );

  function select(value: string) {
    const next = { ...answers, [question.key]: value };
    setAnswers(next);
    window.setTimeout(() => setStep((current) => current + 1), 220);
  }

  return (
    <div className="modal-layer journey-layer" role="dialog" aria-modal="true">
      <button className="modal-scrim" onClick={onClose} aria-label="Close" />
      <section className="journey-designer" dir={rtl ? "rtl" : "ltr"}>
        <header>
          <div>
            <Sparkles size={15} />
            <span>
              <strong>{rtl ? "صمّم رحلتك" : "DESIGN YOUR JOURNEY"}</strong>
              <small>{rtl ? "تجربة شخصية خلال ٦٠ ثانية" : "60-SECOND PERSONAL PATH"}</small>
            </span>
          </div>
          <button onClick={onClose} aria-label="Close journey designer"><X /></button>
        </header>

        <div className="journey-progress">
          <span style={{ width: `${Math.min(100, ((step + 1) / (questions.length + 1)) * 100)}%` }} />
        </div>

        {!complete ? (
          <div className="journey-question" key={question.key}>
            <div className="journey-step-label">
              <span>0{step + 1}</span>
              <small>{rtl ? `من ٠${questions.length}` : `OF 0${questions.length}`}</small>
            </div>
            <h2>{rtl ? question.ar : question.title}</h2>
            <p>
              {rtl
                ? "لا توجد إجابة صحيحة أو خاطئة. اختر الأقرب لشعورك الآن."
                : "There is no right answer. Choose what feels closest to where you are now."}
            </p>
            <div className="journey-options">
              {question.options.map((option, index) => (
                <button key={option.value} onClick={() => select(option.value)}>
                  <span>0{index + 1}</span>
                  <strong>{rtl ? option.ar : option.label}</strong>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
            {step > 0 && (
              <button className="journey-back" onClick={() => setStep((current) => current - 1)}>
                <ArrowLeft size={14} />
                {rtl ? "السابق" : "Back"}
              </button>
            )}
          </div>
        ) : (
          <div className="journey-result">
            <div className="result-signal">
              <span><Check size={28} /></span>
              <i /><i /><i />
            </div>
            <span className="journey-result-kicker">
              {rtl ? "مسارك المقترح" : "YOUR RECOMMENDED STARTING POINT"}
            </span>
            <h2>{rtl ? recommendation.ar : recommendation.title}</h2>
            <p>{rtl ? recommendation.arNote : recommendation.note}</p>
            <div className="journey-result-meta">
              <span><Clock3 size={15} />{rtl ? "٤٥ دقيقة" : "45 minutes"}</span>
              <span><MapPin size={15} />{rtl ? "اختر أي فرع" : "Any Cairo clinic"}</span>
              <span><CalendarDays size={15} />{rtl ? "مواعيد مباشرة" : "Live availability"}</span>
            </div>
            <div className="journey-result-actions">
              <button
                className="button button--burgundy"
                onClick={() => {
                  onClose();
                  onBook();
                }}
              >
                {rtl ? "اعرض المواعيد" : "See matching appointments"}
                <ArrowRight size={16} />
              </button>
              <button
                className="result-restart"
                onClick={() => {
                  setAnswers({});
                  setStep(0);
                }}
              >
                {rtl ? "ابدأ من جديد" : "Start again"}
              </button>
            </div>
            <small>
              {rtl
                ? "هذه أداة إرشادية وليست تشخيصاً أو توصية طبية."
                : "This is a discovery guide, not a diagnosis or medical recommendation."}
            </small>
          </div>
        )}
      </section>
    </div>
  );
}
