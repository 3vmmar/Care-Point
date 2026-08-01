"use client";

import { useState } from "react";
import Link from "next/link";
import "../command-center/security.css";

/**
 * Staff sign-in, on the practice's own website.
 *
 * Deliberately plain and deliberately quiet about failures. The one message for
 * every credential problem is not laziness: staff addresses are published on the
 * practice site, so distinguishing "no such account" from "wrong password" would
 * turn this form into a tool for working out which of them are real.
 */
export default function LoginForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  /** Shown only when a deployment still has a setup token configured. */
  const [showSetup, setShowSetup] = useState(false);
  const [setupToken, setSetupToken] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(showSetup && setupToken ? { setupToken } : {}),
        }),
      });
      const data = (await response.json()) as {
        message?: string;
        next?: string;
        claimed?: boolean;
        retryAfterSeconds?: number;
      };
      if (!response.ok) {
        const wait =
          typeof data.retryAfterSeconds === "number"
            ? ` Try again in about ${Math.ceil(data.retryAfterSeconds / 60)} minute(s).`
            : "";
        throw new Error(`${data.message ?? "Sign-in failed."}${wait}`);
      }

      if (data.claimed) {
        // The password was just created. Sign in with it rather than assuming.
        setNotice(data.message ?? "Password set. Sign in with it now.");
        setPassword("");
        setShowSetup(false);
        return;
      }

      // A full navigation, not a router push: the destination is gated on the
      // server, so it has to be fetched fresh with the new cookie attached.
      window.location.assign(data.next ?? nextPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="security-page">
      <form className="security-card" onSubmit={submit}>
        <span className="security-kicker">CLINIC OS</span>
        <h1>Staff sign-in</h1>
        <p className="security-lede">
          For clinic staff only. If you are a patient looking to book or change an
          appointment, everything you need is on the{" "}
          <Link href="/">main site</Link> — you do not need an account.
        </p>

        {error && (
          <p className="security-message security-message--error" role="alert">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="security-message security-message--ok" role="status">
            {notice}
          </p>
        )}

        <div className="security-field">
          <label htmlFor="staff-email">Email</label>
          <input
            id="staff-email"
            className="security-field--text"
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
          />
        </div>

        <div className="security-field">
          <label htmlFor="staff-password">Password</label>
          <input
            id="staff-password"
            className="security-field--text"
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {showSetup && (
          <div className="security-field">
            <label htmlFor="setup-token">First-run setup token</label>
            <input
              id="setup-token"
              className="security-field--text"
              type="password"
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
              autoComplete="off"
            />
          </div>
        )}

        <div className="security-actions">
          <button
            type="submit"
            className="security-primary"
            disabled={busy || !email.trim() || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>

        <p className="security-note">
          Forgotten your password? An owner can issue you a temporary one from the
          Security page — passwords cannot be reset by email, because the practice
          does not send them.
        </p>

        {!showSetup && (
          <p className="security-note">
            <button
              type="button"
              onClick={() => setShowSetup(true)}
              style={{
                background: "none",
                border: 0,
                padding: 0,
                font: "inherit",
                color: "var(--burgundy)",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              Setting up the first owner account?
            </button>
          </p>
        )}

        <div className="security-footer">
          <Link href="/">Back to the site</Link>
        </div>
      </form>
    </main>
  );
}
