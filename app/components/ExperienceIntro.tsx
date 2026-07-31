"use client";

import { ArrowDown, ArrowRight, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function ExperienceIntro({
  language,
  onEnter,
}: {
  language: "en" | "ar";
  onEnter: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const rtl = language === "ar";
  const introRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const intro = introRef.current;
    document.body.style.overflow = "hidden";

    const controls = () =>
      Array.from(intro?.querySelectorAll<HTMLElement>("button") ?? []).filter(
        (element) => !element.hasAttribute("disabled"),
      );

    controls()[0]?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onEnter();
        return;
      }
      if (event.key !== "Tab") return;

      const items = controls();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previous;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [onEnter]);

  function enter() {
    if (leaving) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onEnter();
      return;
    }
    setLeaving(true);
    window.setTimeout(onEnter, 900);
  }

  return (
    <div
      ref={introRef}
      className={`experience-intro ${leaving ? "experience-intro--leaving" : ""}`}
      dir={rtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="experience-intro-title"
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
      <button
        className="intro-close"
        onClick={enter}
        aria-label={rtl ? "تخطي المقدمة" : "Skip introduction"}
      >
        <X size={16} />
        <span>{rtl ? "تخطي" : "SKIP"}</span>
      </button>
      <div className="intro-copy">
        <span className="intro-kicker">
          <Sparkles size={13} />
          {rtl ? "أهلاً بك في مستقبل الرعاية التجميلية" : "WELCOME TO THE FUTURE OF AESTHETIC CARE"}
        </span>
        <h1 id="experience-intro-title">
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
