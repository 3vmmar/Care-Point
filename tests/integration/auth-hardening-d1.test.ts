import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  MAX_CLIENT_ATTEMPTS,
  THROTTLE_BLOCK_MINUTES,
  THROTTLE_WINDOW_MINUTES,
  checkAuthThrottle,
  clearAuthThrottle,
  describeDevice,
  ensureStaffSchema,
  getStaffRecord,
  isSessionRevoked,
  listStaffSessions,
  purgeExpiredStaffSessions,
  purgeExpiredThrottles,
  recordAuthFailure,
  recordStaffSession,
  revokeAllStaffSessions,
  revokeStaffSession,
  touchStaffSession,
  upsertStaffMember,
} from "@/db/staff";

/**
 * The two holes the last pass left open, now closed and checked against real D1.
 *
 * Both were named honestly at the time rather than quietly skipped: an attacker
 * with a list of staff addresses still got five guesses each, and staff could hold
 * sessions on any number of devices with no way to see or end them.
 */

const OWNER = "owner@drashrafmetwally.com";
const RECEPTION = "reception@drashrafmetwally.com";
const CLIENT = "client-hash-abc";

beforeEach(async () => {
  await ensureStaffSchema();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_throttle"),
    env.DB.prepare("DELETE FROM staff_sessions"),
    env.DB.prepare("DELETE FROM security_events"),
    env.DB.prepare("DELETE FROM staff_user_roles"),
    env.DB.prepare("DELETE FROM staff_users"),
  ]);
});

describe("per-client throttle", () => {
  it("allows a fresh client its full budget", async () => {
    const decision = await checkAuthThrottle(CLIENT);
    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.remaining).toBe(MAX_CLIENT_ATTEMPTS);
  });

  it("blocks a client that spends its budget across many accounts", async () => {
    // The attack the per-account lockout does not see: five guesses each against
    // twenty different colleagues is twenty accounts probed and no account locked.
    for (let attempt = 1; attempt < MAX_CLIENT_ATTEMPTS; attempt += 1) {
      const outcome = await recordAuthFailure(CLIENT);
      expect(outcome.allowed, `attempt ${attempt}`).toBe(true);
      expect(outcome.allowed && outcome.remaining).toBe(MAX_CLIENT_ATTEMPTS - attempt);
    }

    const blocked = await recordAuthFailure(CLIENT);
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.retryAfterSeconds).toBe(
      THROTTLE_BLOCK_MINUTES * 60,
    );

    // And the block is what the *next* request sees, not just the one that tripped it.
    const next = await checkAuthThrottle(CLIENT);
    expect(next.allowed).toBe(false);
  });

  it("keeps one client's budget separate from another's", async () => {
    for (let attempt = 0; attempt < MAX_CLIENT_ATTEMPTS; attempt += 1) {
      await recordAuthFailure(CLIENT);
    }
    expect((await checkAuthThrottle(CLIENT)).allowed).toBe(false);
    // A blocked attacker must not take the clinic's own reception desk down with it.
    expect((await checkAuthThrottle("a-different-client")).allowed).toBe(true);
  });

  it("forgets failures once the window has passed", async () => {
    const start = Date.now();
    await recordAuthFailure(CLIENT, { nowMs: start });
    await recordAuthFailure(CLIENT, { nowMs: start });

    const later = start + (THROTTLE_WINDOW_MINUTES + 1) * 60_000;
    const decision = await checkAuthThrottle(CLIENT, { nowMs: later });
    expect(decision.allowed && decision.remaining).toBe(MAX_CLIENT_ATTEMPTS);
  });

  it("lets a client back in once the block expires", async () => {
    const start = Date.now();
    for (let attempt = 0; attempt < MAX_CLIENT_ATTEMPTS; attempt += 1) {
      await recordAuthFailure(CLIENT, { nowMs: start });
    }
    expect((await checkAuthThrottle(CLIENT, { nowMs: start })).allowed).toBe(false);

    const after = start + (THROTTLE_BLOCK_MINUTES + 1) * 60_000;
    expect((await checkAuthThrottle(CLIENT, { nowMs: after })).allowed).toBe(true);
  });

  it("a success clears the counter", async () => {
    await recordAuthFailure(CLIENT);
    await recordAuthFailure(CLIENT);
    await clearAuthThrottle(CLIENT);
    // A receptionist who fumbled two codes should not still be carrying them at
    // the end of the shift.
    expect((await checkAuthThrottle(CLIENT)).allowed && true).toBe(true);
    const decision = await checkAuthThrottle(CLIENT);
    expect(decision.allowed && decision.remaining).toBe(MAX_CLIENT_ATTEMPTS);
  });

  it("fails open when there is no fingerprint to count against", async () => {
    // Refusing every request whose IP could not be hashed would lock the clinic
    // out of its own dashboard; the per-account lockout still applies.
    expect((await checkAuthThrottle(null)).allowed).toBe(true);
    expect((await recordAuthFailure(undefined)).allowed).toBe(true);
  });

  it("records a security event when a client is blocked", async () => {
    for (let attempt = 0; attempt < MAX_CLIENT_ATTEMPTS; attempt += 1) {
      await recordAuthFailure(CLIENT);
    }
    const events = await env.DB.prepare(
      "SELECT event, detail FROM security_events WHERE event = 'mfa_locked'",
    ).all<{ event: string; detail: string }>();
    expect(events.results?.length).toBeGreaterThan(0);
    expect(events.results?.[0].detail).toMatch(/across accounts/);
  });

  it("prunes counters whose window and block have both lapsed", async () => {
    await env.DB.prepare(
      "INSERT INTO auth_throttle (key, attempts, window_started_at) VALUES ('ancient', 3, '2020-01-01T00:00:00.000Z')",
    ).run();
    await recordAuthFailure(CLIENT);

    const purged = await purgeExpiredThrottles();
    expect(purged).toBe(1);
    // The live counter survives.
    expect((await checkAuthThrottle(CLIENT)).allowed && true).toBe(true);
  });
});

describe("device labels", () => {
  it("describes a device coarsely enough to recognise and not to fingerprint", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      ),
    ).toBe("Chrome on Windows");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1")).toBe(
      "Safari on iOS",
    );
    expect(describeDevice("Mozilla/5.0 (Macintosh) Firefox/121.0")).toBe("Firefox on macOS");
    expect(describeDevice(null)).toBe("Unknown device");
    // No version numbers, no build strings — nothing that narrows to one machine.
    expect(describeDevice("Chrome/120.0.6099.109 Windows NT 10.0")).not.toMatch(/120/);
  });
});

describe("active sessions", () => {
  async function seatStaff() {
    await upsertStaffMember({
      email: RECEPTION,
      displayName: "Nadia",
      roles: ["receptionist"],
      actor: OWNER,
    });
  }

  async function seat(id: string, device: string, expiresInMs = 3_600_000) {
    await recordStaffSession({
      id,
      email: RECEPTION,
      tokenDigest: `digest-${id}`,
      device,
      clientHash: CLIENT,
      expiresAtMs: Date.now() + expiresInMs,
    });
  }

  beforeEach(seatStaff);

  it("lists the devices a staff member is signed in on", async () => {
    await seat("s1", "Chrome on Windows");
    await seat("s2", "Safari on iOS");

    const sessions = await listStaffSessions(RECEPTION);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.device).sort()).toEqual([
      "Chrome on Windows",
      "Safari on iOS",
    ]);
  });

  it("never stores anything that could be replayed as a session", async () => {
    await seat("s1", "Chrome on Windows");
    const row = await env.DB.prepare(
      "SELECT token_digest AS digest FROM staff_sessions WHERE id = 's1'",
    ).first<{ digest: string }>();
    // A list of sessions, not a set of spare keys to them.
    expect(row?.digest).toBe("digest-s1");
    const listed = await listStaffSessions(RECEPTION);
    expect(JSON.stringify(listed)).not.toContain("digest");
  });

  it("ending one device leaves the others alone", async () => {
    await seat("s1", "Chrome on Windows");
    await seat("s2", "Safari on iOS");

    expect(await revokeStaffSession({ id: "s1", email: RECEPTION, actor: RECEPTION })).toBe(
      true,
    );
    expect(await isSessionRevoked("s1")).toBe(true);
    expect(await isSessionRevoked("s2")).toBe(false);

    const remaining = await listStaffSessions(RECEPTION);
    expect(remaining.map((session) => session.id)).toEqual(["s2"]);
  });

  it("cannot end a session belonging to somebody else", async () => {
    await seat("s1", "Chrome on Windows");
    // The email is part of the predicate, so a guessed id from another account
    // matches nothing.
    expect(
      await revokeStaffSession({ id: "s1", email: "someone@else.com", actor: "someone@else.com" }),
    ).toBe(false);
    expect(await isSessionRevoked("s1")).toBe(false);
  });

  it("ending a session twice is not an error the second time", async () => {
    await seat("s1", "Chrome on Windows");
    expect(await revokeStaffSession({ id: "s1", email: RECEPTION, actor: RECEPTION })).toBe(true);
    expect(await revokeStaffSession({ id: "s1", email: RECEPTION, actor: RECEPTION })).toBe(false);
  });

  it("signing out everywhere bumps the epoch, which is what actually revokes", async () => {
    await seat("s1", "Chrome on Windows");
    await seat("s2", "Safari on iOS");
    const before = await getStaffRecord(RECEPTION);

    await revokeAllStaffSessions({ email: RECEPTION, actor: RECEPTION });

    const after = await getStaffRecord(RECEPTION);
    // The epoch sits inside every token signature, so raising it invalidates all
    // of them without needing to find or trust any individual row.
    expect(after?.sessionEpoch).toBe((before?.sessionEpoch ?? 1) + 1);
    expect(await listStaffSessions(RECEPTION)).toHaveLength(0);
  });

  it("an unrecorded session is treated as live rather than refused", async () => {
    // A session issued before this table existed, or one whose insert failed. Its
    // signature, epoch and expiry have already been checked; refusing it would lock
    // people out over a missing audit row.
    expect(await isSessionRevoked("never-recorded")).toBe(false);
    expect(await isSessionRevoked("")).toBe(false);
  });

  it("using a session updates when it was last seen", async () => {
    await seat("s1", "Chrome on Windows");
    await env.DB.prepare(
      "UPDATE staff_sessions SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = 's1'",
    ).run();

    await touchStaffSession("s1");
    const [session] = await listStaffSessions(RECEPTION);
    expect(session.lastSeenAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("an expired session drops out of the list without being revoked", async () => {
    await seat("s1", "Chrome on Windows", -1_000);
    expect(await listStaffSessions(RECEPTION)).toHaveLength(0);
    // Expiry is enforced by the signature; the row is only bookkeeping.
    expect(await isSessionRevoked("s1")).toBe(false);
  });

  it("prunes long-expired session rows", async () => {
    await env.DB.prepare(
      `INSERT INTO staff_sessions
       (id, email, token_digest, issued_at, last_seen_at, expires_at)
       VALUES ('ancient', ?, 'd', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z')`,
    )
      .bind(RECEPTION)
      .run();
    await seat("s1", "Chrome on Windows");

    expect(await purgeExpiredStaffSessions()).toBe(1);
    expect((await listStaffSessions(RECEPTION)).map((s) => s.id)).toEqual(["s1"]);
  });

  it("records who ended a session", async () => {
    await seat("s1", "Chrome on Windows");
    await revokeStaffSession({ id: "s1", email: RECEPTION, actor: OWNER });
    const event = await env.DB.prepare(
      "SELECT actor, subject FROM security_events WHERE event = 'session_revoked'",
    ).first<{ actor: string; subject: string }>();
    expect(event?.actor).toBe(OWNER);
    expect(event?.subject).toBe(RECEPTION);
  });
});
