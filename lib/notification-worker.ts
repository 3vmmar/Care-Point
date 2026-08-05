import {
  claimDueNotificationJobs,
  finishNotificationJob,
  loadNotificationSubject,
  releaseConfiguredNotificationJobs,
  type AppointmentNotificationSubject,
  type DataRequestNotificationSubject,
  type NotificationJob,
} from "@/db/notifications";
import {
  deliverNotificationChannel,
  notificationConfiguration,
  NotificationDeliveryError,
  type NotificationPayload,
} from "@/lib/notify";
import { scrubText } from "@/lib/observability";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function eventContext(job: NotificationJob): Partial<{
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  practitioner: string;
}> {
  if (!job.contextJson) return {};
  try {
    const value = JSON.parse(job.contextJson) as Record<string, unknown>;
    return Object.fromEntries(
      ["branch", "service", "slotDate", "slotTime", "practitioner"]
        .filter((key) => typeof value[key] === "string")
        .map((key) => [key, value[key]]),
    );
  } catch {
    return {};
  }
}

function manageUrl(token: string | null): string | undefined {
  const base = env("PUBLIC_SITE_URL") ?? env("SITE_URL");
  if (!token || !base) return undefined;
  try {
    return new URL(`/appointment/${token}`, base).toString();
  } catch {
    return undefined;
  }
}

function appointmentPayload(
  job: NotificationJob,
  subject: AppointmentNotificationSubject,
): NotificationPayload {
  const context = eventContext(job);
  return {
    kind: job.kind,
    appointment: {
      id: subject.id,
      branch: context.branch ?? subject.branch,
      service: context.service ?? subject.service,
      practitioner: context.practitioner ?? subject.practitioner,
      slotDate: context.slotDate ?? subject.slotDate,
      slotTime: context.slotTime ?? subject.slotTime,
      patientName: subject.patientName,
      patientPhone: subject.patientPhone,
      patientEmail: subject.patientEmail,
      patientNote: subject.patientNote,
      language: subject.language,
    },
    manageUrl: manageUrl(subject.manageToken),
  };
}

function dataRequestPayload(
  job: NotificationJob,
  subject: DataRequestNotificationSubject,
): NotificationPayload {
  return {
    kind: job.kind,
    appointment: {
      id: subject.id,
      branch: "—",
      service: `data request: ${subject.kind}`,
      slotDate: subject.createdAt.slice(0, 10),
      slotTime: "00:00",
      patientName: subject.requesterName,
      patientPhone: subject.requesterPhone,
      patientEmail: subject.requesterEmail,
      patientNote: subject.note,
      language: subject.language,
    },
  };
}

async function payloadFor(job: NotificationJob): Promise<NotificationPayload | null> {
  const subject = await loadNotificationSubject(job);
  if (!subject) return null;
  return job.subjectType === "appointment"
    ? appointmentPayload(job, subject as AppointmentNotificationSubject)
    : dataRequestPayload(job, subject as DataRequestNotificationSubject);
}

async function processJob(job: NotificationJob) {
  const payload = await payloadFor(job);
  if (!payload) {
    return finishNotificationJob(job, {
      outcome: "skipped",
      errorCode: "subject_missing",
      errorMessage: "The source record no longer exists.",
    });
  }

  try {
    const result = await deliverNotificationChannel(payload, job.channel);
    if (result.outcome === "delivered") {
      return finishNotificationJob(job, {
        outcome: "delivered",
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        statusCode: result.statusCode,
      });
    }
    return finishNotificationJob(job, {
      outcome: result.outcome,
      provider: result.provider,
      errorCode: result.code,
      errorMessage: result.message,
    });
  } catch (error) {
    const deliveryError =
      error instanceof NotificationDeliveryError
        ? error
        : new NotificationDeliveryError(
            error instanceof Error ? error.message : "Unexpected delivery failure.",
            "unknown",
            "unexpected_error",
            true,
          );
    return finishNotificationJob(job, {
      outcome: deliveryError.retryable ? "retrying" : "dead",
      provider: deliveryError.provider,
      statusCode: deliveryError.statusCode,
      errorCode: deliveryError.code,
      errorMessage: scrubText(deliveryError.message).slice(0, 500),
      retryable: deliveryError.retryable,
    });
  }
}

export async function processNotificationQueue(limit = 25) {
  const providers = notificationConfiguration();
  await releaseConfiguredNotificationJobs([
    ...(providers.patientEmail ? (["patient_email"] as const) : []),
    ...(providers.patientWhatsApp ? (["patient_whatsapp"] as const) : []),
    ...(providers.clinicEmail ? (["clinic_email"] as const) : []),
    ...(providers.clinicWebhook ? (["clinic_webhook"] as const) : []),
  ]);
  const jobs = await claimDueNotificationJobs(limit);
  const summary = { claimed: jobs.length, delivered: 0, blocked: 0, skipped: 0, retrying: 0, dead: 0 };
  for (const job of jobs) {
    const status = await processJob(job);
    if (status in summary) summary[status as keyof typeof summary] += 1;
  }
  return summary;
}
