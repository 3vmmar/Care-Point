"use client";

import { useEffect } from "react";

/**
 * Scroll-entrance choreography for server-rendered pages.
 *
 * The landing page's reveals ride its GSAP context; the treatment and legal
 * pages are static server components, and shipping GSAP to animate four
 * sections would be paying in bundle for what an IntersectionObserver does in
 * forty lines. Anything marked `data-reveal` gets `.in-view` as it enters the
 * viewport; the CSS owns what that means.
 *
 * Two safety properties, both deliberate:
 *
 *  - **No JS, no hiding.** The stylesheet only suppresses `[data-reveal]` when
 *    `<html data-reveal-ready>` is present, and only this effect sets that flag
 *    — so a visitor without JavaScript (or before hydration) sees the full
 *    page, never a blank one waiting for an observer that will not come.
 *  - **Reduced motion reveals immediately.** Everything is marked in-view on
 *    mount and the observer never attaches; the affordances stay, the movement
 *    goes.
 */
export default function RevealOnScroll() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (nodes.length === 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nodes.forEach((node) => node.classList.add("in-view"));
      return;
    }

    document.documentElement.setAttribute("data-reveal-ready", "");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      document.documentElement.removeAttribute("data-reveal-ready");
    };
  }, []);

  return null;
}
