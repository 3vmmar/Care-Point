"use client";

import { useState } from "react";
import Link from "next/link";
import "../security.css";

/**
 * The daily two-step challenge.
 *
 * One field, one button, and error text that says what to do next. Reception
 * opens this at the start of a shift with a queue in front of them; anything more
 * elaborate is something to resent.
 */
export default function VerifyCode({
  email,
  sessionHours,
}: {
  email: string;
  sessionHours: number;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/clinic/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", code }),
      });
      const data = (await response.json()) as {
        message?: string;
        lockedUntil?: string | null;
        attemptsRemaining?: number | null;
      };
      if (!response.ok) {
        setLockedUntil(data.lockedUntil ?? null);
        const remaining =
          typeof data.attemptsRemaining === "number" && data.attemptsRemaining > 0
            ? ` ${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? "" : "s"} left before the account locks.`
            : "";
        throw new Error(`${data.message ?? "That code was not right."}${remaining}`);
      }
      // A full navigation rather than a router push: the gate that refused this
      // page is server-side, so the page has to be fetched again to pass it.
      window.location.assign("/command-center");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code was not right.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const lockedMessage = lockedUntil
    ? `Locked until ${new Date(lockedUntil).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}.`
    : "";

  return (
    <main className="security-page">
      <form className="security-card" onSubmit={submit}>
        <span className="security-kicker">CLINIC OS</span>
        <h1>Enter your two-step code.</h1>
        <p className="security-lede">
          Signed in as <strong>{email}</strong>. Open your authenticator app and type
          the six-digit code. You will not be asked again on this device for about{" "}
          {sessionHours} hours.
        </p>

        {error && (
          <p className="security-message security-message--error" role="alert">
            {error} {lockedMessage}
          </p>
        )}

        <div className="security-field">
          <label htmlFor="mfa-code">Six-digit code, or a recovery code</label>
          <input
            id="mfa-code"
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            // `one-time-code` lets iOS and Android offer the code from the
            // notification, which removes the app-switch entirely.
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            required
            maxLength={24}
            aria-describedby="mfa-help"
          />
        </div>

        <div className="security-actions">
          <button type="submit" className="security-primary" disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </div>

        <p className="security-note" id="mfa-help">
          Lost your phone? Use one of the recovery codes you saved when you set this
          up. If you have neither, an owner can reset two-step sign-in for you from
          the Security page.
        </p>

        <div className="security-footer">
          <Link href="/command-center/security">Security settings</Link>
          <Link href="/">Back to the site</Link>
        </div>
      </form>
    </main>
  );
}
