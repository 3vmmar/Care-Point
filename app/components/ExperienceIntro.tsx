"use client";

import { ArrowDown, ArrowRight, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

export default function ExperienceIntro({
  language,
  onEnter,
}: {
  language: "en" | "ar";
  onEnter: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const rtl = language === "ar";

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function enter() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onEnter, 900);
  }

  return (
    <div
      className={`experience-intro ${leaving ? "experience-intro--leaving" : ""}`}
      dir={rtl ? "rtl" : "ltr"}
    >
      <div className="intro-grid" aria-hidden />
      <div className="intro-orbit intro-orbit--one" aria-hidden />
      <div className="intro-orbit intro-orbit--two" aria-hidden />
      <div className="intro-orbit intro-orbit--three" aria-hidden />
      <div className="intro-core" aria-hidden>
        <span /><span /><span />
      </div>
      <div className="intro-topline">
        <span>DR. ASHRAF METWALLY</span>
        <span>{rtl ? "تجربة الرعاية الجديدة" : "A NEW CARE EXPERIENCE"}</span>
      </div>
      <button className="intro-close" onClick={enter} aria-label="Skip introduction">
        <X size={16} />
        <span>{rtl ? "تخطي" : "SKIP"}</span>
      </button>
      <div className="intro-copy">
        <span className="intro-kicker">
          <Sparkles size={13} />
          {rtl ? "أهلاً بك في مستقبل الرعاية التجميلية" : "WELCOME TO THE FUTURE OF AESTHETIC CARE"}
        </span>
        <h1>
          {rtl ? "هذه ليست مجرد" : "This is not"}
          <em>{rtl ? "زيارة عيادة." : "a clinic visit."}</em>
          <strong>{rtl ? "إنها رحلة مصممة لك." : "It is a journey designed around you."}</strong>
        </h1>
        <button className="intro-enter" onClick={enter}>
          <span>{rtl ? "ادخل التجربة" : "Enter the experience"}</span>
          <ArrowRight size={18} />
        </button>
      </div>
      <div className="intro-scroll">
        <ArrowDown size={14} />
        <span>{rtl ? "صُممت لتُكتشف" : "DESIGNED TO BE DISCOVERED"}</span>
      </div>
      <div className="intro-chapters" aria-hidden>
        <span>01 · DISCOVER</span>
        <span>02 · UNDERSTAND</span>
        <span>03 · CONNECT</span>
      </div>
    </div>
  );
}
