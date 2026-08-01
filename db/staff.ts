import { env } from "cloudflare:workers";
import { AUDIT_RETENTION_DAYS } from "@/lib/clinic";
import { addDays, clinicToday } from "@/lib/dates";
import { reportError } from "@/lib/observability";
import { DEFAULT_ROLE, parseRoles, type StaffRole } from "@/lib/roles";
import {
  decryptSecret,
  digestsMatch,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normaliseRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "@/lib/staff-crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import {
  checkPasswordStrength,
  describePasswordProblem,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "@/lib/password";

/**
 * The clinic's own staff directory: who exists, what they may do, and what
 * second factor they hold.
 *
 * The platform proxy authenticates an email address. Everything past that point
 * — is this person still employed here, are they reception or the doctor, have
 * they proved possession of their phone — is the practice's business and lives
 * here.
 *
 * Deliberately knows nothing about HTTP or `lib/auth`. That is partly hygiene
 * and partly a hard constraint: importing `lib/auth` pulls in `next/headers`,
 * which cannot resolve inside vitest-pool-workers, and the last time a database
 * module did that the integration suite silently ran zero tests. Configuration
 * arrives as arguments.
 */

/** After this many consecutive wrong codes the account stops accepting them. */
export const MAX_FAILED_ATTEMPTS = 5;

/**
 * Attempts one client may make across *all* accounts before it is blocked.
 *
 * The per-account lockout above stops five wrong codes against one colleague. It
 * does nothing about one source working through the whole directory five guesses
 * at a time, which is the shape an attack takes once the staff list is known —
 * and staff addresses are not secret.
 *
 * Set well above the per-account limit so a receptionist mistyping their own code
 * is never caught by it, and low enough that enumeration is pointless.
 */
export const MAX_CLIENT_ATTEMPTS = 20;

/** How long the client-wide counter accumulates before it resets. */
export const THROTTLE_WINDOW_MINUTES = 15;

/** How long a client stays blocked once it trips the limit. */
export const THROTTLE_BLOCK_MINUTES = 30;

/**
 * Long enough to make guessing pointless, short enough that a receptionist who
 * fat-fingered five codes is not locked out for the rest of their shift.
 *
 * Six digits with a code either side accepted means roughly three in a million
 * per guess; unthrottled, a script clears that space in minutes.
 */
export const LOCKOUT_MINUTES = 15;

export const ISSUER = "Care Point";

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

let staffReady: Promise<void> | null = null;

export function ensureStaffSchema(): Promise<void> {
  staffReady ??= createSchema().catch((error) => {
    staffReady = null;
    throw error;
  });
  return staffReady;
}

/**
 * Columns added to `staff_users` after the table first shipped.
 *
 * The migration under `drizzle/` is what production runs. This exists because a
 * database created by an earlier migration already has the table, so
 * `CREATE TABLE IF NOT EXISTS` is a no-op and the new columns would never
 * appear on a developer's or a test runner's copy.
 */
const ADDED_COLUMNS: Array<[string, string]> = [
  ["password_hash", "TEXT"],
  ["password_set_at", "TEXT"],
  ["must_change_password", "INTEGER NOT NULL DEFAULT 0"],
  ["totp_secret", "TEXT"],
  ["totp_confirmed_at", "TEXT"],
  ["totp_last_counter", "INTEGER NOT NULL DEFAULT 0"],
  ["failed_attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["locked_until", "TEXT"],
  ["session_epoch", "INTEGER NOT NULL DEFAULT 1"],
  ["invited_by", "TEXT"],
  ["last_seen_at", "TEXT"],
];

async function createSchema() {
  const db = database();
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS staff_users (
        email TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        password_hash TEXT,
        password_set_at TEXT,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        totp_secret TEXT,
        totp_confirmed_at TEXT,
        totp_last_counter INTEGER NOT NULL DEFAULT 0,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        session_epoch INTEGER NOT NULL DEFAULT 1,
        invited_by TEXT,
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS staff_user_roles (
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (email, role)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS staff_recovery_codes (
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (email, code_hash)
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS staff_recovery_codes_email ON staff_recovery_codes (email, used_at)",
    ),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        event TEXT NOT NULL,
        outcome TEXT NOT NULL,
        subject TEXT,
        detail TEXT,
        client_hash TEXT,
        at TEXT NOT NULL
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS security_events_actor_at ON security_events (actor, at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS security_events_event_at ON security_events (event, at)",
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS security_events_at ON security_events (at)"),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS staff_sessions (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        token_digest TEXT NOT NULL,
        device TEXT,
        client_hash TEXT,
        issued_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS staff_sessions_email ON staff_sessions (email, revoked_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS staff_sessions_expires ON staff_sessions (expires_at)",
    ),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS auth_throttle (
        key TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0,
        window_started_at TEXT NOT NULL,
        blocked_until TEXT
      )
    `),
  ]);

  await addMissingColumns(db);
}

/* -------------------------------------------------------------------------- */
/* Per-client throttle                                                        */
/* -------------------------------------------------------------------------- */

export type ThrottleDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Fixed-window counter, keyed on whatever the caller considers one client.
 *
 * Deliberately simple. A sliding window or a token bucket would be more precise,
 * but this runs on every code submission and the precision is not what stops an
 * attack — the existence of any ceiling is. Cloudflare's WAF remains the right
 * place for volumetric limits; this is the floor that applies whether or not that
 * has been configured, which matters because the account does not exist yet.
 */
export async function checkAuthThrottle(
  key: string | null | undefined,
  options: { limit?: number; nowMs?: number } = {},
): Promise<ThrottleDecision> {
  // No fingerprint means no key to count against. Failing open here is correct:
  // the per-account lockout still applies, and refusing every request whose IP
  // could not be hashed would lock the clinic out of its own dashboard.
  if (!key) return { allowed: true, remaining: options.limit ?? MAX_CLIENT_ATTEMPTS };

  await ensureStaffSchema();
  const limit = options.limit ?? MAX_CLIENT_ATTEMPTS;
  const nowMs = options.nowMs ?? Date.now();
  const row = await database()
    .prepare(
      `SELECT attempts, window_started_at AS windowStartedAt, blocked_until AS blockedUntil
       FROM auth_throttle WHERE key = ?`,
    )
    .bind(key)
    .first<{ attempts: number; windowStartedAt: string; blockedUntil: string | null }>();

  if (row?.blockedUntil) {
    const until = Date.parse(row.blockedUntil);
    if (Number.isFinite(until) && until > nowMs) {
      return { allowed: false, retryAfterSeconds: Math.ceil((until - nowMs) / 1000) };
    }
  }

  const windowStart = row ? Date.parse(row.windowStartedAt) : nowMs;
  const expired =
    !row || !Number.isFinite(windowStart) || nowMs - windowStart >= THROTTLE_WINDOW_MINUTES * 60_000;
  const attempts = expired ? 0 : row.attempts;
  return { allowed: true, remaining: Math.max(0, limit - attempts) };
}

/**
 * Records one failed attempt against a client and blocks it if it has had enough.
 *
 * Only failures are counted. Counting successes would throttle a busy reception
 * desk where several people sign in from one address across a shift.
 */
export async function recordAuthFailure(
  key: string | null | undefined,
  options: { limit?: number; nowMs?: number } = {},
): Promise<ThrottleDecision> {
  if (!key) return { allowed: true, remaining: options.limit ?? MAX_CLIENT_ATTEMPTS };

  await ensureStaffSchema();
  const limit = options.limit ?? MAX_CLIENT_ATTEMPTS;
  const nowMs = options.nowMs ?? Date.now();
  const timestamp = new Date(nowMs).toISOString();
  const db = database();

  const row = await db
    .prepare(
      `SELECT attempts, window_started_at AS windowStartedAt FROM auth_throttle WHERE key = ?`,
    )
    .bind(key)
    .first<{ attempts: number; windowStartedAt: string }>();

  const windowStart = row ? Date.parse(row.windowStartedAt) : nowMs;
  const expired =
    !row || !Number.isFinite(windowStart) || nowMs - windowStart >= THROTTLE_WINDOW_MINUTES * 60_000;
  const attempts = (expired ? 0 : row.attempts) + 1;
  const blocked = attempts >= limit;
  const blockedUntil = blocked
    ? new Date(nowMs + THROTTLE_BLOCK_MINUTES * 60_000).toISOString()
    : null;

  await db
    .prepare(
      `INSERT INTO auth_throttle (key, attempts, window_started_at, blocked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         attempts = excluded.attempts,
         window_started_at = excluded.window_started_at,
         blocked_until = excluded.blocked_until`,
    )
    .bind(key, attempts, expired ? timestamp : row!.windowStartedAt, blockedUntil)
    .run();

  if (blocked) {
    await recordSecurityEvent({
      actor: "anonymous",
      event: "mfa_locked",
      outcome: "denied",
      detail: `client blocked after ${attempts} failed attempts across accounts`,
      clientHash: key,
    });
    return { allowed: false, retryAfterSeconds: THROTTLE_BLOCK_MINUTES * 60 };
  }
  return { allowed: true, remaining: Math.max(0, limit - attempts) };
}

/** Clears a client's counter after a genuine success. */
export async function clearAuthThrottle(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await ensureStaffSchema();
    await database().prepare("DELETE FROM auth_throttle WHERE key = ?").bind(key).run();
  } catch {
    // A counter that failed to clear only costs the client its remaining budget.
  }
}

/** Drops counters whose window and block have both lapsed. */
export async function purgeExpiredThrottles(): Promise<number> {
  await ensureStaffSchema();
  const cutoff = new Date(
    Date.now() - Math.max(THROTTLE_WINDOW_MINUTES, THROTTLE_BLOCK_MINUTES) * 60_000,
  ).toISOString();
  const result = await database()
    .prepare(
      `DELETE FROM auth_throttle
       WHERE window_started_at < ? AND (blocked_until IS NULL OR blocked_until < ?)`,
    )
    .bind(cutoff, new Date().toISOString())
    .run();
  return result.meta.changes ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export type StaffSessionRow = {
  id: string;
  device: string | null;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

/**
 * A coarse device label from a user agent.
 *
 * Deliberately lossy. The point is to let somebody recognise their own devices —
 * "Chrome on Windows" is enough to know which one is the hotel computer — without
 * storing a string precise enough to fingerprint them with.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent.toLowerCase();
  const platform = /iphone|ipad|ipod/.test(ua)
    ? "iOS"
    : /android/.test(ua)
      ? "Android"
      : /windows/.test(ua)
        ? "Windows"
        : /mac os|macintosh/.test(ua)
          ? "macOS"
          : /linux/.test(ua)
            ? "Linux"
            : "Unknown";
  const browser = /edg\//.test(ua)
    ? "Edge"
    : /chrome|crios/.test(ua)
      ? "Chrome"
      : /firefox|fxios/.test(ua)
        ? "Firefox"
        : /safari/.test(ua)
          ? "Safari"
          : "Browser";
  return `${browser} on ${platform}`;
}

export async function recordStaffSession(input: {
  id: string;
  email: string;
  tokenDigest: string;
  device?: string | null;
  clientHash?: string | null;
  expiresAtMs: number;
}): Promise<void> {
  try {
    await ensureStaffSchema();
    const timestamp = new Date().toISOString();
    await database()
      .prepare(
        `INSERT INTO staff_sessions
         (id, email, token_digest, device, client_hash, issued_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        normaliseEmail(input.email),
        input.tokenDigest,
        input.device ?? null,
        input.clientHash ?? null,
        timestamp,
        timestamp,
        new Date(input.expiresAtMs).toISOString(),
      )
      .run();
  } catch (error) {
    // The session itself is valid whether or not it was recorded. Losing the row
    // costs visibility, not access, so it must not fail the sign-in.
    await reportError(error, {
      where: "staff: recordStaffSession",
      level: "warning",
    });
  }
}

/** Sessions a staff member currently holds, newest first. */
export async function listStaffSessions(email: string): Promise<StaffSessionRow[]> {
  await ensureStaffSchema();
  const result = await database()
    .prepare(
      `SELECT id, device, issued_at AS issuedAt, last_seen_at AS lastSeenAt,
              expires_at AS expiresAt
       FROM staff_sessions
       WHERE email = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY last_seen_at DESC LIMIT 25`,
    )
    .bind(normaliseEmail(email), new Date().toISOString())
    .all<StaffSessionRow>();
  return result.results ?? [];
}

/**
 * Whether a session id is still live.
 *
 * Checked on every staff request, which is why it is one indexed lookup and
 * nothing more. A session recorded before this table existed — or one whose
 * insert failed — has no row, and is treated as live: the signature, the epoch
 * and the expiry have already been verified, so refusing it would lock people out
 * over a missing audit row.
 */
export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  try {
    await ensureStaffSchema();
    const row = await database()
      .prepare("SELECT revoked_at AS revokedAt FROM staff_sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ revokedAt: string | null }>();
    return Boolean(row?.revokedAt);
  } catch {
    return false;
  }
}

/** Notes that a session was used, for the "last seen" column. */
export async function touchStaffSession(sessionId: string): Promise<void> {
  try {
    await database()
      .prepare("UPDATE staff_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), sessionId)
      .run();
  } catch {
    // Cosmetic.
  }
}

/** Ends one device's session. Returns false if it was already gone. */
export async function revokeStaffSession(input: {
  id: string;
  email: string;
  actor: string;
}): Promise<boolean> {
  await ensureStaffSchema();
  const result = await database()
    .prepare(
      `UPDATE staff_sessions SET revoked_at = ?, revoked_by = ?
       WHERE id = ? AND email = ? AND revoked_at IS NULL`,
    )
    .bind(new Date().toISOString(), input.actor, input.id, normaliseEmail(input.email))
    .run();
  const changed = (result.meta.changes ?? 0) > 0;
  if (changed) {
    await recordSecurityEvent({
      actor: input.actor,
      event: "session_revoked",
      outcome: "changed",
      subject: normaliseEmail(input.email),
      detail: "one device signed out",
    });
  }
  return changed;
}

/**
 * Signs a staff member out everywhere by bumping their epoch.
 *
 * The epoch is inside every token's signature, so raising it invalidates all of
 * them at once without needing to find or trust any individual row. The session
 * rows are marked too, but only so the list reflects reality — the revocation
 * itself does not depend on them.
 */
export async function revokeAllStaffSessions(input: {
  email: string;
  actor: string;
}): Promise<void> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  const timestamp = new Date().toISOString();
  const db = database();
  await db.batch([
    db
      .prepare(
        "UPDATE staff_users SET session_epoch = session_epoch + 1, updated_at = ? WHERE email = ?",
      )
      .bind(timestamp, email),
    db
      .prepare(
        "UPDATE staff_sessions SET revoked_at = ?, revoked_by = ? WHERE email = ? AND revoked_at IS NULL",
      )
      .bind(timestamp, input.actor, email),
  ]);

  await recordSecurityEvent({
    actor: input.actor,
    event: "session_revoked",
    outcome: "changed",
    subject: email,
    detail: input.actor === email ? "signed out of all devices" : "all devices ended by an owner",
  });
}

/** Drops sessions that expired long enough ago to be of no further interest. */
export async function purgeExpiredStaffSessions(): Promise<number> {
  await ensureStaffSchema();
  const cutoff = addDays(clinicToday(), -30);
  const result = await database()
    .prepare("DELETE FROM staff_sessions WHERE expires_at < ?")
    .bind(`${cutoff}T00:00:00.000Z`)
    .run();
  return result.meta.changes ?? 0;
}

async function addMissingColumns(db: D1Database) {
  let existing: Set<string> | null = null;
  try {
    const info = await db.prepare("PRAGMA table_info(staff_users)").all<{ name: string }>();
    existing = new Set((info.results ?? []).map((column) => column.name));
  } catch {
    // Some environments refuse the pragma. Fall through to attempting each
    // column and treating "already there" as success.
    existing = null;
  }

  for (const [column, definition] of ADDED_COLUMNS) {
    if (existing && existing.has(column)) continue;
    try {
      await db.prepare(`ALTER TABLE staff_users ADD COLUMN ${column} ${definition}`).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column/i.test(message)) throw error;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Security event log                                                         */
/* -------------------------------------------------------------------------- */

export type SecurityEventName =
  | "mfa_enrolment_started"
  | "mfa_enrolled"
  | "mfa_verified"
  | "mfa_failed"
  | "mfa_locked"
  | "mfa_reset"
  | "recovery_code_used"
  | "recovery_codes_issued"
  | "staff_added"
  | "staff_roles_changed"
  | "staff_deactivated"
  | "staff_reactivated"
  | "session_revoked"
  | "password_verified"
  | "password_failed"
  | "password_changed"
  | "password_reset"
  | "access_denied";

export type SecurityOutcome = "allowed" | "denied" | "changed";

/**
 * Records one security event. Never throws.
 *
 * Same reasoning as the patient access log: refusing a clinician their schedule
 * because a log insert failed would be worse than the missing row. But a log
 * that has quietly stopped recording must be visible, so failures are reported.
 */
export async function recordSecurityEvent(entry: {
  actor: string;
  event: SecurityEventName;
  outcome: SecurityOutcome;
  subject?: string | null;
  detail?: string | null;
  clientHash?: string | null;
}): Promise<void> {
  try {
    await ensureStaffSchema();
    await database()
      .prepare(
        `INSERT INTO security_events
         (id, actor, event, outcome, subject, detail, client_hash, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        entry.actor,
        entry.event,
        entry.outcome,
        entry.subject ?? null,
        entry.detail?.slice(0, 500) ?? null,
        entry.clientHash ?? null,
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    await reportError(error, {
      where: "staff: recordSecurityEvent",
      level: "warning",
      extra: { event: entry.event },
    });
  }
}

export type SecurityEventRow = {
  id: string;
  actor: string;
  event: string;
  outcome: string;
  subject: string | null;
  detail: string | null;
  at: string;
};

export async function listSecurityEvents(options: { limit?: number; actor?: string } = {}) {
  await ensureStaffSchema();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const where = options.actor ? "WHERE actor = ?" : "";
  const bindings = options.actor ? [options.actor, limit] : [limit];
  const result = await database()
    .prepare(
      `SELECT id, actor, event, outcome, subject, detail, at
       FROM security_events ${where}
       ORDER BY at DESC LIMIT ?`,
    )
    .bind(...bindings)
    .all<SecurityEventRow>();
  return result.results ?? [];
}

/** Trimmed on the audit schedule: it identifies staff, not patients. */
export async function purgeExpiredSecurityEvents(): Promise<number> {
  await ensureStaffSchema();
  const cutoff = addDays(clinicToday(), -AUDIT_RETENTION_DAYS);
  const result = await database()
    .prepare("DELETE FROM security_events WHERE at < ?")
    .bind(`${cutoff}T00:00:00.000Z`)
    .run();
  return result.meta.changes ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Directory                                                                  */
/* -------------------------------------------------------------------------- */

export type StaffRecord = {
  email: string;
  displayName: string;
  active: boolean;
  roles: StaffRole[];
  /** A secret has been generated but not yet proved with a code. */
  mfaPending: boolean;
  /** A secret has been proved: this account has a working second factor. */
  mfaEnrolled: boolean;
  mfaConfirmedAt: string | null;
  /** Whether a password has been claimed. The hash itself never leaves this module. */
  hasPassword: boolean;
  mustChangePassword: boolean;
  passwordSetAt: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  sessionEpoch: number;
  recoveryCodesRemaining: number;
  invitedBy: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type StaffRow = {
  email: string;
  displayName: string;
  active: number;
  passwordHash: string | null;
  passwordSetAt: string | null;
  mustChangePassword: number;
  totpSecret: string | null;
  totpConfirmedAt: string | null;
  totpLastCounter: number;
  failedAttempts: number;
  lockedUntil: string | null;
  sessionEpoch: number;
  invitedBy: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const ROW_COLUMNS = `email, display_name AS displayName, active,
       password_hash AS passwordHash, password_set_at AS passwordSetAt,
       must_change_password AS mustChangePassword,
       totp_secret AS totpSecret, totp_confirmed_at AS totpConfirmedAt,
       totp_last_counter AS totpLastCounter, failed_attempts AS failedAttempts,
       locked_until AS lockedUntil, session_epoch AS sessionEpoch,
       invited_by AS invitedBy, last_seen_at AS lastSeenAt,
       created_at AS createdAt, updated_at AS updatedAt`;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toRecord(
  row: StaffRow,
  roles: StaffRole[],
  recoveryCodesRemaining: number,
): StaffRecord {
  return {
    email: row.email,
    displayName: row.displayName,
    active: Boolean(row.active),
    roles,
    mfaPending: Boolean(row.totpSecret) && !row.totpConfirmedAt,
    mfaEnrolled: Boolean(row.totpSecret && row.totpConfirmedAt),
    mfaConfirmedAt: row.totpConfirmedAt,
    hasPassword: Boolean(row.passwordHash),
    mustChangePassword: Boolean(row.mustChangePassword),
    passwordSetAt: row.passwordSetAt,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
    sessionEpoch: row.sessionEpoch,
    recoveryCodesRemaining,
    invitedBy: row.invitedBy,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function rolesFor(email: string): Promise<StaffRole[]> {
  const result = await database()
    .prepare("SELECT role FROM staff_user_roles WHERE email = ?")
    .bind(email)
    .all<{ role: string }>();
  return parseRoles((result.results ?? []).map((row) => row.role));
}

async function unusedRecoveryCount(email: string): Promise<number> {
  const row = await database()
    .prepare(
      "SELECT COUNT(*) AS remaining FROM staff_recovery_codes WHERE email = ? AND used_at IS NULL",
    )
    .bind(email)
    .first<{ remaining: number }>();
  return row?.remaining ?? 0;
}

export async function getStaffRecord(email: string): Promise<StaffRecord | null> {
  await ensureStaffSchema();
  const key = normaliseEmail(email);
  const row = await database()
    .prepare(`SELECT ${ROW_COLUMNS} FROM staff_users WHERE email = ?`)
    .bind(key)
    .first<StaffRow>();
  if (!row) return null;

  const [roles, recovery] = await Promise.all([rolesFor(key), unusedRecoveryCount(key)]);
  return toRecord(row, roles, recovery);
}

export async function listStaff(): Promise<StaffRecord[]> {
  await ensureStaffSchema();
  const db = database();
  const [people, roles, recovery] = await Promise.all([
    db.prepare(`SELECT ${ROW_COLUMNS} FROM staff_users ORDER BY email`).all<StaffRow>(),
    db.prepare("SELECT email, role FROM staff_user_roles").all<{ email: string; role: string }>(),
    db
      .prepare(
        `SELECT email, COUNT(*) AS remaining FROM staff_recovery_codes
         WHERE used_at IS NULL GROUP BY email`,
      )
      .all<{ email: string; remaining: number }>(),
  ]);

  const rolesByEmail = new Map<string, string[]>();
  for (const row of roles.results ?? []) {
    const list = rolesByEmail.get(row.email) ?? [];
    list.push(row.role);
    rolesByEmail.set(row.email, list);
  }
  const recoveryByEmail = new Map(
    (recovery.results ?? []).map((row) => [row.email, row.remaining]),
  );

  return (people.results ?? []).map((row) =>
    toRecord(
      row,
      parseRoles(rolesByEmail.get(row.email) ?? []),
      recoveryByEmail.get(row.email) ?? 0,
    ),
  );
}

/** How many active owners exist. The set that must never reach zero. */
export async function countActiveOwners(): Promise<number> {
  await ensureStaffSchema();
  const row = await database()
    .prepare(
      `SELECT COUNT(*) AS owners FROM staff_user_roles r
       JOIN staff_users u ON u.email = r.email
       WHERE r.role = 'owner' AND u.active = 1`,
    )
    .first<{ owners: number }>();
  return row?.owners ?? 0;
}

async function writeRoles(email: string, roles: StaffRole[]) {
  const db = database();
  const timestamp = new Date().toISOString();
  const statements = [
    db.prepare("DELETE FROM staff_user_roles WHERE email = ?").bind(email),
    ...roles.map((role) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO staff_user_roles (email, role, created_at) VALUES (?, ?, ?)",
        )
        .bind(email, role, timestamp),
    ),
  ];
  // One batch, so a role set is never half-applied: a failure part-way through
  // must not leave someone with the permissions of neither their old role nor
  // their new one.
  await db.batch(statements);
}

/**
 * Adds a colleague, or updates the name and roles of one who already exists.
 *
 * Never touches MFA state: an owner correcting a spelling must not silently
 * clear somebody's second factor.
 */
export async function upsertStaffMember(input: {
  email: string;
  displayName: string;
  roles?: readonly string[];
  actor: string;
}): Promise<StaffRecord> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  if (!email || !email.includes("@")) throw new Error("A staff email address is required.");
  const displayName = input.displayName.trim().slice(0, 120);
  if (!displayName) throw new Error("A staff name is required.");

  const requested = input.roles ? parseRoles(input.roles) : [];
  const existing = await getStaffRecord(email);
  const roles = requested.length > 0 ? requested : existing?.roles.length ? existing.roles : [DEFAULT_ROLE];

  const timestamp = new Date().toISOString();
  await database()
    .prepare(
      `INSERT INTO staff_users (email, display_name, active, invited_by, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         display_name = excluded.display_name,
         updated_at = excluded.updated_at`,
    )
    .bind(email, displayName, input.actor, timestamp, timestamp)
    .run();
  await writeRoles(email, roles);

  const rolesChanged =
    !existing || existing.roles.join(",") !== roles.join(",");
  await recordSecurityEvent({
    actor: input.actor,
    event: existing ? "staff_roles_changed" : "staff_added",
    outcome: "changed",
    subject: email,
    detail: rolesChanged ? `roles: ${roles.join(", ") || "none"}` : "details updated",
  });

  const record = await getStaffRecord(email);
  if (!record) throw new Error("The staff record could not be read back.");
  return record;
}

/**
 * Deactivation, not deletion.
 *
 * Removing the row would orphan the security events and audit entries that name
 * them, which is exactly the history an investigation needs. Deactivating also
 * bumps the session epoch, so someone who leaves loses access immediately rather
 * than at the end of their current MFA session.
 */
export async function setStaffActive(input: {
  email: string;
  active: boolean;
  actor: string;
}): Promise<StaffRecord> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  const record = await getStaffRecord(email);
  if (!record) throw new Error("That staff member is not in the directory.");

  if (!input.active && record.roles.includes("owner")) {
    const owners = await countActiveOwners();
    if (owners <= 1) {
      // Locking the practice out of its own appointment book is not a state the
      // system should let anybody reach through the UI.
      throw new Error("The last active owner cannot be deactivated.");
    }
  }

  const timestamp = new Date().toISOString();
  await database()
    .prepare(
      `UPDATE staff_users
       SET active = ?, updated_at = ?,
           session_epoch = session_epoch + CASE WHEN ? = 0 THEN 1 ELSE 0 END,
           failed_attempts = 0, locked_until = NULL
       WHERE email = ?`,
    )
    .bind(input.active ? 1 : 0, timestamp, input.active ? 1 : 0, email)
    .run();

  await recordSecurityEvent({
    actor: input.actor,
    event: input.active ? "staff_reactivated" : "staff_deactivated",
    outcome: "changed",
    subject: email,
  });

  const updated = await getStaffRecord(email);
  if (!updated) throw new Error("The staff record could not be read back.");
  return updated;
}

export async function setStaffRoles(input: {
  email: string;
  roles: readonly string[];
  actor: string;
}): Promise<StaffRecord> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  const record = await getStaffRecord(email);
  if (!record) throw new Error("That staff member is not in the directory.");

  const roles = parseRoles(input.roles);
  if (roles.length === 0) throw new Error("Choose at least one role.");

  if (record.roles.includes("owner") && !roles.includes("owner")) {
    const owners = await countActiveOwners();
    if (owners <= 1) throw new Error("The last owner cannot give up the owner role.");
  }

  await writeRoles(email, roles);
  await database()
    .prepare("UPDATE staff_users SET updated_at = ? WHERE email = ?")
    .bind(new Date().toISOString(), email)
    .run();

  await recordSecurityEvent({
    actor: input.actor,
    event: "staff_roles_changed",
    outcome: "changed",
    subject: email,
    detail: `${record.roles.join(", ") || "none"} → ${roles.join(", ")}`,
  });

  const updated = await getStaffRecord(email);
  if (!updated) throw new Error("The staff record could not be read back.");
  return updated;
}

/** Records that someone used the dashboard, for the directory's "last seen". */
export async function touchLastSeen(email: string): Promise<void> {
  try {
    await ensureStaffSchema();
    await database()
      .prepare("UPDATE staff_users SET last_seen_at = ? WHERE email = ?")
      .bind(new Date().toISOString(), normaliseEmail(email))
      .run();
  } catch {
    // Cosmetic. Never worth failing a request over.
  }
}


/* -------------------------------------------------------------------------- */
/* Passwords                                                                  */
/* -------------------------------------------------------------------------- */

export type PasswordCheck =
  | { ok: true; record: StaffRecord; mustChangePassword: boolean }
  | {
      ok: false;
      reason: "unknown" | "inactive" | "no-password" | "wrong-password" | "locked";
      lockedUntil?: string | null;
      attemptsRemaining?: number;
    };

/**
 * Checks an email and password pair.
 *
 * Every failure mode returns after doing comparable work, and none of them says
 * whether the address exists. "No account here" and "wrong password" are the same
 * answer to the caller, because the difference is exactly what an attacker wants
 * in order to build a target list from the practice website.
 *
 * The same per-account lockout that guards codes guards passwords, so five wrong
 * attempts stop the account whichever factor was being guessed.
 */
export async function verifyStaffPassword(input: {
  email: string;
  password: string;
  clientHash?: string | null;
}): Promise<PasswordCheck> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  const row = await database()
    .prepare(
      `SELECT password_hash AS hash, active, must_change_password AS mustChange
       FROM staff_users WHERE email = ?`,
    )
    .bind(email)
    .first<{ hash: string | null; active: number; mustChange: number }>();

  /**
   * Absent accounts still pay for a derivation.
   *
   * Returning immediately would make "does this address work here?" answerable
   * with a stopwatch, so an unknown email is checked against a throwaway hash
   * before being refused.
   */
  if (!row) {
    await verifyPassword(input.password, await dummyHash());
    await recordSecurityEvent({
      actor: email,
      event: "password_failed",
      outcome: "denied",
      detail: "no such account",
      clientHash: input.clientHash ?? null,
    });
    return { ok: false, reason: "unknown" };
  }

  const record = await getStaffRecord(email);
  if (!record) return { ok: false, reason: "unknown" };
  if (!record.active) {
    await verifyPassword(input.password, await dummyHash());
    return { ok: false, reason: "inactive" };
  }
  if (isLocked(record, Date.now())) {
    return { ok: false, reason: "locked", lockedUntil: record.lockedUntil };
  }
  if (!row.hash) {
    await verifyPassword(input.password, await dummyHash());
    return { ok: false, reason: "no-password" };
  }

  if (!(await verifyPassword(input.password, row.hash))) {
    const failure = await registerFailure(record);
    await recordSecurityEvent({
      actor: email,
      event: "password_failed",
      outcome: "denied",
      clientHash: input.clientHash ?? null,
    });
    if (failure.ok === false && failure.reason === "locked") {
      return { ok: false, reason: "locked", lockedUntil: failure.lockedUntil };
    }
    return {
      ok: false,
      reason: "wrong-password",
      attemptsRemaining:
        failure.ok === false ? failure.attemptsRemaining : undefined,
    };
  }

  const timestamp = new Date().toISOString();
  // A correct password clears the failure count, and upgrades the stored hash if
  // the cost parameter has been raised since it was set. This is the only moment
  // the plaintext exists, so it is the only moment an upgrade is possible.
  const statements = [
    database()
      .prepare(
        `UPDATE staff_users SET failed_attempts = 0, locked_until = NULL, updated_at = ?
         WHERE email = ?`,
      )
      .bind(timestamp, email),
  ];
  if (needsRehash(row.hash)) {
    statements.push(
      database()
        .prepare("UPDATE staff_users SET password_hash = ? WHERE email = ?")
        .bind(await hashPassword(input.password), email),
    );
  }
  await database().batch(statements);

  await recordSecurityEvent({
    actor: email,
    event: "password_verified",
    outcome: "allowed",
    clientHash: input.clientHash ?? null,
  });
  return {
    ok: true,
    record,
    mustChangePassword: Boolean(row.mustChange),
  };
}

/**
 * A hash of a value nobody knows.
 *
 * Compared against when the account does not exist, is inactive, or has no
 * password, so a failed sign-in costs roughly the same wherever it failed.
 * Returning early instead would make "does this address work here?" answerable
 * with a stopwatch — and staff addresses are already on the practice website, so
 * the only thing left to discover is which of them are real.
 *
 * Derived once per isolate, lazily, so module load pays nothing.
 */
let absentAccountHash: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  absentAccountHash ??= hashPassword("carepoint-absent-account-placeholder");
  return absentAccountHash;
}

/**
 * Sets or replaces a password.
 *
 * Validated against the same rules whoever set it will be held to, so an owner
 * cannot hand somebody a temporary password the system would then refuse.
 */
export async function setStaffPassword(input: {
  email: string;
  password: string;
  actor: string;
  /** True when the holder must choose their own on next sign-in. */
  temporary?: boolean;
}): Promise<void> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  const record = await getStaffRecord(email);
  if (!record) throw new Error("That staff member is not in the directory.");
  if (!record.active) throw new Error("That staff account is not active.");

  const problems = checkPasswordStrength(input.password, email);
  if (problems.length > 0) {
    throw new Error(problems.map(describePasswordProblem).join(" "));
  }

  const timestamp = new Date().toISOString();
  const hash = await hashPassword(input.password);
  const db = database();
  await db.batch([
    db
      .prepare(
        `UPDATE staff_users
         SET password_hash = ?, password_set_at = ?, must_change_password = ?,
             failed_attempts = 0, locked_until = NULL, updated_at = ?
         WHERE email = ?`,
      )
      .bind(hash, timestamp, input.temporary ? 1 : 0, timestamp, email),
    /**
     * Every existing session dies with a password change.
     *
     * This is the point of changing it: whoever prompted the change may be holding
     * a live session, and leaving theirs running would make the new password
     * cosmetic.
     */
    db
      .prepare(
        "UPDATE staff_users SET session_epoch = session_epoch + 1 WHERE email = ?",
      )
      .bind(email),
    db
      .prepare(
        "UPDATE staff_sessions SET revoked_at = ?, revoked_by = ? WHERE email = ? AND revoked_at IS NULL",
      )
      .bind(timestamp, input.actor, email),
  ]);

  await recordSecurityEvent({
    actor: input.actor,
    event: input.temporary ? "password_reset" : "password_changed",
    outcome: "changed",
    subject: email,
    detail:
      input.actor === email
        ? "chosen by the account holder"
        : "temporary password issued by an owner",
  });
}

/* -------------------------------------------------------------------------- */
/* Second factor                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Issues a secret and returns it once, for the authenticator app.
 *
 * The secret is stored encrypted but *unconfirmed*: until a code proves the app
 * holds it, the account is not treated as enrolled. Marking enrolment on issue
 * would lock people out of their own account with a secret they never scanned.
 *
 * Creates the staff row when it does not exist yet, which is how a break-glass
 * owner from `STAFF_EMAILS` becomes a real directory entry the first time they
 * enrol.
 */
export async function beginMfaEnrolment(input: {
  email: string;
  displayName?: string;
  roles?: readonly string[];
  actor: string;
}): Promise<{ secret: string; uri: string }> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  if (!email || !email.includes("@")) throw new Error("A staff email address is required.");

  const existing = await getStaffRecord(email);
  if (existing && !existing.active) throw new Error("That staff account is not active.");

  const secret = generateTotpSecret();
  // Throws when no key is configured in production, before anything is written.
  const encrypted = await encryptSecret(secret);
  const timestamp = new Date().toISOString();

  if (existing) {
    await database()
      .prepare(
        `UPDATE staff_users
         SET totp_secret = ?, totp_confirmed_at = NULL, totp_last_counter = 0,
             failed_attempts = 0, locked_until = NULL, updated_at = ?
         WHERE email = ?`,
      )
      .bind(encrypted, timestamp, email)
      .run();
  } else {
    const roles = parseRoles(input.roles ?? []);
    await database()
      .prepare(
        `INSERT INTO staff_users
         (email, display_name, active, totp_secret, invited_by, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)`,
      )
      .bind(
        email,
        input.displayName?.trim().slice(0, 120) || email,
        encrypted,
        input.actor,
        timestamp,
        timestamp,
      )
      .run();
    await writeRoles(email, roles.length > 0 ? roles : [DEFAULT_ROLE]);
  }

  await recordSecurityEvent({
    actor: input.actor,
    event: "mfa_enrolment_started",
    outcome: "changed",
    subject: email,
  });

  return {
    secret,
    uri: otpauthUri({ secret, account: email, issuer: ISSUER }),
  };
}

/**
 * Reads and decrypts the stored secret, with the last counter it accepted.
 *
 * The counter is fetched here rather than exposed on `StaffRecord`, so the replay
 * guard's state never travels to the browser as part of a staff listing.
 */
async function readSecret(
  email: string,
): Promise<{ secret: string; lastCounter: number } | null> {
  const row = await database()
    .prepare(
      "SELECT totp_secret AS secret, totp_last_counter AS lastCounter FROM staff_users WHERE email = ?",
    )
    .bind(email)
    .first<{ secret: string | null; lastCounter: number }>();
  if (!row?.secret) return null;
  return { secret: await decryptSecret(row.secret), lastCounter: row.lastCounter ?? 0 };
}

/**
 * Proves the authenticator holds the issued secret, completing enrolment.
 *
 * Returns the recovery codes, which is the only time they are ever readable.
 */
export async function confirmMfaEnrolment(input: {
  email: string;
  code: string;
}): Promise<
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: "not-enrolling" | "already-enrolled" | "bad-code" }
> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  const record = await getStaffRecord(email);
  if (!record) return { ok: false, reason: "not-enrolling" };
  if (record.mfaEnrolled) return { ok: false, reason: "already-enrolled" };
  if (!record.mfaPending) return { ok: false, reason: "not-enrolling" };

  const stored = await readSecret(email);
  if (!stored) return { ok: false, reason: "not-enrolling" };

  const verification = await verifyTotp(stored.secret, input.code);
  if (!verification.ok) {
    await recordSecurityEvent({
      actor: email,
      event: "mfa_failed",
      outcome: "denied",
      detail: `enrolment: ${verification.reason}`,
    });
    return { ok: false, reason: "bad-code" };
  }

  const timestamp = new Date().toISOString();
  await database()
    .prepare(
      `UPDATE staff_users
       SET totp_confirmed_at = ?, totp_last_counter = ?, failed_attempts = 0,
           locked_until = NULL, updated_at = ?
       WHERE email = ?`,
    )
    .bind(timestamp, verification.counter, timestamp, email)
    .run();

  const recoveryCodes = await issueRecoveryCodes(email);
  await recordSecurityEvent({
    actor: email,
    event: "mfa_enrolled",
    outcome: "changed",
    subject: email,
  });
  return { ok: true, recoveryCodes };
}

/** Replaces every recovery code. Returns the new ones, once. */
export async function issueRecoveryCodes(email: string): Promise<string[]> {
  await ensureStaffSchema();
  const key = normaliseEmail(email);
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const hashes = await Promise.all(codes.map(hashRecoveryCode));
  const timestamp = new Date().toISOString();
  const db = database();

  await db.batch([
    // Replacing rather than adding: a code from a previous set must stop working,
    // or "regenerate my codes" would silently leave the old sheet valid.
    db.prepare("DELETE FROM staff_recovery_codes WHERE email = ?").bind(key),
    ...hashes.map((hash) =>
      db
        .prepare(
          "INSERT INTO staff_recovery_codes (email, code_hash, created_at) VALUES (?, ?, ?)",
        )
        .bind(key, hash, timestamp),
    ),
  ]);

  await recordSecurityEvent({
    actor: key,
    event: "recovery_codes_issued",
    outcome: "changed",
    subject: key,
    detail: `${codes.length} codes`,
  });
  return codes;
}

export type MfaVerification =
  | { ok: true; sessionEpoch: number; usedRecoveryCode: boolean }
  | {
      ok: false;
      reason: "unknown" | "inactive" | "not-enrolled" | "locked" | "bad-code";
      lockedUntil?: string | null;
      attemptsRemaining?: number;
    };

function isLocked(record: StaffRecord, nowMs: number): boolean {
  if (!record.lockedUntil) return false;
  const until = Date.parse(record.lockedUntil);
  return Number.isFinite(until) && until > nowMs;
}

async function registerFailure(record: StaffRecord): Promise<MfaVerification> {
  const attempts = record.failedAttempts + 1;
  const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = shouldLock
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
    : null;

  await database()
    .prepare(
      `UPDATE staff_users
       SET failed_attempts = ?, locked_until = ?, updated_at = ?
       WHERE email = ?`,
    )
    .bind(
      shouldLock ? 0 : attempts,
      lockedUntil,
      new Date().toISOString(),
      record.email,
    )
    .run();

  await recordSecurityEvent({
    actor: record.email,
    event: shouldLock ? "mfa_locked" : "mfa_failed",
    outcome: "denied",
    detail: shouldLock ? `locked for ${LOCKOUT_MINUTES} minutes` : `attempt ${attempts}`,
  });

  return shouldLock
    ? { ok: false, reason: "locked", lockedUntil }
    : { ok: false, reason: "bad-code", attemptsRemaining: MAX_FAILED_ATTEMPTS - attempts };
}

/**
 * Checks a submitted code — or a recovery code — and reports whether the second
 * factor is satisfied.
 *
 * The caller turns a success into a session; this function deliberately does not
 * know what a session is.
 */
export async function verifyMfaCode(input: {
  email: string;
  code: string;
  clientHash?: string | null;
}): Promise<MfaVerification> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  const record = await getStaffRecord(email);
  if (!record) return { ok: false, reason: "unknown" };
  if (!record.active) return { ok: false, reason: "inactive" };
  if (!record.mfaEnrolled) return { ok: false, reason: "not-enrolled" };

  if (isLocked(record, Date.now())) {
    await recordSecurityEvent({
      actor: email,
      event: "access_denied",
      outcome: "denied",
      detail: "code submitted while locked out",
      clientHash: input.clientHash ?? null,
    });
    return { ok: false, reason: "locked", lockedUntil: record.lockedUntil };
  }

  const submitted = input.code.trim();

  // A recovery code is longer than six digits, so the two are told apart by
  // shape rather than by asking the person which one they are holding.
  if (normaliseRecoveryCode(submitted).length > 8) {
    const redeemed = await redeemRecoveryCode(email, submitted);
    if (redeemed) {
      await database()
        .prepare(
          `UPDATE staff_users SET failed_attempts = 0, locked_until = NULL, updated_at = ?
           WHERE email = ?`,
        )
        .bind(new Date().toISOString(), email)
        .run();
      await recordSecurityEvent({
        actor: email,
        event: "recovery_code_used",
        outcome: "allowed",
        clientHash: input.clientHash ?? null,
      });
      return { ok: true, sessionEpoch: record.sessionEpoch, usedRecoveryCode: true };
    }
    return registerFailure(record);
  }

  const stored = await readSecret(email);
  if (!stored) return { ok: false, reason: "not-enrolled" };

  const verification = await verifyTotp(stored.secret, submitted, {
    minCounter: stored.lastCounter,
  });
  if (!verification.ok) return registerFailure(record);

  await database()
    .prepare(
      `UPDATE staff_users
       SET totp_last_counter = ?, failed_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE email = ?`,
    )
    .bind(verification.counter, new Date().toISOString(), email)
    .run();

  await recordSecurityEvent({
    actor: email,
    event: "mfa_verified",
    outcome: "allowed",
    clientHash: input.clientHash ?? null,
  });
  return { ok: true, sessionEpoch: record.sessionEpoch, usedRecoveryCode: false };
}

/**
 * Burns one recovery code.
 *
 * Single use is enforced by the `used_at IS NULL` predicate inside the UPDATE
 * rather than by reading and then writing, so two simultaneous submissions of
 * the same code cannot both succeed.
 */
async function redeemRecoveryCode(email: string, submitted: string): Promise<boolean> {
  const candidate = await hashRecoveryCode(submitted);
  const result = await database()
    .prepare(
      `UPDATE staff_recovery_codes SET used_at = ?
       WHERE email = ? AND code_hash = ? AND used_at IS NULL`,
    )
    .bind(new Date().toISOString(), email, candidate)
    .run();
  if ((result.meta.changes ?? 0) > 0) return true;

  // Nothing matched. Confirm against the stored digests anyway so the comparison
  // path is the same length whether or not the account has codes at all.
  const rows = await database()
    .prepare("SELECT code_hash AS hash FROM staff_recovery_codes WHERE email = ?")
    .bind(email)
    .all<{ hash: string }>();
  for (const row of rows.results ?? []) digestsMatch(row.hash, candidate);
  return false;
}

/**
 * Clears somebody's second factor so they can enrol a new phone.
 *
 * Bumps the session epoch, which ends every session they currently hold: a reset
 * that left the old browser signed in would be useless the one time it matters,
 * when the phone was stolen rather than replaced.
 */
export async function resetMfa(input: { email: string; actor: string }): Promise<void> {
  await ensureStaffSchema();
  const email = normaliseEmail(input.email);
  const record = await getStaffRecord(email);
  if (!record) throw new Error("That staff member is not in the directory.");

  const db = database();
  await db.batch([
    db
      .prepare(
        `UPDATE staff_users
         SET totp_secret = NULL, totp_confirmed_at = NULL, totp_last_counter = 0,
             failed_attempts = 0, locked_until = NULL,
             session_epoch = session_epoch + 1, updated_at = ?
         WHERE email = ?`,
      )
      .bind(new Date().toISOString(), email),
    db.prepare("DELETE FROM staff_recovery_codes WHERE email = ?").bind(email),
  ]);

  await recordSecurityEvent({
    actor: input.actor,
    event: "mfa_reset",
    outcome: "changed",
    subject: email,
    detail: input.actor === email ? "self-service" : "reset by an owner",
  });
}
