"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import "../security.css";

/**
 * Two-step sign-in, and — for an owner — the staff directory.
 *
 * Two jobs on one page because they are the same conversation: "who can open
 * this dashboard, and what has to be true before they can". Splitting them would
 * mean an owner adding a colleague on one screen and wondering on another why
 * that colleague still cannot get in.
 */

type MfaState = {
  email: string;
  displayName: string;
  roles: string[];
  breakGlass: boolean;
  enrolled: boolean;
  pending: boolean;
  confirmedAt: string | null;
  recoveryCodesRemaining: number;
  lockedUntil: string | null;
  sessionHours: number;
  /** Whether this account has claimed a password of its own. */
  hasPassword: boolean;
  sessions: Array<{
    id: string;
    device: string | null;
    issuedAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }>;
  configured: { encryptionKey: boolean; sessionSecret: boolean };
  /** False only where enrolment genuinely cannot succeed — production, no keys. */
  canEnrol: boolean;
};

type StaffMember = {
  email: string;
  displayName: string;
  active: boolean;
  roles: string[];
  mfaEnrolled: boolean;
  mfaPending: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  recoveryCodesRemaining: number;
  lastSeenAt: string | null;
};

type RoleOption = { id: string; label: string; detail: string };

type Directory = {
  staff: StaffMember[];
  roles: RoleOption[];
  activeOwners: number;
  canManage: boolean;
  me: string;
};

/** Groups of four, so a 32-character secret can be typed without losing place. */
function grouped(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ");
}

function when(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

export default function SecurityCenter({ canSeeDirectory }: { canSeeDirectory: boolean }) {
  const [state, setState] = useState<MfaState | null>(null);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  /** Enrolment in progress: the secret is only ever held here, never re-fetched. */
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [resetCode, setResetCode] = useState("");

  /** Password change for this account, and a temporary one issued to another. */
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [issuedPassword, setIssuedPassword] = useState<{ email: string; password: string } | null>(
    null,
  );

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRoles, setInviteRoles] = useState<string[]>(["receptionist"]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/clinic/mfa", { cache: "no-store" });
      const data = (await response.json()) as MfaState & { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Could not load your security settings.");
      setState(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load security settings.");
    }
  }, []);

  const loadDirectory = useCallback(async () => {
    if (!canSeeDirectory) return;
    try {
      const response = await fetch("/api/clinic/staff", { cache: "no-store" });
      if (!response.ok) return;
      setDirectory((await response.json()) as Directory);
    } catch {
      // The directory is a secondary panel; its absence must not hide enrolment.
    }
  }, [canSeeDirectory]);

  useEffect(() => {
    // Deferred so the first render commits before either fetch sets state,
    // matching how the dashboard kicks off its own initial load.
    const initial = window.setTimeout(() => {
      void load();
      void loadDirectory();
    }, 0);
    return () => window.clearTimeout(initial);
  }, [load, loadDirectory]);

  async function mfa(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/clinic/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = (await response.json()) as Record<string, unknown> & { message?: string };
      if (!response.ok) throw new Error(data.message ?? "That did not work.");
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function staffAction(action: string, body: Record<string, unknown>) {
    setBusy(`${action}:${String(body.email ?? "")}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/clinic/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = (await response.json()) as Directory & {
        message?: string;
        temporaryPassword?: string;
      };
      if (!response.ok) throw new Error(data.message ?? "That change did not save.");
      setDirectory((current) =>
        current ? { ...current, staff: data.staff, activeOwners: data.activeOwners } : current,
      );
      setNotice(data.message ?? "Saved.");
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change did not save.");
      return null;
    } finally {
      setBusy("");
    }
  }

  const unconfigured =
    state && (!state.configured.encryptionKey || !state.configured.sessionSecret);
  /**
   * Missing keys are worth saying out loud in both cases, but only one of them
   * stops the work: locally the fallback keys make enrolment succeed, and
   * disabling the button because of a warning would have made this page useless
   * on a developer's machine.
   */
  const blocked = Boolean(unconfigured) && state !== null && !state.canEnrol;

  return (
    <main className="security-page">
      <section className="security-card">
        <span className="security-kicker">CLINIC OS · SECURITY</span>
        <h1>Two-step sign-in</h1>
        <p className="security-lede">
          The dashboard shows patient names, phone numbers and clinical notes. A
          sign-in alone is one password away from all of it, so the clinic asks for a
          code from your phone as well.
        </p>

        {state && (
          <div className="security-status">
            <span
              className={`security-badge ${state.enrolled ? "security-badge--on" : "security-badge--off"}`}
            >
              {state.enrolled ? "Set up" : state.pending ? "Half set up" : "Not set up"}
            </span>
            <strong>{state.email}</strong>
            <span style={{ color: "var(--muted)" }}>
              {state.enrolled
                ? `Since ${when(state.confirmedAt)} · ${state.recoveryCodesRemaining} recovery code(s) left`
                : "No authenticator app is registered yet."}
            </span>
          </div>
        )}

        {unconfigured && (
          <p className="security-message security-message--error" role="alert">
            This deployment is missing <code>STAFF_MFA_KEY</code> or{" "}
            <code>STAFF_SESSION_SECRET</code>.{" "}
            {blocked
              ? "Two-step sign-in cannot be set up until both are configured in the Worker environment."
              : "Development fallback keys are in use, so anything set up here is only valid locally. Never carry this database into production."}
          </p>
        )}

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

        {/* ---------------- recovery codes, shown once ---------------- */}
        {recoveryCodes && (
          <>
            <h2>Save these recovery codes</h2>
            <p className="security-lede">
              Each one works once, in place of a code from your phone. This is the only
              time they are shown — print them or put them somewhere only staff can
              reach. Generating a new set replaces every code below.
            </p>
            <ul className="security-codes">
              {recoveryCodes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="security-actions">
              <button type="button" onClick={() => window.print()}>
                Print
              </button>
              <button
                type="button"
                className="security-primary"
                onClick={() => {
                  setRecoveryCodes(null);
                  void load();
                }}
              >
                I have saved them
              </button>
            </div>
          </>
        )}

        {/* ---------------- enrolment ---------------- */}
        {!recoveryCodes && state && !state.enrolled && (
          <>
            {!secret ? (
              <>
                <ol className="security-steps">
                  <li>
                    Install an authenticator app — <strong>Google Authenticator</strong>,{" "}
                    <strong>Microsoft Authenticator</strong> or <strong>Authy</strong> all
                    work.
                  </li>
                  <li>Press the button below to get your code.</li>
                  <li>Enter the six digits the app shows to finish.</li>
                </ol>
                <div className="security-actions">
                  <button
                    type="button"
                    className="security-primary"
                    disabled={busy === "enrol" || blocked}
                    onClick={async () => {
                      const data = await mfa("enrol");
                      if (data) {
                        setSecret({ secret: String(data.secret), uri: String(data.uri) });
                      }
                    }}
                  >
                    {busy === "enrol" ? "Preparing…" : "Set up two-step sign-in"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Add this to your authenticator app</h2>
                <p className="security-lede">
                  On the phone you are reading this on, the link below opens your
                  authenticator app directly. On a computer, add an account by hand and
                  type the key.
                </p>
                <p className="security-secret">{grouped(secret.secret)}</p>
                <div className="security-actions">
                  {/* Deliberately a plain link. The URI carries the secret, so it
                      must never be sent anywhere — only handed to a local app. */}
                  <a href={secret.uri}>Open in authenticator app</a>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(secret.secret);
                      setNotice("Key copied.");
                    }}
                  >
                    Copy key
                  </button>
                </div>

                <div className="security-field" style={{ marginTop: 18 }}>
                  <label htmlFor="confirm-code">Code from the app</label>
                  <input
                    id="confirm-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={8}
                  />
                </div>
                <div className="security-actions">
                  <button
                    type="button"
                    className="security-primary"
                    disabled={busy === "confirm" || code.trim().length < 6}
                    onClick={async () => {
                      const data = await mfa("confirm", { code });
                      if (data) {
                        setRecoveryCodes(data.recoveryCodes as string[]);
                        setSecret(null);
                        setCode("");
                      }
                    }}
                  >
                    {busy === "confirm" ? "Checking…" : "Finish setup"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSecret(null);
                      setCode("");
                    }}
                  >
                    Start again
                  </button>
                </div>
                <p className="security-note">
                  A QR code is not shown yet — the key is typed or handed straight to the
                  app instead. Scanning is a planned follow-up.
                </p>
              </>
            )}
          </>
        )}

        {/* ---------------- already enrolled ---------------- */}
        {!recoveryCodes && state?.enrolled && (
          <>
            <h2>Managing your second factor</h2>
            <div className="security-actions">
              <button
                type="button"
                disabled={busy === "recovery_codes"}
                onClick={async () => {
                  const data = await mfa("recovery_codes");
                  if (data) setRecoveryCodes(data.recoveryCodes as string[]);
                }}
              >
                {busy === "recovery_codes" ? "Generating…" : "New recovery codes"}
              </button>
              <button
                type="button"
                disabled={busy === "sign_out"}
                onClick={async () => {
                  if (await mfa("sign_out")) window.location.assign("/command-center");
                }}
              >
                Sign out of this device
              </button>
            </div>

            {/* --------- where this account is signed in --------- */}
            <h2 style={{ marginTop: 26 }}>Signed in on</h2>
            <p className="security-lede">
              Every device holding a valid two-step session. If you do not recognise
              one, end it — and if you are not sure, end all of them and sign in again.
            </p>
            {state.sessions.length === 0 ? (
              <p className="security-message">
                No active sessions recorded. Sessions established before this list
                existed still work; they will appear as they are used.
              </p>
            ) : (
              <div className="security-table-wrap">
                <table className="security-table">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Signed in</th>
                      <th>Last used</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          <strong>{session.device ?? "Unknown device"}</strong>
                          <small>Expires {when(session.expiresAt)}</small>
                        </td>
                        <td>{when(session.issuedAt)}</td>
                        <td>{when(session.lastSeenAt)}</td>
                        <td>
                          <div className="security-row-actions">
                            <button
                              type="button"
                              disabled={busy === "revoke_session"}
                              onClick={async () => {
                                const data = await mfa("revoke_session", {
                                  sessionId: session.id,
                                });
                                if (data) await load();
                              }}
                            >
                              End
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="security-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="security-danger"
                disabled={busy === "sign_out_all"}
                onClick={async () => {
                  // Bumps the epoch, so this ends every device including this one.
                  if (await mfa("sign_out_all")) window.location.assign("/command-center");
                }}
              >
                {busy === "sign_out_all" ? "Signing out…" : "Sign out of all devices"}
              </button>
            </div>

            <div className="security-field" style={{ marginTop: 22 }}>
              <label htmlFor="reset-code">
                Changing phone? Enter a current code to start again
              </label>
              <input
                id="reset-code"
                value={resetCode}
                onChange={(event) => setResetCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode="text"
                maxLength={24}
              />
            </div>
            <div className="security-actions">
              <button
                type="button"
                className="security-danger"
                disabled={busy === "reset" || resetCode.trim().length < 6}
                onClick={async () => {
                  if (await mfa("reset", { code: resetCode })) {
                    setResetCode("");
                    setNotice("Two-step sign-in was reset. Set it up again below.");
                    await load();
                  }
                }}
              >
                {busy === "reset" ? "Resetting…" : "Reset two-step sign-in"}
              </button>
            </div>
            <p className="security-note">
              A reset signs you out everywhere immediately, which is what you want if
              the phone was stolen rather than replaced.
            </p>
          </>
        )}

        {/* --------- this account's password --------- */}
        <h2 style={{ marginTop: 26 }}>Your password</h2>
        <p className="security-lede">
          {state?.hasPassword
            ? "Changing it signs you out of every device, including this one — which is the point."
            : "This account signs in through the hosting platform and has no password of its own yet. Setting one lets you sign in at /login directly."}
        </p>
        <div className="security-field">
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            className="security-field--text"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>
        <div className="security-field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            className="security-field--text"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>
        <div className="security-actions">
          <button
            type="button"
            className="security-primary"
            disabled={busy === "password" || !currentPassword || !newPassword}
            onClick={async () => {
              setBusy("password");
              setError("");
              setNotice("");
              try {
                const response = await fetch("/api/staff/password", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ currentPassword, newPassword }),
                });
                const data = (await response.json()) as { message?: string };
                if (!response.ok) throw new Error(data.message ?? "That change did not save.");
                // The epoch moved, so this browser is already signed out.
                window.location.assign("/login");
              } catch (caught) {
                setError(
                  caught instanceof Error ? caught.message : "That change did not save.",
                );
                setCurrentPassword("");
                setNewPassword("");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "password" ? "Saving…" : "Change password"}
          </button>
        </div>
        <p className="security-note">
          Length matters more than symbols: a short phrase you will remember beats
          something clever you will write down. Twelve characters minimum.
        </p>

        <div className="security-footer">
          <Link href="/command-center">Back to the dashboard</Link>
        </div>
      </section>

      {/* ---------------- staff directory ---------------- */}
      {directory && (
        <section className="security-card security-card--wide">
          <span className="security-kicker">STAFF &amp; ACCESS</span>
          <h1>Who can open Clinic OS</h1>
          <p className="security-lede">
            {directory.canManage
              ? "Roles decide what each person sees. Give the least that lets them do their job — it is the difference between one account being phished and the whole register walking out."
              : "Roles decide what each person sees. Only an owner can change them."}
          </p>

          {issuedPassword && (
            <div className="security-message security-message--ok" role="status">
              <strong>Temporary password for {issuedPassword.email}</strong>
              <p className="security-secret" style={{ margin: "10px 0 8px" }}>
                {issuedPassword.password}
              </p>
              <p style={{ margin: 0 }}>
                Read it out once. It is shown only now, and they must choose their own
                the first time they sign in. Every session they had has ended.
              </p>
              <div className="security-actions" style={{ marginTop: 10 }}>
                <button type="button" onClick={() => setIssuedPassword(null)}>
                  Done
                </button>
              </div>
            </div>
          )}

          <div className="security-table-wrap">
            <table className="security-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Roles</th>
                  <th>Two-step</th>
                  <th>Last seen</th>
                  {directory.canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {directory.staff.map((member) => (
                  <tr key={member.email} className={member.active ? undefined : "is-inactive"}>
                    <td>
                      <strong>{member.displayName}</strong>
                      <small>{member.email}</small>
                      {!member.active && (
                        <span className="security-inactive-tag">Deactivated</span>
                      )}
                    </td>
                    <td>
                      {directory.canManage ? (
                        <div className="security-roles">
                          {directory.roles.map((role) => (
                            <label key={role.id} title={role.detail}>
                              <input
                                type="checkbox"
                                checked={member.roles.includes(role.id)}
                                disabled={busy.startsWith("roles:")}
                                onChange={(event) => {
                                  const next = event.target.checked
                                    ? [...member.roles, role.id]
                                    : member.roles.filter((item) => item !== role.id);
                                  void staffAction("roles", {
                                    email: member.email,
                                    roles: next,
                                  });
                                }}
                              />
                              {role.label}
                            </label>
                          ))}
                        </div>
                      ) : (
                        directory.roles
                          .filter((role) => member.roles.includes(role.id))
                          .map((role) => role.label)
                          .join(", ") || "No role"
                      )}
                    </td>
                    <td>
                      {member.mfaEnrolled
                        ? `Set up · ${member.recoveryCodesRemaining} code(s) left`
                        : member.mfaPending
                          ? "Half set up"
                          : "Not set up"}
                      <small>
                        {member.mustChangePassword
                          ? "Temporary password"
                          : member.hasPassword
                            ? "Password set"
                            : "No password"}
                      </small>
                    </td>
                    <td>{when(member.lastSeenAt)}</td>
                    {directory.canManage && (
                      <td>
                        <div className="security-row-actions">
                          <button
                            type="button"
                            disabled={busy === `active:${member.email}`}
                            onClick={() =>
                              void staffAction("active", {
                                email: member.email,
                                active: !member.active,
                              })
                            }
                          >
                            {member.active ? "Deactivate" : "Reactivate"}
                          </button>
                          {member.email !== directory.me && member.mfaEnrolled && (
                            <button
                              type="button"
                              disabled={busy === `reset_mfa:${member.email}`}
                              onClick={() =>
                                void staffAction("reset_mfa", { email: member.email })
                              }
                              title="For a lost or stolen phone. Signs them out everywhere."
                            >
                              Reset two-step
                            </button>
                          )}
                          {member.email !== directory.me && member.active && (
                            <button
                              type="button"
                              disabled={busy === `reset_password:${member.email}`}
                              title="Issues a temporary password to read out. They must change it."
                              onClick={async () => {
                                const data = await staffAction("reset_password", {
                                  email: member.email,
                                });
                                if (data?.temporaryPassword) {
                                  setIssuedPassword({
                                    email: member.email,
                                    password: String(data.temporaryPassword),
                                  });
                                }
                              }}
                            >
                              Issue password
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {directory.staff.length === 0 && (
                  <tr>
                    <td colSpan={directory.canManage ? 5 : 4}>
                      Nobody is in the directory yet. Whoever is named in{" "}
                      <code>STAFF_EMAILS</code> is added the first time they set up
                      two-step sign-in.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {directory.canManage && (
            <div className="security-invite">
              <h2>Add a colleague</h2>
              <div className="security-invite-fields">
                <input
                  placeholder="name@drashrafmetwally.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  aria-label="Staff email address"
                  type="email"
                />
                <input
                  placeholder="Full name"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  aria-label="Staff name"
                />
              </div>
              <div className="security-roles">
                {directory.roles.map((role) => (
                  <label key={role.id} title={role.detail}>
                    <input
                      type="checkbox"
                      checked={inviteRoles.includes(role.id)}
                      onChange={(event) =>
                        setInviteRoles((current) =>
                          event.target.checked
                            ? [...current, role.id]
                            : current.filter((item) => item !== role.id),
                        )
                      }
                    />
                    {role.label}
                  </label>
                ))}
              </div>
              <div className="security-actions">
                <button
                  type="button"
                  className="security-primary"
                  disabled={
                    busy.startsWith("invite") ||
                    !inviteEmail.includes("@") ||
                    !inviteName.trim() ||
                    inviteRoles.length === 0
                  }
                  onClick={async () => {
                    await staffAction("invite", {
                      email: inviteEmail,
                      displayName: inviteName,
                      roles: inviteRoles,
                    });
                    setInviteEmail("");
                    setInviteName("");
                    setInviteRoles(["receptionist"]);
                  }}
                >
                  Add to the directory
                </button>
              </div>
              <p className="security-note">
                They still sign in through the platform with their own account, then set
                up two-step themselves. Adding them here decides what they can do once
                they are in — it does not create a password.
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
