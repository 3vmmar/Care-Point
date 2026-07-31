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
  | "clinic_webhook";

export function channelsForNotification(kind: NotificationKind): NotificationChannel[] {
  return kind === "data.request"
    ? ["clinic_email", "clinic_webhook"]
    : ["patient_email", "patient_whatsapp", "clinic_email", "clinic_webhook"];
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
