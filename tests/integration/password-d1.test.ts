import { beforeEach, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import {
  MAX_FAILED_ATTEMPTS,
  getStaffRecord,
  listStaffSessions,
  recordStaffSession,
  setStaffPassword,
  upsertStaffMember,
  verifyStaffPassword,
} from "@/db/staff";
import { generateTemporaryPassword } from "@/lib/password";

/**
 * Staff passwords against real D1.
 *
 * This is the credential the clinic now owns, so the properties that matter are
 * about what an attacker learns and what a stolen session survives — not merely
 * that the happy path works.
 */

const OWNER = "owner@drashrafmetwally.com";
const RECEPTION = "reception@drashrafmetwally.com";
const PASSWORD = "clinic mornings in maadi";

beforeEach(async () => {
  await database().batch([
    database().prepare("DELETE FROM staff_sessions"),
    database().prepare("DELETE FROM security_events"),
    database().prepare("DELETE FROM auth_throttle"),
    database().prepare("DELETE FROM staff_user_roles"),
    database().prepare("DELETE FROM staff_users"),
  ]);
  await upsertStaffMember({
    email: RECEPTION,
    displayName: "Nadia",
    roles: ["receptionist"],
    actor: OWNER,
  });
});

describe("setting a password", () => {
  it("stores a hash, never the password", async () => {
    await setStaffPassword({ email: RECEPTION, password: PASSWORD, actor: RECEPTION });

    const row = await database().prepare(
      "SELECT password_hash AS hash FROM staff_users WHERE email = ?",
    )
      .bind(RECEPTION)
      .first<{ hash: string }>();

    expect(row?.hash).toBeTruthy();
    expect(row!.hash).not.toContain(PASSWORD);
    expect(row!.hash.startsWith("pbkdf2-sha256$")).toBe(true);
  });

  it("never exposes the hash through the record the app reads", async () => {
    await setStaffPassword({ email: RECEPTION, password: PASSWORD, actor: RECEPTION });
    const record = await getStaffRecord(RECEPTION);
    // The dashboard needs to know a password exists, not what it is.
    expect(record?.hasPassword).toBe(true);
    expect(JSON.stringify(record)).not.toContain("pbkdf2");
    expect(JSON.stringify(record)).not.toContain(PASSWORD);
  });

  it("refuses a password that fails the strength rules", async () => {
    await expect(
      setStaffPassword({ email: RECEPTION, password: "short", actor: RECEPTION }),
    ).rejects.toThrow(/at least 12 characters/i);
    await expect(
      setStaffPassword({ email: RECEPTION, password: "password123", actor: RECEPTION }),
    ).rejects.toThrow(/breached/i);
    expect((await getStaffRecord(RECEPTION))?.hasPassword).toBe(false);
  });

  it("refuses to set a password on an unknown or inactive account", async () => {
    await expect(
      setStaffPassword({ email: "ghost@example.com", password: PASSWORD, actor: OWNER }),
    ).rejects.toThrow(/not in the directory/i);
  });

  it("ends every existing session, which is the point of changing it", async () => {
    await recordStaffSession({
      id: "s1",
      email: RECEPTION,
      tokenDigest: "digest",
      device: "Chrome on Windows",
      expiresAtMs: Date.now() + 3_600_000,
    });
    const before = await getStaffRecord(RECEPTION);
    expect(await listStaffSessions(RECEPTION)).toHaveLength(1);

    await setStaffPassword({ email: RECEPTION, password: PASSWORD, actor: RECEPTION });

    // Whoever prompted the change may be holding a live session; leaving theirs
    // running would make the new password cosmetic.
    const after = await getStaffRecord(RECEPTION);
    expect(after?.sessionEpoch).toBe((before?.sessionEpoch ?? 1) + 1);
    expect(await listStaffSessions(RECEPTION)).toHaveLength(0);
  });
});

describe("checking a password", () => {
  beforeEach(async () => {
    await setStaffPassword({ email: RECEPTION, password: PASSWORD, actor: RECEPTION });
  });

  it("accepts the right password", async () => {
    const outcome = await verifyStaffPassword({ email: RECEPTION, password: PASSWORD });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.record.email).toBe(RECEPTION);
    expect(outcome.ok && outcome.mustChangePassword).toBe(false);
  });

  it("is case-insensitive about the email and exact about the password", async () => {
    expect((await verifyStaffPassword({ email: "RECEPTION@DrAshrafMetwally.com", password: PASSWORD })).ok).toBe(true);
    expect((await verifyStaffPassword({ email: RECEPTION, password: PASSWORD.toUpperCase() })).ok).toBe(false);
  });

  it("does not reveal whether an address exists here", async () => {
    // The whole point: staff addresses are on the practice website, so the only
    // thing left to discover is which of them are real accounts.
    const unknown = await verifyStaffPassword({
      email: "definitely-not-staff@example.com",
      password: PASSWORD,
    });
    const wrong = await verifyStaffPassword({ email: RECEPTION, password: "wrong password" });
    expect(unknown.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    // Different internal reasons, and the route maps both onto one message —
    // asserted in the E2E spec, where the response is what matters.
    expect(unknown.ok === false && unknown.reason).toBe("unknown");
    expect(wrong.ok === false && wrong.reason).toBe("wrong-password");
  });

  it("costs comparable time whether or not the account exists", async () => {
    const time = async (email: string) => {
      const started = Date.now();
      await verifyStaffPassword({ email, password: "some candidate password" });
      return Date.now() - started;
    };
    // Warm the lazily-derived placeholder hash first, or the first call pays for it.
    await time("warm-up@example.com");

    const absent = await time("nobody@example.com");
    const present = await time(RECEPTION);
    // Both do a real derivation, so neither is an order of magnitude faster.
    expect(absent).toBeGreaterThan(10);
    expect(Math.max(absent, present) / Math.max(1, Math.min(absent, present))).toBeLessThan(6);
  });

  it("locks the account after the same number of failures as a wrong code", async () => {
    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      const outcome = await verifyStaffPassword({ email: RECEPTION, password: "nope nope nope" });
      expect(outcome.ok === false && outcome.reason).toBe("wrong-password");
    }
    const locked = await verifyStaffPassword({ email: RECEPTION, password: "nope nope nope" });
    expect(locked.ok === false && locked.reason).toBe("locked");

    // And the right password is refused while the lock stands, or the limit only
    // slows an attacker down between guesses.
    const correct = await verifyStaffPassword({ email: RECEPTION, password: PASSWORD });
    expect(correct.ok).toBe(false);
    expect(correct.ok === false && correct.reason).toBe("locked");
  });

  it("a correct password clears the failure count", async () => {
    await verifyStaffPassword({ email: RECEPTION, password: "wrong one" });
    await verifyStaffPassword({ email: RECEPTION, password: "wrong two" });
    expect((await getStaffRecord(RECEPTION))?.failedAttempts).toBe(2);

    expect((await verifyStaffPassword({ email: RECEPTION, password: PASSWORD })).ok).toBe(true);
    expect((await getStaffRecord(RECEPTION))?.failedAttempts).toBe(0);
  });

  it("refuses an account with no password rather than letting anything through", async () => {
    await upsertStaffMember({
      email: "nopassword@drashrafmetwally.com",
      displayName: "No password",
      roles: ["auditor"],
      actor: OWNER,
    });
    const outcome = await verifyStaffPassword({
      email: "nopassword@drashrafmetwally.com",
      password: "",
    });
    expect(outcome.ok).toBe(false);
    // An empty password must never satisfy an empty hash.
    expect(outcome.ok === false && outcome.reason).toBe("no-password");
  });

  it("refuses a deactivated colleague who still knows their password", async () => {
    await upsertStaffMember({ email: OWNER, displayName: "A", roles: ["owner"], actor: OWNER });
    const { setStaffActive } = await import("@/db/staff");
    await setStaffActive({ email: RECEPTION, active: false, actor: OWNER });

    const outcome = await verifyStaffPassword({ email: RECEPTION, password: PASSWORD });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe("inactive");
  });

  it("records the attempt either way", async () => {
    await verifyStaffPassword({ email: RECEPTION, password: PASSWORD });
    await verifyStaffPassword({ email: RECEPTION, password: "wrong" });

    const events = await database().prepare(
      "SELECT event FROM security_events WHERE actor = ?",
    )
      .bind(RECEPTION)
      .all<{ event: string }>();
    const names = (events.results ?? []).map((row) => row.event);
    expect(names).toContain("password_verified");
    expect(names).toContain("password_failed");
  });

  it("records a failed attempt against an address that does not exist", async () => {
    await verifyStaffPassword({ email: "prober@example.com", password: "guess" });
    const event = await database().prepare(
      "SELECT detail FROM security_events WHERE actor = 'prober@example.com'",
    ).first<{ detail: string }>();
    // Enumeration attempts are the earliest signal of an attack, and the only one
    // available before anybody gets in.
    expect(event?.detail).toMatch(/no such account/i);
  });
});

describe("temporary passwords", () => {
  it("forces the holder to choose their own", async () => {
    const temporary = generateTemporaryPassword();
    await setStaffPassword({
      email: RECEPTION,
      password: temporary,
      actor: OWNER,
      temporary: true,
    });

    const outcome = await verifyStaffPassword({ email: RECEPTION, password: temporary });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.mustChangePassword).toBe(true);
    expect((await getStaffRecord(RECEPTION))?.mustChangePassword).toBe(true);
  });

  it("choosing a real one clears the requirement", async () => {
    await setStaffPassword({
      email: RECEPTION,
      password: generateTemporaryPassword(),
      actor: OWNER,
      temporary: true,
    });
    await setStaffPassword({ email: RECEPTION, password: PASSWORD, actor: RECEPTION });

    const record = await getStaffRecord(RECEPTION);
    expect(record?.mustChangePassword).toBe(false);
    expect((await verifyStaffPassword({ email: RECEPTION, password: PASSWORD })).ok).toBe(true);
  });

  it("replacing a password invalidates the previous one", async () => {
    await setStaffPassword({ email: RECEPTION, password: PASSWORD, actor: RECEPTION });
    await setStaffPassword({
      email: RECEPTION,
      password: "a different clinic phrase",
      actor: RECEPTION,
    });
    expect((await verifyStaffPassword({ email: RECEPTION, password: PASSWORD })).ok).toBe(false);
  });

  it("records who issued it and who chose it", async () => {
    await setStaffPassword({
      email: RECEPTION,
      password: generateTemporaryPassword(),
      actor: OWNER,
      temporary: true,
    });
    await setStaffPassword({ email: RECEPTION, password: PASSWORD, actor: RECEPTION });

    const events = await database().prepare(
      "SELECT event, actor, detail FROM security_events WHERE event IN ('password_reset','password_changed') ORDER BY at",
    ).all<{ event: string; actor: string; detail: string }>();
    const rows = events.results ?? [];
    expect(rows.find((row) => row.event === "password_reset")?.actor).toBe(OWNER);
    expect(rows.find((row) => row.event === "password_changed")?.actor).toBe(RECEPTION);
    expect(rows.find((row) => row.event === "password_changed")?.detail).toMatch(
      /account holder/i,
    );
  });
});
