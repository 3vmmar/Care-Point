import { env } from "cloudflare:workers";
import { clinicToday } from "@/lib/dates";
import { recordAccess } from "@/db/audit";
import { reportError } from "@/lib/observability";

/**
 * Data-subject requests — the mechanism behind a patient asking for a copy of
 * their data, a correction, or its erasure.
 *
 * Two decisions shape this module, and both are deliberate:
 *
 * 1. **A request is a queue item, never an action.** The public endpoint records
 *    the request and stops. Acting on a phone number alone would mean anyone who
 *    knows a patient's number could pull their appointment history or destroy
 *    it — turning a privacy feature into the best data-exfiltration route in the
 *    system. The clinic establishes identity out of band, then staff fulfil it.
 *
 * 2. **Erasure anonymises, it does not delete.** The appointment row survives
 *    with its date, branch and service so the clinic keeps accurate operational
 *    history; every identifying field is cleared. Whether a medical practice may
 *    erase treatment records at all is a question for the practice's lawyer —
 *    see docs/PRODUCTION-PLAN.md §6 — so this preserves the non-identifying
 *    skeleton rather than assuming either answer.
 */

export type DataRequestKind = "access" | "erase" | "correct";
export type DataRequestStatus = "pending" | "fulfilled" | "rejected";

export type DataRequest = {
  id: string;
  kind: DataRequestKind;
  status: DataRequestStatus;
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string | null;
  note: string | null;
  language: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  affectedCount: number | null;
};

const COLUMNS = `id, kind, status,
  requester_name AS requesterName, requester_phone AS requesterPhone,
  requester_email AS requesterEmail, note, language,
  created_at AS createdAt, resolved_by AS resolvedBy,
  resolved_at AS resolvedAt, resolution, affected_count AS affectedCount`;

function database() {
  if (!env.DB) throw new Error("The appointment database is not available.");
  return env.DB;
}

let ready: Promise<void> | null = null;

export function ensureDataRequestSchema(): Promise<void> {
  ready ??= createSchema().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

async function createSchema() {
  const db = database();
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS data_requests (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requester_name TEXT NOT NULL,
        requester_phone TEXT NOT NULL,
        requester_email TEXT,
        note TEXT,
        language TEXT NOT NULL DEFAULT 'en',
        client_hash TEXT,
        created_at TEXT NOT NULL,
        resolved_by TEXT,
        resolved_at TEXT,
        resolution TEXT,
        affected_count INTEGER
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS data_requests_status ON data_requests (status, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS data_requests_phone ON data_requests (requester_phone)",
    ),
  ]);
}

/**
 * Phone numbers are entered inconsistently — `01501606307`, `+201501606307`,
 * `0150 160 6307` are one person. Matching on digits only, ignoring an Egyptian
 * country code, avoids an erasure that silently misses half someone's records.
 */
export function phoneKey(phone: string): string {
  // Order matters. Leading zeros come off first — they cover both the
  // international `00` prefix and the national trunk `0` — because stripping
  // the country code first leaves `00201501606307` and `(020) 150-160-6307`
  // resolving to a different person than `01501606307`, which would make an
  // erasure quietly miss records while reporting success.
  let digits = phone.replace(/\D/g, "").replace(/^0+/, "");

  // Only treat a leading `20` as Egypt's country code when the number is long
  // enough to still be a full subscriber number without it. A Cairo landline
  // written locally can legitimately begin `20`.
  if (digits.startsWith("20") && digits.length >= 11) {
    digits = digits.slice(2);
  }
  return digits.replace(/^0+/, "");
}

/* -------------------------------------------------------------------------- */
/* Submission                                                                  */
/* -------------------------------------------------------------------------- */

export async function submitDataRequest(input: {
  kind: DataRequestKind;
  requesterName: string;
  requesterPhone: string;
  requesterEmail?: string;
  note?: string;
  language?: string;
  clientHash?: string;
}): Promise<{ id: string }> {
  await ensureDataRequestSchema();
  const id = crypto.randomUUID();
  await database()
    .prepare(
      `INSERT INTO data_requests
       (id, kind, status, requester_name, requester_phone, requester_email,
        note, language, client_hash, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.kind,
      input.requesterName.trim(),
      input.requesterPhone.trim(),
      input.requesterEmail?.trim() || null,
      input.note?.trim() || null,
      input.language === "ar" ? "ar" : "en",
      input.clientHash ?? null,
      new Date().toISOString(),
    )
    .run();
  return { id };
}

/** Open requests submitted from the same caller in the last day. */
export async function recentRequestCount(clientHash: string): Promise<number> {
  await ensureDataRequestSchema();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const row = await database()
    .prepare(
      "SELECT COUNT(*) AS total FROM data_requests WHERE client_hash = ? AND created_at >= ?",
    )
    .bind(clientHash, since)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function listDataRequests(status?: DataRequestStatus) {
  await ensureDataRequestSchema();
  const where = status ? "WHERE status = ?" : "";
  const bindings = status ? [status] : [];
  const result = await database()
    .prepare(`SELECT ${COLUMNS} FROM data_requests ${where} ORDER BY created_at DESC LIMIT 200`)
    .bind(...bindings)
    .all<DataRequest>();
  return result.results ?? [];
}

export async function getDataRequest(id: string) {
  await ensureDataRequestSchema();
  return database()
    .prepare(`SELECT ${COLUMNS} FROM data_requests WHERE id = ?`)
    .bind(id)
    .first<DataRequest>();
}

/* -------------------------------------------------------------------------- */
/* Fulfilment                                                                  */
/* -------------------------------------------------------------------------- */

export type PatientRecord = {
  id: string;
  status: string;
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  patientNote: string | null;
  language: string;
  source: string;
  createdAt: string;
  confirmedAt: string | null;
  consentGivenAt: string | null;
  consentVersion: string | null;
};

/**
 * Everything held about one patient, for an access request.
 *
 * Staff notes are deliberately excluded: they are the clinic's own clinical
 * observations rather than the patient's supplied data, and releasing them
 * without clinical review is not a decision this code should make.
 */
export async function exportPatientData(phone: string): Promise<PatientRecord[]> {
  await ensureDataRequestSchema();
  const key = phoneKey(phone);
  if (!key) return [];

  const result = await database()
    .prepare(
      `SELECT id, status, branch, service, slot_date AS slotDate, slot_time AS slotTime,
              patient_name AS patientName, patient_phone AS patientPhone,
              patient_email AS patientEmail, patient_note AS patientNote,
              language, source, created_at AS createdAt, confirmed_at AS confirmedAt,
              consent_given_at AS consentGivenAt, consent_version AS consentVersion
       FROM appointments
       WHERE patient_phone IS NOT NULL
       ORDER BY slot_date DESC, slot_time DESC`,
    )
    .all<PatientRecord>();

  // Normalised in application code because SQLite cannot strip separators in a
  // way that stays index-friendly, and the volume here is a clinic's book.
  return (result.results ?? []).filter(
    (row) => phoneKey(row.patientPhone ?? "") === key,
  );
}

export type EraseOutcome =
  | { ok: true; erased: number }
  | { ok: false; reason: "upcoming-appointments"; upcoming: number }
  | { ok: false; reason: "not-found" };

/**
 * Anonymises every record for one patient.
 *
 * Refuses while they still have an upcoming appointment. Stripping the name and
 * number from a visit the clinic is about to run would leave a slot occupied by
 * a patient nobody can identify or contact — cancel it first, deliberately, so
 * the calendar and the erasure both stay honest.
 */
export async function erasePatientData(
  phone: string,
  actor: string,
): Promise<EraseOutcome> {
  await ensureDataRequestSchema();
  const records = await exportPatientData(phone);
  if (records.length === 0) return { ok: false, reason: "not-found" };

  const today = clinicToday();
  const upcoming = records.filter(
    (row) =>
      row.slotDate >= today && (row.status === "confirmed" || row.status === "checked_in"),
  );
  if (upcoming.length > 0) {
    return { ok: false, reason: "upcoming-appointments", upcoming: upcoming.length };
  }

  const timestamp = new Date().toISOString();
  const db = database();
  await db.batch(
    records.map((row) =>
      db
        .prepare(
          `UPDATE appointments
           SET patient_name = NULL, patient_phone = NULL, patient_email = NULL,
               patient_note = NULL, staff_note = NULL, manage_token = NULL,
               client_fingerprint = NULL, purged_at = ?
           WHERE id = ?`,
        )
        .bind(timestamp, row.id),
    ),
  );

  // Recorded against every affected appointment, because "we erased this on
  // request" is precisely the thing a controller must be able to evidence.
  for (const row of records) {
    await recordAccess({
      actor,
      action: "erase",
      subjectId: row.id,
      detail: "data-subject erasure",
    });
  }

  return { ok: true, erased: records.length };
}

export async function resolveDataRequest(input: {
  id: string;
  status: Exclude<DataRequestStatus, "pending">;
  actor: string;
  resolution: string;
  affectedCount?: number;
}): Promise<boolean> {
  await ensureDataRequestSchema();
  try {
    const result = await database()
      .prepare(
        `UPDATE data_requests
         SET status = ?, resolved_by = ?, resolved_at = ?, resolution = ?, affected_count = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(
        input.status,
        input.actor,
        new Date().toISOString(),
        input.resolution.slice(0, 500),
        input.affectedCount ?? null,
        input.id,
      )
      .run();
    return (result.meta.changes ?? 0) > 0;
  } catch (error) {
    await reportError(error, { where: "dsr: resolveDataRequest" });
    return false;
  }
}
