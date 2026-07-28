"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("unhandled route error", error);
  }, [error]);

  return (
    <main className="route-message">
      <span>SOMETHING INTERRUPTED</span>
      <h1>This page could not load.</h1>
      <p>
        Please try again. If you need an appointment right now, the clinic team can
        book it for you directly.
      </p>
      <div className="route-message-actions">
        <button className="button button--burgundy" onClick={reset}>
          Try again
        </button>
        <Link href="/">Return home</Link>
      </div>
    </main>
  );
}
