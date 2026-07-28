import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Canonical appointment schema. `drizzle-kit generate` turns this into the
 * migrations under `drizzle/`, which the platform applies on deploy.
 *
 * The runtime in `db/bookings.ts` uses D1 prepared statements directly rather
 * than the Drizzle query builder, but mirrors this table exactly — keep the two
 * in step when adding a column.
 */
export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    holdToken: text("hold_token").notNull(),
    status: text("status").notNull().default("held"),
    branch: text("branch").notNull(),
    service: text("service").notNull(),
    slotDate: text("slot_date").notNull(),
    slotTime: text("slot_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(45),
    patientName: text("patient_name"),
    patientPhone: text("patient_phone"),
    patientEmail: text("patient_email"),
    language: text("language").notNull().default("en"),
    source: text("source").notNull().default("website"),
    /** Truncated hash of IP + user agent, used only to rate-limit holds. */
    clientFingerprint: text("client_fingerprint"),
    consentGivenAt: text("consent_given_at"),
    consentVersion: text("consent_version"),
    createdAt: text("created_at").notNull(),
    holdExpiresAt: text("hold_expires_at"),
    confirmedAt: text("confirmed_at"),
  },
  (table) => [
    // Makes holding a slot atomic: concurrent holds on the same slot collide
    // here instead of double-booking.
    uniqueIndex("appointments_slot_unique").on(
      table.branch,
      table.slotDate,
      table.slotTime,
    ),
    index("appointments_status_date").on(table.status, table.slotDate),
    index("appointments_hold_token").on(table.holdToken),
  ],
);
