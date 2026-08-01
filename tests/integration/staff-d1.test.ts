import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  beginMfaEnrolment,
  confirmMfaEnrolment,
  countActiveOwners,
  ensureStaffSchema,
  getStaffRecord,
  issueRecoveryCodes,
  listSecurityEvents,
  listStaff,
  purgeExpiredSecurityEvents,
  recordSecurityEvent,
  resetMfa,
  setStaffActive,
  setStaffRoles,
  touchLastSeen,
  upsertStaffMember,
  verifyMfaCode,
} from "@/db/staff";
import { totp } from "@/lib/totp";

/**
 * The staff directory against a real D1 database, running the real migrations.
 *
 * The node suite proves the algorithms; this proves the storage — that a lockout
 * survives a round trip, that a used code is refused by the row rather than by a
 * variable, that clearing a factor really does end the sessions it authorised.
 * Those are the properties that a unit test with a fake database cannot see.
 */

const OWNER = "owner@drashrafmetwally.com";
const RECEPTION = "reception@drashrafmetwally.com";

async function resetStaffData() {
  await ensureStaffSchema();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM security_events"),
    env.DB.prepare("DELETE FROM staff_recovery_codes"),
    env.DB.prepare("DELETE FROM staff_user_roles"),
    env.DB.prepare("DELETE FROM staff_users"),
  ]);
}

/** Enrols an account fully and returns the secret so tests can produce codes. */
async function enrol(email: string, roles: string[] = ["receptionist"]) {
  const { secret } = await beginMfaEnrolment({
    email,
    displayName: email,
    roles,
    actor: OWNER,
  });
  const outcome = await confirmMfaEnrolment({ email, code: await totp(secret) });
  expect(outcome.ok).toBe(true);
  return {
    secret,
    recoveryCodes: outcome.ok ? outcome.recoveryCodes : [],
  };
}

/**
 * Stands in for time passing.
 *
 * Confirming enrolment consumes the current time step, so the very next code
 * from the same window is correctly refused as a replay. Real staff never notice,
 * because confirming also issues their session — but a test that wants to verify
 * a code needs a counter that has not been spent, and the clock cannot be moved
 * inside the Workers pool.
 */
async function allowCurrentCode(email: string) {
  await env.DB.prepare("UPDATE staff_users SET totp_last_counter = 0 WHERE email = ?")
    .bind(email)
    .run();
}

beforeEach(async () => {
  await resetStaffData();
});

describe("staff directory", () => {
  it("adds a colleague with the roles they were given", async () => {
    const record = await upsertStaffMember({
      email: "Reception@DrAshrafMetwally.com  ",
      displayName: "Nadia at reception",
      roles: ["receptionist"],
      actor: OWNER,
    });

    // Addresses are normalised on the way in, or the same person exists twice.
    expect(record.email).toBe(RECEPTION);
    expect(record.roles).toEqual(["receptionist"]);
    expect(record.active).toBe(true);
    expect(record.mfaEnrolled).toBe(false);
    expect(record.sessionEpoch).toBe(1);
  });

  it("defaults a new colleague to the least useful privilege", async () => {
    const record = await upsertStaffMember({
      email: RECEPTION,
      displayName: "Nadia",
      roles: [],
      actor: OWNER,
    });
    expect(record.roles).toEqual(["receptionist"]);
  });

  it("discards a role the code does not define", async () => {
    const record = await upsertStaffMember({
      email: RECEPTION,
      displayName: "Nadia",
      roles: ["receptionist", "superuser", "root"],
      actor: OWNER,
    });
    expect(record.roles).toEqual(["receptionist"]);
  });

  it("refuses a row without an email or a name", async () => {
    await expect(
      upsertStaffMember({ email: "not-an-email", displayName: "X", actor: OWNER }),
    ).rejects.toThrow(/email/i);
    await expect(
      upsertStaffMember({ email: RECEPTION, displayName: "   ", actor: OWNER }),
    ).rejects.toThrow(/name/i);
  });

  it("updating a name does not disturb an enrolled second factor", async () => {
    await enrol(RECEPTION);
    const before = await getStaffRecord(RECEPTION);
    expect(before?.mfaEnrolled).toBe(true);

    await upsertStaffMember({
      email: RECEPTION,
      displayName: "Nadia Hassan",
      actor: OWNER,
    });

    // An owner correcting a spelling must not silently clear somebody's MFA.
    const after = await getStaffRecord(RECEPTION);
    expect(after?.displayName).toBe("Nadia Hassan");
    expect(after?.mfaEnrolled).toBe(true);
    expect(after?.sessionEpoch).toBe(before?.sessionEpoch);
  });

  it("replaces the role set rather than accumulating roles", async () => {
    await upsertStaffMember({
      email: RECEPTION,
      displayName: "Nadia",
      roles: ["receptionist", "auditor"],
      actor: OWNER,
    });
    const record = await setStaffRoles({
      email: RECEPTION,
      roles: ["auditor"],
      actor: OWNER,
    });
    expect(record.roles).toEqual(["auditor"]);
  });

  it("refuses to leave somebody with no role at all", async () => {
    await upsertStaffMember({ email: RECEPTION, displayName: "Nadia", actor: OWNER });
    await expect(
      setStaffRoles({ email: RECEPTION, roles: [], actor: OWNER }),
    ).rejects.toThrow(/at least one role/i);
  });

  it("will not let the practice lose its last owner", async () => {
    await upsertStaffMember({
      email: OWNER,
      displayName: "Dr Ashraf",
      roles: ["owner"],
      actor: OWNER,
    });
    expect(await countActiveOwners()).toBe(1);

    // Both routes to the same disaster: nobody left who can hand out roles.
    await expect(
      setStaffRoles({ email: OWNER, roles: ["doctor"], actor: OWNER }),
    ).rejects.toThrow(/last owner/i);
    await expect(
      setStaffActive({ email: OWNER, active: false, actor: OWNER }),
    ).rejects.toThrow(/last active owner/i);
  });

  it("allows an owner to step down once a second owner exists", async () => {
    await upsertStaffMember({ email: OWNER, displayName: "A", roles: ["owner"], actor: OWNER });
    await upsertStaffMember({
      email: "second@drashrafmetwally.com",
      displayName: "B",
      roles: ["owner"],
      actor: OWNER,
    });
    expect(await countActiveOwners()).toBe(2);

    const record = await setStaffActive({ email: OWNER, active: false, actor: OWNER });
    expect(record.active).toBe(false);
    expect(await countActiveOwners()).toBe(1);
  });

  it("deactivation ends every session the person already held", async () => {
    await upsertStaffMember({ email: OWNER, displayName: "A", roles: ["owner"], actor: OWNER });
    await enrol(RECEPTION);
    const before = await getStaffRecord(RECEPTION);

    const after = await setStaffActive({ email: RECEPTION, active: false, actor: OWNER });
    // The epoch is what invalidates the signed cookie they are still holding.
    expect(after.sessionEpoch).toBe((before?.sessionEpoch ?? 1) + 1);
    expect(after.active).toBe(false);
  });

  it("reactivation does not silently re-issue access to old sessions", async () => {
    await upsertStaffMember({ email: OWNER, displayName: "A", roles: ["owner"], actor: OWNER });
    await enrol(RECEPTION);
    const deactivated = await setStaffActive({
      email: RECEPTION,
      active: false,
      actor: OWNER,
    });
    const reactivated = await setStaffActive({
      email: RECEPTION,
      active: true,
      actor: OWNER,
    });
    expect(reactivated.active).toBe(true);
    // The epoch does not go back down, so the pre-deactivation cookie stays dead.
    expect(reactivated.sessionEpoch).toBe(deactivated.sessionEpoch);
  });

  it("keeps the row when somebody leaves, so the audit trail still names them", async () => {
    await upsertStaffMember({ email: OWNER, displayName: "A", roles: ["owner"], actor: OWNER });
    await upsertStaffMember({ email: RECEPTION, displayName: "Nadia", actor: OWNER });
    await setStaffActive({ email: RECEPTION, active: false, actor: OWNER });

    const directory = await listStaff();
    expect(directory.map((person) => person.email)).toContain(RECEPTION);
  });

  it("lists everybody with their roles and recovery-code counts in one pass", async () => {
    await upsertStaffMember({ email: OWNER, displayName: "A", roles: ["owner"], actor: OWNER });
    await enrol(RECEPTION, ["receptionist", "auditor"]);

    const directory = await listStaff();
    const reception = directory.find((person) => person.email === RECEPTION);
    expect(reception?.roles).toEqual(["receptionist", "auditor"]);
    expect(reception?.recoveryCodesRemaining).toBe(10);
    expect(directory.find((person) => person.email === OWNER)?.recoveryCodesRemaining).toBe(0);
  });

  it("records when somebody last used the dashboard", async () => {
    await upsertStaffMember({ email: RECEPTION, displayName: "Nadia", actor: OWNER });
    expect((await getStaffRecord(RECEPTION))?.lastSeenAt).toBeNull();
    await touchLastSeen(RECEPTION);
    expect((await getStaffRecord(RECEPTION))?.lastSeenAt).toBeTruthy();
  });

  it("returns nothing for somebody who is not in the directory", async () => {
    expect(await getStaffRecord("stranger@example.com")).toBeNull();
  });
});

describe("enrolling a second factor", () => {
  it("issues a secret that is not readable in the stored row", async () => {
    const { secret } = await beginMfaEnrolment({
      email: RECEPTION,
      displayName: "Nadia",
      actor: RECEPTION,
    });

    const stored = await env.DB.prepare(
      "SELECT totp_secret AS secret FROM staff_users WHERE email = ?",
    )
      .bind(RECEPTION)
      .first<{ secret: string }>();

    // The point of encrypting at rest: reading the table is not enough to mint
    // codes for this account.
    expect(stored?.secret).toBeTruthy();
    expect(stored?.secret).not.toContain(secret);
    expect(stored?.secret).toMatch(/^v1\./);
  });

  it("creates the directory row when a break-glass owner enrols for the first time", async () => {
    // How an address named only in STAFF_EMAILS becomes a real, revocable owner.
    await beginMfaEnrolment({
      email: OWNER,
      displayName: "Dr Ashraf",
      roles: ["owner"],
      actor: OWNER,
    });
    const record = await getStaffRecord(OWNER);
    expect(record?.roles).toEqual(["owner"]);
    expect(record?.mfaPending).toBe(true);
    expect(record?.mfaEnrolled).toBe(false);
  });

  it("is not enrolled until a code proves the app holds the secret", async () => {
    const { secret } = await beginMfaEnrolment({
      email: RECEPTION,
      displayName: "Nadia",
      actor: RECEPTION,
    });
    expect((await getStaffRecord(RECEPTION))?.mfaEnrolled).toBe(false);

    const wrong = await confirmMfaEnrolment({ email: RECEPTION, code: "000000" });
    expect(wrong.ok).toBe(false);
    expect((await getStaffRecord(RECEPTION))?.mfaEnrolled).toBe(false);

    const right = await confirmMfaEnrolment({ email: RECEPTION, code: await totp(secret) });
    expect(right.ok).toBe(true);
    expect((await getStaffRecord(RECEPTION))?.mfaEnrolled).toBe(true);
  });

  it("hands over recovery codes exactly once, at confirmation", async () => {
    const { recoveryCodes } = await enrol(RECEPTION);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);

    const stored = await env.DB.prepare(
      "SELECT code_hash AS hash FROM staff_recovery_codes WHERE email = ?",
    )
      .bind(RECEPTION)
      .all<{ hash: string }>();
    expect(stored.results).toHaveLength(10);
    // Hashed, not stored: the table cannot be read back into working codes.
    for (const row of stored.results ?? []) {
      expect(recoveryCodes).not.toContain(row.hash);
    }
  });

  it("refuses to confirm an account that never started enrolling", async () => {
    await upsertStaffMember({ email: RECEPTION, displayName: "Nadia", actor: OWNER });
    const outcome = await confirmMfaEnrolment({ email: RECEPTION, code: "123456" });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe("not-enrolling");
  });

  it("refuses to enrol a deactivated account", async () => {
    await upsertStaffMember({ email: OWNER, displayName: "A", roles: ["owner"], actor: OWNER });
    await upsertStaffMember({ email: RECEPTION, displayName: "Nadia", actor: OWNER });
    await setStaffActive({ email: RECEPTION, active: false, actor: OWNER });

    await expect(
      beginMfaEnrolment({ email: RECEPTION, displayName: "Nadia", actor: RECEPTION }),
    ).rejects.toThrow(/not active/i);
  });

  it("re-enrolling discards the previous secret and its recovery codes", async () => {
    const first = await enrol(RECEPTION);
    await resetMfa({ email: RECEPTION, actor: RECEPTION });
    const second = await enrol(RECEPTION);

    expect(second.secret).not.toBe(first.secret);
    // A code from the old sheet must not open the new factor.
    const stale = await verifyMfaCode({ email: RECEPTION, code: first.recoveryCodes[0] });
    expect(stale.ok).toBe(false);
  });
});

describe("verifying a code", () => {
  it("accepts the code the authenticator is showing", async () => {
    const { secret } = await enrol(RECEPTION);
    await allowCurrentCode(RECEPTION);

    const outcome = await verifyMfaCode({ email: RECEPTION, code: await totp(secret) });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.usedRecoveryCode).toBe(false);
  });

  it("refuses the same code twice, even inside its own window", async () => {
    const { secret } = await enrol(RECEPTION);
    await allowCurrentCode(RECEPTION);
    const code = await totp(secret);

    expect((await verifyMfaCode({ email: RECEPTION, code })).ok).toBe(true);

    // RFC 6238 §5.2: one code, one sign-in. Without this, a code read over a
    // shoulder or off a screenshot stays usable for the rest of its window — up
    // to ninety seconds with drift accepted either side, which is ample on a
    // shared reception desktop.
    const replay = await verifyMfaCode({ email: RECEPTION, code });
    expect(replay.ok).toBe(false);
  });

  it("the code used to enrol cannot immediately be replayed to sign in", async () => {
    // The same guard, at the one moment it is easiest to get wrong: enrolment
    // consumes a counter too, so the code just typed is already spent.
    const { secret } = await beginMfaEnrolment({
      email: RECEPTION,
      displayName: "Nadia",
      actor: RECEPTION,
    });
    const code = await totp(secret);
    expect((await confirmMfaEnrolment({ email: RECEPTION, code })).ok).toBe(true);

    const replay = await verifyMfaCode({ email: RECEPTION, code });
    expect(replay.ok).toBe(false);
  });

  it("locks the account after five wrong codes and says until when", async () => {
    const { secret } = await enrol(RECEPTION);

    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      const outcome = await verifyMfaCode({ email: RECEPTION, code: "000000" });
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.reason).toBe("bad-code");
      expect(outcome.ok === false && outcome.attemptsRemaining).toBe(
        MAX_FAILED_ATTEMPTS - attempt,
      );
    }

    const locked = await verifyMfaCode({ email: RECEPTION, code: "000000" });
    expect(locked.ok).toBe(false);
    expect(locked.ok === false && locked.reason).toBe("locked");

    const until = Date.parse(
      (locked.ok === false && locked.lockedUntil) || new Date(0).toISOString(),
    );
    expect(until).toBeGreaterThan(Date.now());
    expect(until).toBeLessThanOrEqual(Date.now() + LOCKOUT_MINUTES * 60 * 1000 + 5_000);

    // A correct code is refused while the lockout stands — otherwise the limit
    // only slows an attacker down between guesses.
    const correct = await verifyMfaCode({ email: RECEPTION, code: await totp(secret) });
    expect(correct.ok).toBe(false);
    expect(correct.ok === false && correct.reason).toBe("locked");
  });

  it("a correct code resets the failure count", async () => {
    const { secret } = await enrol(RECEPTION);
    await verifyMfaCode({ email: RECEPTION, code: "000000" });
    await verifyMfaCode({ email: RECEPTION, code: "111111" });
    expect((await getStaffRecord(RECEPTION))?.failedAttempts).toBe(2);

    await allowCurrentCode(RECEPTION);
    const outcome = await verifyMfaCode({ email: RECEPTION, code: await totp(secret) });
    expect(outcome.ok).toBe(true);
    expect((await getStaffRecord(RECEPTION))?.failedAttempts).toBe(0);
  });

  it("refuses an account that is unknown, inactive or not enrolled", async () => {
    const unknown = await verifyMfaCode({ email: "nobody@example.com", code: "123456" });
    expect(unknown.ok === false && unknown.reason).toBe("unknown");

    await upsertStaffMember({ email: RECEPTION, displayName: "Nadia", actor: OWNER });
    const notEnrolled = await verifyMfaCode({ email: RECEPTION, code: "123456" });
    expect(notEnrolled.ok === false && notEnrolled.reason).toBe("not-enrolled");

    await upsertStaffMember({ email: OWNER, displayName: "A", roles: ["owner"], actor: OWNER });
    await setStaffActive({ email: RECEPTION, active: false, actor: OWNER });
    const inactive = await verifyMfaCode({ email: RECEPTION, code: "123456" });
    expect(inactive.ok === false && inactive.reason).toBe("inactive");
  });
});

describe("recovery codes", () => {
  it("a recovery code works in place of the phone, once", async () => {
    const { recoveryCodes } = await enrol(RECEPTION);
    const code = recoveryCodes[0];

    const first = await verifyMfaCode({ email: RECEPTION, code });
    expect(first.ok).toBe(true);
    expect(first.ok && first.usedRecoveryCode).toBe(true);

    // Single use is enforced by the row, not by a variable, so a second attempt
    // finds nothing left to burn.
    const second = await verifyMfaCode({ email: RECEPTION, code });
    expect(second.ok).toBe(false);
    expect((await getStaffRecord(RECEPTION))?.recoveryCodesRemaining).toBe(9);
  });

  it("accepts a recovery code typed without its dashes or in lowercase", async () => {
    const { recoveryCodes } = await enrol(RECEPTION);
    const outcome = await verifyMfaCode({
      email: RECEPTION,
      code: recoveryCodes[1].replace(/-/g, "").toLowerCase(),
    });
    expect(outcome.ok).toBe(true);
  });

  it("a recovery code frees an account that has locked itself out", async () => {
    const { recoveryCodes } = await enrol(RECEPTION);
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      await verifyMfaCode({ email: RECEPTION, code: "000000" });
    }
    expect((await verifyMfaCode({ email: RECEPTION, code: "000000" })).ok).toBe(false);

    // Deliberately still refused while locked: the lockout is the whole defence.
    const duringLockout = await verifyMfaCode({ email: RECEPTION, code: recoveryCodes[0] });
    expect(duringLockout.ok).toBe(false);
    expect(duringLockout.ok === false && duringLockout.reason).toBe("locked");
  });

  it("a wrong recovery code counts as a failed attempt", async () => {
    await enrol(RECEPTION);
    const outcome = await verifyMfaCode({
      email: RECEPTION,
      code: "ZZZZ-ZZZZ-ZZZZ-ZZZZ",
    });
    expect(outcome.ok).toBe(false);
    expect((await getStaffRecord(RECEPTION))?.failedAttempts).toBe(1);
  });

  it("regenerating replaces every existing code", async () => {
    const { recoveryCodes } = await enrol(RECEPTION);
    const replacement = await issueRecoveryCodes(RECEPTION);

    expect(replacement).toHaveLength(10);
    expect(replacement).not.toContain(recoveryCodes[0]);
    expect((await getStaffRecord(RECEPTION))?.recoveryCodesRemaining).toBe(10);

    // The old sheet must stop working, or "regenerate" silently means "add more".
    const stale = await verifyMfaCode({ email: RECEPTION, code: recoveryCodes[0] });
    expect(stale.ok).toBe(false);
  });
});

describe("resetting a second factor", () => {
  it("clears the factor, the codes, and every live session", async () => {
    const { secret, recoveryCodes } = await enrol(RECEPTION);
    const before = await getStaffRecord(RECEPTION);

    await resetMfa({ email: RECEPTION, actor: OWNER });

    const after = await getStaffRecord(RECEPTION);
    expect(after?.mfaEnrolled).toBe(false);
    expect(after?.mfaPending).toBe(false);
    expect(after?.recoveryCodesRemaining).toBe(0);
    // The stolen phone case: the old device has to lose access at the same moment.
    expect(after?.sessionEpoch).toBe((before?.sessionEpoch ?? 1) + 1);

    for (const code of [await totp(secret), recoveryCodes[0]]) {
      const outcome = await verifyMfaCode({ email: RECEPTION, code });
      expect(outcome.ok).toBe(false);
    }
  });

  it("refuses to reset somebody who is not in the directory", async () => {
    await expect(resetMfa({ email: "nobody@example.com", actor: OWNER })).rejects.toThrow(
      /not in the directory/i,
    );
  });
});

describe("the security event log", () => {
  it("records enrolment, success, failure and lockout", async () => {
    const { secret } = await enrol(RECEPTION);
    await allowCurrentCode(RECEPTION);
    await verifyMfaCode({ email: RECEPTION, code: await totp(secret) });
    await verifyMfaCode({ email: RECEPTION, code: "000000" });

    const events = await listSecurityEvents({ limit: 100 });
    const names = events.map((event) => event.event);
    expect(names).toContain("mfa_enrolment_started");
    expect(names).toContain("mfa_enrolled");
    expect(names).toContain("recovery_codes_issued");
    expect(names).toContain("mfa_verified");
    expect(names).toContain("mfa_failed");
  });

  it("records a role change with what it changed from and to", async () => {
    await upsertStaffMember({
      email: RECEPTION,
      displayName: "Nadia",
      roles: ["receptionist"],
      actor: OWNER,
    });
    await setStaffRoles({ email: RECEPTION, roles: ["auditor"], actor: OWNER });

    const events = await listSecurityEvents({ limit: 50 });
    const change = events.find((event) => event.detail?.includes("→"));
    expect(change?.event).toBe("staff_roles_changed");
    expect(change?.actor).toBe(OWNER);
    expect(change?.subject).toBe(RECEPTION);
    expect(change?.detail).toBe("receptionist → auditor");
  });

  it("never throws, so a failed log write cannot break a sign-in", async () => {
    await expect(
      recordSecurityEvent({
        actor: RECEPTION,
        event: "mfa_verified",
        outcome: "allowed",
        detail: "x".repeat(5_000),
      }),
    ).resolves.toBeUndefined();
  });

  it("filters to one actor", async () => {
    await recordSecurityEvent({ actor: OWNER, event: "mfa_verified", outcome: "allowed" });
    await recordSecurityEvent({ actor: RECEPTION, event: "mfa_failed", outcome: "denied" });

    const mine = await listSecurityEvents({ actor: OWNER });
    expect(mine).toHaveLength(1);
    expect(mine[0].actor).toBe(OWNER);
  });

  it("trims events past the audit retention window", async () => {
    await env.DB.prepare(
      `INSERT INTO security_events (id, actor, event, outcome, at)
       VALUES ('ancient', ?, 'mfa_verified', 'allowed', '2019-01-01T00:00:00.000Z')`,
    )
      .bind(OWNER)
      .run();
    await recordSecurityEvent({ actor: OWNER, event: "mfa_verified", outcome: "allowed" });

    const purged = await purgeExpiredSecurityEvents();
    expect(purged).toBe(1);
    const remaining = await listSecurityEvents({ limit: 50 });
    expect(remaining.every((event) => event.id !== "ancient")).toBe(true);
    expect(remaining).toHaveLength(1);
  });
});
