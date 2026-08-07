CREATE TABLE "access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject_id" text,
	"subject_count" integer DEFAULT 1 NOT NULL,
	"client_hash" text,
	"detail" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "access_log_action_valid" CHECK ("access_log"."action" IN ('list', 'view', 'update', 'create', 'export', 'erase'))
);
--> statement-breakpoint
CREATE TABLE "appointment_cells" (
	"branch" text NOT NULL,
	"practitioner" text NOT NULL,
	"slot_date" date NOT NULL,
	"cell_time" time NOT NULL,
	"appointment_id" text NOT NULL,
	CONSTRAINT "appointment_cells_branch_practitioner_slot_date_cell_time_pk" PRIMARY KEY("branch","practitioner","slot_date","cell_time")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"hold_token" text NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"branch" text NOT NULL,
	"service" text NOT NULL,
	"slot_date" date NOT NULL,
	"slot_time" time NOT NULL,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"practitioner" text,
	"patient_name" text,
	"patient_phone" text,
	"patient_email" text,
	"patient_note" text,
	"staff_note" text,
	"language" text DEFAULT 'en' NOT NULL,
	"source" text DEFAULT 'website' NOT NULL,
	"client_fingerprint" text,
	"consent_given_at" timestamp with time zone,
	"consent_version" text,
	"manage_token" text,
	"created_at" timestamp with time zone NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"status_updated_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"reminder_queued_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"cancellation_reason" text,
	"cancellation_note" text,
	CONSTRAINT "appointments_status_valid" CHECK ("appointments"."status" IN ('held', 'confirmed', 'checked_in', 'completed', 'no_show', 'cancelled')),
	CONSTRAINT "appointments_language_valid" CHECK ("appointments"."language" IN ('en', 'ar')),
	CONSTRAINT "appointments_duration_positive" CHECK ("appointments"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cancellation_reasons" (
	"code" text PRIMARY KEY NOT NULL,
	"label_en" text NOT NULL,
	"label_ar" text NOT NULL,
	"audience" text DEFAULT 'both' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cancellation_reasons_audience_valid" CHECK ("cancellation_reasons"."audience" IN ('patient', 'staff', 'both'))
);
--> statement-breakpoint
CREATE TABLE "clinic_branches" (
	"id" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"address_en" text NOT NULL,
	"address_ar" text NOT NULL,
	"map_url" text,
	"timezone" text DEFAULT 'Africa/Cairo' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_services" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"turnaround_minutes" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "clinic_services_duration_positive" CHECK ("clinic_services"."duration_minutes" > 0),
	CONSTRAINT "clinic_services_turnaround_valid" CHECK ("clinic_services"."turnaround_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requester_name" text NOT NULL,
	"requester_phone" text NOT NULL,
	"requester_email" text,
	"note" text,
	"language" text DEFAULT 'en' NOT NULL,
	"client_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"affected_count" integer,
	CONSTRAINT "data_requests_kind_valid" CHECK ("data_requests"."kind" IN ('access', 'erase', 'correct')),
	CONSTRAINT "data_requests_status_valid" CHECK ("data_requests"."status" IN ('pending', 'fulfilled', 'rejected')),
	CONSTRAINT "data_requests_language_valid" CHECK ("data_requests"."language" IN ('en', 'ar'))
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"provider" text,
	"status_code" integer,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"channel" text NOT NULL,
	"context_json" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"provider" text,
	"provider_message_id" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "notification_jobs_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notification_jobs_status_valid" CHECK ("notification_jobs"."status" IN ('pending', 'processing', 'retrying', 'blocked', 'delivered', 'skipped', 'dead')),
	CONSTRAINT "notification_jobs_subject_type_valid" CHECK ("notification_jobs"."subject_type" IN ('appointment', 'data_request')),
	CONSTRAINT "notification_jobs_kind_valid" CHECK ("notification_jobs"."kind" IN ('booking.confirmed', 'booking.cancelled', 'booking.rescheduled', 'booking.reminder', 'data.request')),
	CONSTRAINT "notification_jobs_channel_valid" CHECK ("notification_jobs"."channel" IN ('patient_email', 'patient_whatsapp', 'clinic_email', 'clinic_webhook', 'branch_sms')),
	CONSTRAINT "notification_jobs_attempts_valid" CHECK ("notification_jobs"."attempts" >= 0),
	CONSTRAINT "notification_jobs_max_attempts_valid" CHECK ("notification_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "pilot_checklist" (
	"item_key" text PRIMARY KEY NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "pilot_incidents_severity_valid" CHECK ("pilot_incidents"."severity" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "pilot_incidents_status_valid" CHECK ("pilot_incidents"."status" IN ('open', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "pilot_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"branch_id" text,
	"bookings" integer NOT NULL,
	"completed" integer NOT NULL,
	"no_shows" integer NOT NULL,
	"cancelled" integer NOT NULL,
	"notification_total" integer NOT NULL,
	"notification_failed" integer NOT NULL,
	"open_incidents" integer NOT NULL,
	"recommendation" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pilot_reviews_recommendation_valid" CHECK ("pilot_reviews"."recommendation" IN ('continue', 'investigate', 'stop'))
);
--> statement-breakpoint
CREATE TABLE "pilot_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'setup' NOT NULL,
	"branch_id" text,
	"start_date" date,
	"end_date" date,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pilot_settings_status_valid" CHECK ("pilot_settings"."status" IN ('setup', 'running', 'paused', 'complete')),
	CONSTRAINT "pilot_settings_decision_valid" CHECK ("pilot_settings"."decision" IN ('pending', 'go', 'extend', 'stop'))
);
--> statement-breakpoint
CREATE TABLE "practitioner_branches" (
	"practitioner_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "practitioner_branches_practitioner_id_branch_id_pk" PRIMARY KEY("practitioner_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "practitioners" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"credentials" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"practitioner_id" text,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"start_time" time,
	"end_time" time,
	"reason" text,
	"reason_ar" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "schedule_exceptions_kind_valid" CHECK ("schedule_exceptions"."kind" IN ('closed', 'added'))
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"event" text NOT NULL,
	"outcome" text NOT NULL,
	"subject" text,
	"detail" text,
	"client_hash" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "security_events_outcome_valid" CHECK ("security_events"."outcome" IN ('allowed', 'denied', 'changed'))
);
--> statement-breakpoint
CREATE TABLE "service_practitioners" (
	"service_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_practitioners_service_id_practitioner_id_pk" PRIMARY KEY("service_id","practitioner_id")
);
--> statement-breakpoint
CREATE TABLE "staff_recovery_codes" (
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_recovery_codes_email_code_hash_pk" PRIMARY KEY("email","code_hash")
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_digest" text NOT NULL,
	"device" text,
	"client_hash" text,
	"issued_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
--> statement-breakpoint
CREATE TABLE "staff_user_roles" (
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_user_roles_email_role_pk" PRIMARY KEY("email","role"),
	CONSTRAINT "staff_user_roles_role_valid" CHECK ("staff_user_roles"."role" IN ('owner', 'doctor', 'receptionist', 'privacy_admin', 'auditor'))
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"email" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"password_hash" text,
	"password_set_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"totp_secret" text,
	"totp_confirmed_at" timestamp with time zone,
	"totp_last_counter" integer DEFAULT 0 NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"session_epoch" integer DEFAULT 1 NOT NULL,
	"invited_by" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"interval_minutes" integer DEFAULT 30 NOT NULL,
	"categories" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "weekly_sessions_weekday_valid" CHECK ("weekly_sessions"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "weekly_sessions_interval_positive" CHECK ("weekly_sessions"."interval_minutes" > 0),
	CONSTRAINT "weekly_sessions_time_ordered" CHECK ("weekly_sessions"."end_time" > "weekly_sessions"."start_time")
);
--> statement-breakpoint
ALTER TABLE "appointment_cells" ADD CONSTRAINT "appointment_cells_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practitioner_practitioners_id_fk" FOREIGN KEY ("practitioner") REFERENCES "public"."practitioners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancellation_reason_cancellation_reasons_code_fk" FOREIGN KEY ("cancellation_reason") REFERENCES "public"."cancellation_reasons"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_services" ADD CONSTRAINT "clinic_services_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_job_id_notification_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."notification_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_reviews" ADD CONSTRAINT "pilot_reviews_branch_id_clinic_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."clinic_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_settings" ADD CONSTRAINT "pilot_settings_branch_id_clinic_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."clinic_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_branches" ADD CONSTRAINT "practitioner_branches_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_branches" ADD CONSTRAINT "practitioner_branches_branch_id_clinic_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."clinic_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_branch_id_clinic_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."clinic_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_practitioners" ADD CONSTRAINT "service_practitioners_service_id_clinic_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."clinic_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_practitioners" ADD CONSTRAINT "service_practitioners_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_recovery_codes" ADD CONSTRAINT "staff_recovery_codes_email_staff_users_email_fk" FOREIGN KEY ("email") REFERENCES "public"."staff_users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_email_staff_users_email_fk" FOREIGN KEY ("email") REFERENCES "public"."staff_users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user_roles" ADD CONSTRAINT "staff_user_roles_email_staff_users_email_fk" FOREIGN KEY ("email") REFERENCES "public"."staff_users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_invited_by_staff_users_email_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."staff_users"("email") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_sessions" ADD CONSTRAINT "weekly_sessions_branch_id_clinic_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."clinic_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_sessions" ADD CONSTRAINT "weekly_sessions_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_actor_at" ON "access_log" USING btree ("actor","at");--> statement-breakpoint
CREATE INDEX "access_log_subject" ON "access_log" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "access_log_at" ON "access_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "appointment_cells_appointment" ON "appointment_cells" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointments_status_date" ON "appointments" USING btree ("status","slot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_hold_token" ON "appointments" USING btree ("hold_token");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_manage_token" ON "appointments" USING btree ("manage_token");--> statement-breakpoint
CREATE INDEX "appointments_slot_date" ON "appointments" USING btree ("slot_date");--> statement-breakpoint
CREATE INDEX "appointments_branch_date_status" ON "appointments" USING btree ("branch","slot_date","status");--> statement-breakpoint
CREATE INDEX "cancellation_reasons_audience" ON "cancellation_reasons" USING btree ("audience","active");--> statement-breakpoint
CREATE INDEX "clinic_services_department" ON "clinic_services" USING btree ("department_id","active");--> statement-breakpoint
CREATE INDEX "data_requests_status" ON "data_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "data_requests_phone" ON "data_requests" USING btree ("requester_phone");--> statement-breakpoint
CREATE INDEX "notification_attempts_job" ON "notification_attempts" USING btree ("job_id","attempt_number");--> statement-breakpoint
CREATE INDEX "notification_jobs_due" ON "notification_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_jobs_subject" ON "notification_jobs" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "notification_jobs_created" ON "notification_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pilot_incidents_status" ON "pilot_incidents" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "pilot_reviews_week" ON "pilot_reviews" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX "pilot_reviews_created" ON "pilot_reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "practitioners_department" ON "practitioners" USING btree ("department_id","active");--> statement-breakpoint
CREATE INDEX "schedule_exceptions_branch_date" ON "schedule_exceptions" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "schedule_exceptions_practitioner_date" ON "schedule_exceptions" USING btree ("practitioner_id","date");--> statement-breakpoint
CREATE INDEX "security_events_actor_at" ON "security_events" USING btree ("actor","at");--> statement-breakpoint
CREATE INDEX "security_events_event_at" ON "security_events" USING btree ("event","at");--> statement-breakpoint
CREATE INDEX "security_events_at" ON "security_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "staff_recovery_codes_email" ON "staff_recovery_codes" USING btree ("email","used_at");--> statement-breakpoint
CREATE INDEX "staff_sessions_email" ON "staff_sessions" USING btree ("email","revoked_at");--> statement-breakpoint
CREATE INDEX "staff_sessions_expires" ON "staff_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "weekly_sessions_branch_day" ON "weekly_sessions" USING btree ("branch_id","weekday","active");--> statement-breakpoint
CREATE INDEX "weekly_sessions_practitioner_day" ON "weekly_sessions" USING btree ("practitioner_id","weekday","active");