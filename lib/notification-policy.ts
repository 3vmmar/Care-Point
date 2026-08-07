export const NOTIFICATION_KINDS = [
  "booking.confirmed",
  "booking.cancelled",
  "booking.rescheduled",
  "booking.reminder",
  "data.request",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationChannel =
  | "patient_email"
  | "patient_whatsapp"
  | "clinic_email"
  | "clinic_webhook"
  | "branch_sms";

export function channelsForNotification(kind: NotificationKind): NotificationChannel[] {
  if (kind === "data.request") return ["clinic_email", "clinic_webhook"];
  // Reminders go to the patient; texting the branch manager about every
  // upcoming visit they already have on the day sheet would train them to
  // ignore the channel that matters.
  if (kind === "booking.reminder") {
    return ["patient_email", "patient_whatsapp", "clinic_email", "clinic_webhook"];
  }
  return [
    "patient_email",
    "patient_whatsapp",
    "clinic_email",
    "clinic_webhook",
    "branch_sms",
  ];
}

/** Bounded exponential backoff: fast recovery first, no provider hammering. */
export function retryDelayMs(attemptNumber: number): number {
  const delays = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
  return delays[Math.min(Math.max(attemptNumber - 1, 0), delays.length - 1)];
}

export function retryDisposition(input: {
  attempts: number;
  maxAttempts: number;
  retryable: boolean;
}): "retrying" | "dead" {
  return input.retryable && input.attempts < input.maxAttempts ? "retrying" : "dead";
}
