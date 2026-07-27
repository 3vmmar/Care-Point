import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    createdAt: text("created_at").notNull(),
    holdExpiresAt: text("hold_expires_at"),
    confirmedAt: text("confirmed_at"),
  },
  (table) => [
    uniqueIndex("appointments_slot_unique").on(
      table.branch,
      table.slotDate,
      table.slotTime,
    ),
  ],
);
