"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile widget.
 *
 * Rendered only when the server reports a site key, so a deployment without bot
 * protection configured shows nothing at all rather than a broken box.
 *
 * The widget is loaded lazily and explicitly rather than through the script's
 * auto-render: the booking modal mounts long after the page does, and auto-render
 * only scans the DOM once on load.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          language?: string;
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
    onloadTurnstileCallback?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Loads the script once per page, whatever mounts first. */
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();

  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      // The script may already have finished before this listener attached.
      if (window.turnstile) resolve();
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(script);
  });
}

export default function Turnstile({
  siteKey,
  language,
  onToken,
}: {
  siteKey: string;
  language: "en" | "ar";
  onToken: (token: string | null) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Held in a ref so a re-render with a new inline callback cannot tear down and
  // re-create the widget, which would make the patient solve it twice. Synced in
  // an effect rather than during render, which React forbids.
  const emit = useRef(onToken);
  useEffect(() => {
    emit.current = onToken;
  });

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !holder.current || !window.turnstile) return;
        widgetId = window.turnstile.render(holder.current, {
          sitekey: siteKey,
          language,
          theme: "light",
          callback: (token) => emit.current(token),
          // A token is single-use and short-lived; clearing it on expiry stops
          // the form submitting something the server will reject.
          "expired-callback": () => emit.current(null),
          "error-callback": () => {
            emit.current(null);
            setFailed(true);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // Already gone with the modal; nothing to clean up.
        }
      }
    };
  }, [siteKey, language]);

  return (
    <div className="turnstile-field">
      <div ref={holder} />
      {failed && (
        <p className="turnstile-error" role="alert">
          {language === "ar"
            ? "تعذر تحميل التحقق الأمني. حدّث الصفحة أو اتصل بالعيادة."
            : "The security check could not load. Refresh the page, or call the clinic."}
        </p>
      )}
    </div>
  );
}
