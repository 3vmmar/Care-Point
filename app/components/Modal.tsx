"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Dialog shell providing the behaviour every modal needs and none of them had:
 * Escape to close, a focus trap, focus restored to the trigger on close, and a
 * background scroll lock.
 *
 * Children render the panel itself, so each dialog keeps its own styling.
 */
export default function Modal({
  onClose,
  label,
  labelledBy,
  layerClassName = "modal-layer",
  children,
}: {
  onClose: () => void;
  /** Accessible name; use `labelledBy` instead when a heading already exists. */
  label?: string;
  labelledBy?: string;
  layerClassName?: string;
  children: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  // Held in a ref so an inline `onClose` arrow can't retrigger the mount effect
  // and steal focus back on every render.
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const layer = layerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(layer?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) =>
          // The scrim is a click target only: it opts out with tabindex="-1".
          element.tabIndex >= 0 &&
          (element.offsetParent !== null || element === document.activeElement),
      );

    (focusables()[0] ?? layer)?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !layer) return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !layer.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !layer.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={layerRef}
      className={layerClassName}
      role="dialog"
      aria-modal="true"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      tabIndex={-1}
    >
      <button className="modal-scrim" onClick={onClose} tabIndex={-1} aria-hidden />
      {children}
    </div>
  );
}
