/**
 * Outbound notifications for booking events.
 *
 * A confirmed appointment that notifies nobody is the single most expensive
 * failure mode for a clinic: the patient assumes they are booked, and reception
 * never learns about it. This module is the delivery layer for that.
 *
 * Every lifecycle event is first committed to the D1 outbox. This module owns
 * the provider adapters used by the queue worker; a provider failure changes a
 * job state, never the booking response.
 *
 *   NOTIFY_WEBHOOK_URL   Clinic-side automation webhook.
 *   NOTIFY_WEBHOOK_TOKEN Optional bearer token for that webhook.
 *   RESEND_API_KEY       Transactional email via Resend's HTTP API.
 *   NOTIFY_FROM_EMAIL    From address for those emails.
 *   CLINIC_NOTIFY_EMAIL  Where the clinic's own copy is sent.
 *   WHATSAPP_WEBHOOK_URL Clinic-owned WhatsApp Business gateway.
 *
 *   Branch SMS — the booking text to the branch manager's phone. Configure
 *   EITHER Twilio directly:
 *     SMS_TWILIO_ACCOUNT_SID / SMS_TWILIO_AUTH_TOKEN / SMS_FROM_NUMBER
 *   OR a clinic-owned SMS gateway (any provider behind your own endpoint,
 *   which is also how you switch providers without touching this code):
 *     SMS_WEBHOOK_URL / SMS_WEBHOOK_TOKEN
 *   Twilio wins when both are set. Credentials live in the environment only;
 *   unconfigured, jobs wait as `blocked` — visible in Clinic OS, never lost.
 */

import { CONTACT, findBranch, serviceLabel } from "./clinic.ts";
import { appointmentPractitioner } from "./appointment-presentation.ts";
import { formatFullDate, formatSlotTime } from "./dates.ts";
import type { NotificationChannel, NotificationKind } from "./notification-policy.ts";

export type { NotificationKind } from "./notification-policy.ts";

export type NotificationPayload = {
  kind: NotificationKind;
  appointment: {
    id: string;
    branch: string;
    service: string;
    practitioner?: string | null;
    slotDate: string;
    slotTime: string;
    patientName: string | null;
    patientPhone: string | null;
    patientEmail: string | null;
    patientNote?: string | null;
    language: string;
  };
  manageUrl?: string;
};

const HEADLINE: Record<NotificationKind, { en: string; ar: string }> = {
  "booking.confirmed": {
    en: "Your appointment is confirmed",
    ar: "تم تأكيد موعدك",
  },
  "booking.cancelled": {
    en: "Your appointment has been cancelled",
    ar: "تم إلغاء موعدك",
  },
  "booking.rescheduled": {
    en: "Your appointment has been moved",
    ar: "تم تغيير موعد زيارتك",
  },
  "booking.reminder": {
    en: "A reminder about tomorrow's appointment",
    ar: "تذكير بموعدك غداً",
  },
  "data.request": {
    en: "A patient has made a data request",
    ar: "طلب بيانات من أحد المرضى",
  },
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Human-readable summary reused by every transport. */
export function describeAppointment(payload: NotificationPayload) {
  const { appointment } = payload;
  const locale = appointment.language === "ar" ? "ar" : "en";
  const branch = findBranch(appointment.branch);
  const intlLocale = locale === "ar" ? "ar-EG" : "en-GB";
  const practitioner = appointmentPractitioner(
    appointment.service,
    appointment.practitioner,
  );

  return {
    locale,
    headline: HEADLINE[payload.kind][locale],
    service: serviceLabel(appointment.service, locale),
    // `doctor` is retained for existing webhook and WhatsApp integrations.
    // Its value now reflects the practitioner actually stored on the visit.
    doctor: practitioner,
    practitioner,
    branchName: branch ? (locale === "ar" ? branch.ar : branch.en) : appointment.branch,
    address: branch ? (locale === "ar" ? branch.addressAr : branch.addressEn) : "",
    mapUrl: branch?.mapUrl ?? "",
    date: formatFullDate(appointment.slotDate, intlLocale),
    time: formatSlotTime(appointment.slotTime, intlLocale),
  };
}

function patientEmailBody(payload: NotificationPayload): string {
  const detail = describeAppointment(payload);
  const rtl = detail.locale === "ar";
  const label = rtl
    ? { when: "الموعد", where: "المكان", clinic: "العيادة", directions: "الاتجاهات", manage: "إدارة الحجز" }
    : { when: "When", where: "Where", clinic: "Clinic", directions: "Directions", manage: "Manage booking" };

  return `<!doctype html>
<html lang="${detail.locale}" dir="${rtl ? "rtl" : "ltr"}">
  <body style="margin:0;background:#f2eee6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#282624">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px">
      <p style="letter-spacing:.16em;font-size:11px;color:#7b263c;margin:0 0 8px">CARE POINT</p>
      <h1 style="font-size:24px;font-weight:500;margin:0 0 24px">${detail.headline}</h1>
      <table style="width:100%;border-collapse:collapse;background:#fbf9f4;border:1px solid rgba(39,36,32,.14)">
        <tr><td style="padding:14px 16px;font-size:13px;color:#746f68">${label.when}</td>
            <td style="padding:14px 16px;font-size:14px;font-weight:600">${detail.date} · ${detail.time}</td></tr>
        <tr><td style="padding:14px 16px;font-size:13px;color:#746f68">${label.where}</td>
            <td style="padding:14px 16px;font-size:14px">${detail.branchName}<br><span style="color:#746f68;font-size:12px">${detail.address}</span></td></tr>
        <tr><td style="padding:14px 16px;font-size:13px;color:#746f68">${detail.service}</td>
            <td style="padding:14px 16px;font-size:14px">${escapeHtml(detail.practitioner)}</td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:13px">
        ${detail.mapUrl ? `<a href="${detail.mapUrl}" style="color:#7b263c">${label.directions} →</a><br><br>` : ""}
        ${payload.manageUrl ? `<a href="${payload.manageUrl}" style="color:#7b263c">${label.manage} →</a><br><br>` : ""}
        ${label.clinic}: <a href="tel:${CONTACT.phone}" style="color:#282624">${CONTACT.phoneDisplay}</a>
      </p>
    </div>
  </body>
</html>`;
}

function clinicAlertText(payload: NotificationPayload): string {
  const detail = describeAppointment(payload);
  const { appointment } = payload;
  return [
    `${payload.kind.replace("booking.", "").toUpperCase()} — ${detail.branchName}`,
    `${detail.date} · ${detail.time}`,
    `${appointment.patientName ?? "—"} · ${appointment.patientPhone ?? "—"}`,
    appointment.patientEmail ? `Email: ${appointment.patientEmail}` : "",
    `Consultation: ${detail.service}`,
    payload.kind === "data.request" ? "" : `Practitioner: ${detail.practitioner}`,
    appointment.patientNote ? `Note: ${appointment.patientNote}` : "",
    `Ref: ${appointment.id.slice(0, 8).toUpperCase()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export class NotificationDeliveryError extends Error {
  readonly provider: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    provider: string,
    code: string,
    retryable: boolean,
    statusCode?: number,
  ) {
    super(message);
    this.name = "NotificationDeliveryError";
    this.provider = provider;
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

export type NotificationDeliveryResult =
  | {
      outcome: "delivered";
      provider: string;
      providerMessageId?: string;
      statusCode?: number;
    }
  | { outcome: "blocked"; provider: string; code: string; message: string }
  | { outcome: "skipped"; provider: string; code: string; message: string };

function whatsappTemplate(kind: NotificationKind): string | undefined {
  const key: Record<Exclude<NotificationKind, "data.request">, string> = {
    "booking.confirmed": "WHATSAPP_TEMPLATE_CONFIRMED",
    "booking.cancelled": "WHATSAPP_TEMPLATE_CANCELLED",
    "booking.rescheduled": "WHATSAPP_TEMPLATE_RESCHEDULED",
    "booking.reminder": "WHATSAPP_TEMPLATE_REMINDER",
  };
  return kind === "data.request" ? undefined : env(key[kind]);
}

async function responseId(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as {
      id?: unknown;
      messageId?: unknown;
      /** Twilio calls its message id `sid`. */
      sid?: unknown;
    };
    const value = body.id ?? body.messageId ?? body.sid;
    return typeof value === "string" ? value.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

async function checkedFetch(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<{ id?: string; statusCode: number }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  } catch (error) {
    throw new NotificationDeliveryError(
      error instanceof Error ? error.message : "provider request failed",
      provider,
      "network_error",
      true,
    );
  }
  if (!response.ok) {
    throw new NotificationDeliveryError(
      `${provider} responded ${response.status}`,
      provider,
      `http_${response.status}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
      response.status,
    );
  }
  return { id: await responseId(response), statusCode: response.status };
}

async function deliverEmail(input: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}): Promise<NotificationDeliveryResult> {
  const key = env("RESEND_API_KEY");
  const from = env("NOTIFY_FROM_EMAIL");
  if (!key || !from) {
    return {
      outcome: "blocked",
      provider: "resend",
      code: "provider_not_configured",
      message: "Email delivery is not configured.",
    };
  }
  const result = await checkedFetch("resend", "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
    }),
  });
  return {
    outcome: "delivered",
    provider: "resend",
    providerMessageId: result.id,
    statusCode: result.statusCode,
  };
}

async function deliverClinicWebhook(
  payload: NotificationPayload,
): Promise<NotificationDeliveryResult> {
  const url = env("NOTIFY_WEBHOOK_URL");
  if (!url) {
    return {
      outcome: "blocked",
      provider: "clinic_webhook",
      code: "provider_not_configured",
      message: "The clinic webhook is not configured.",
    };
  }
  const token = env("NOTIFY_WEBHOOK_TOKEN");
  const result = await checkedFetch("clinic_webhook", url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      ...payload,
      summary: describeAppointment(payload),
      text: clinicAlertText(payload),
      sentAt: new Date().toISOString(),
    }),
  });
  return {
    outcome: "delivered",
    provider: "clinic_webhook",
    providerMessageId: result.id,
    statusCode: result.statusCode,
  };
}

async function deliverWhatsApp(
  payload: NotificationPayload,
): Promise<NotificationDeliveryResult> {
  const url = env("WHATSAPP_WEBHOOK_URL");
  const template = whatsappTemplate(payload.kind);
  if (!url || !template) {
    return {
      outcome: "blocked",
      provider: "whatsapp",
      code: "provider_not_configured",
      message: "WhatsApp delivery or its approved template is not configured.",
    };
  }
  if (!payload.appointment.patientPhone) {
    return {
      outcome: "skipped",
      provider: "whatsapp",
      code: "no_recipient",
      message: "The patient has no phone number.",
    };
  }
  const token = env("WHATSAPP_WEBHOOK_TOKEN");
  const detail = describeAppointment(payload);
  const result = await checkedFetch("whatsapp", url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      event: payload.kind,
      template,
      language: detail.locale,
      to: payload.appointment.patientPhone,
      appointmentId: payload.appointment.id,
      parameters: {
        patientName: payload.appointment.patientName,
        service: detail.service,
        doctor: detail.doctor,
        branch: detail.branchName,
        date: detail.date,
        time: detail.time,
        manageUrl: payload.manageUrl,
      },
    }),
  });
  return {
    outcome: "delivered",
    provider: "whatsapp",
    providerMessageId: result.id,
    statusCode: result.statusCode,
  };
}

/**
 * The booking text a branch manager receives.
 *
 * Staff-operations copy, deliberately compact and in English: it is read on a
 * lock screen between patients, not in an inbox. Every field the desk needs to
 * act without opening anything: who, how to reach them, what for, when, where,
 * and the reference that finds the row in Clinic OS. The note is truncated so
 * one long paragraph cannot turn a text into six billable segments.
 */
export function branchSmsText(payload: NotificationPayload): string {
  const detail = describeAppointment(payload);
  const heading: Record<string, string> = {
    "booking.confirmed": "New booking",
    "booking.cancelled": "CANCELLED",
    "booking.rescheduled": "Rescheduled",
    "booking.reminder": "Reminder",
    "data.request": "Data request",
  };
  const note = payload.appointment.patientNote?.trim();
  const lines = [
    `[Care Point] ${heading[payload.kind] ?? payload.kind} — ${detail.branchName}`,
    `${payload.appointment.patientName ?? "Unnamed patient"} · ${payload.appointment.patientPhone ?? "no phone"}`,
    `${detail.service} — ${detail.date}, ${detail.time}`,
    `Ref: ${payload.appointment.id}`,
    ...(note ? [`Note: ${note.length > 160 ? `${note.slice(0, 159)}…` : note}`] : []),
  ];
  return lines.join("\n");
}

async function deliverBranchSms(
  payload: NotificationPayload,
): Promise<NotificationDeliveryResult> {
  const branch = findBranch(payload.appointment.branch);
  // A legacy row whose branch string no longer matches still reaches a human:
  // the main clinic line is the documented fallback, not a dropped message.
  const to = branch?.smsPhone ?? CONTACT.phone;

  const twilioSid = env("SMS_TWILIO_ACCOUNT_SID");
  const twilioToken = env("SMS_TWILIO_AUTH_TOKEN");
  const from = env("SMS_FROM_NUMBER");
  const gatewayUrl = env("SMS_WEBHOOK_URL");

  if (twilioSid && twilioToken && from) {
    const result = await checkedFetch(
      "sms_twilio",
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: branchSmsText(payload) }),
      },
    );
    return {
      outcome: "delivered",
      provider: "sms_twilio",
      providerMessageId: result.id,
      statusCode: result.statusCode,
    };
  }

  if (gatewayUrl) {
    const token = env("SMS_WEBHOOK_TOKEN");
    const result = await checkedFetch("sms_gateway", gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        to,
        text: branchSmsText(payload),
        event: payload.kind,
        appointmentId: payload.appointment.id,
        branch: payload.appointment.branch,
      }),
    });
    return {
      outcome: "delivered",
      provider: "sms_gateway",
      providerMessageId: result.id,
      statusCode: result.statusCode,
    };
  }

  return {
    outcome: "blocked",
    provider: "sms",
    code: "provider_not_configured",
    message: "Branch SMS is not configured (Twilio or SMS_WEBHOOK_URL).",
  };
}

/** One durable queue job invokes exactly one channel. */
export async function deliverNotificationChannel(
  payload: NotificationPayload,
  channel: NotificationChannel,
): Promise<NotificationDeliveryResult> {
  const detail = describeAppointment(payload);
  if (channel === "patient_email") {
    if (!payload.appointment.patientEmail) {
      return {
        outcome: "skipped",
        provider: "resend",
        code: "no_recipient",
        message: "The patient did not provide an email address.",
      };
    }
    return deliverEmail({
      to: payload.appointment.patientEmail,
      subject: `${detail.headline} — ${detail.date}, ${detail.time}`,
      html: patientEmailBody(payload),
    });
  }
  if (channel === "patient_whatsapp") return deliverWhatsApp(payload);
  if (channel === "clinic_webhook") return deliverClinicWebhook(payload);
  if (channel === "branch_sms") return deliverBranchSms(payload);

  const inbox = env("CLINIC_NOTIFY_EMAIL");
  if (!inbox) {
    return {
      outcome: "blocked",
      provider: "resend",
      code: "provider_not_configured",
      message: "The clinic notification inbox is not configured.",
    };
  }
  return deliverEmail({
    to: inbox,
    subject: `[Care Point] ${detail.headline} — ${detail.branchName} ${detail.date}`,
    text: clinicAlertText(payload),
  });
}

export function notificationConfiguration() {
  const email = Boolean(env("RESEND_API_KEY") && env("NOTIFY_FROM_EMAIL"));
  const whatsapp = Boolean(
    env("WHATSAPP_WEBHOOK_URL") &&
      env("WHATSAPP_TEMPLATE_CONFIRMED") &&
      env("WHATSAPP_TEMPLATE_CANCELLED") &&
      env("WHATSAPP_TEMPLATE_RESCHEDULED") &&
      env("WHATSAPP_TEMPLATE_REMINDER"),
  );
  return {
    patientEmail: email,
    clinicEmail: email && Boolean(env("CLINIC_NOTIFY_EMAIL")),
    patientWhatsApp: whatsapp,
    clinicWebhook: Boolean(env("NOTIFY_WEBHOOK_URL")),
    branchSms: Boolean(
      (env("SMS_TWILIO_ACCOUNT_SID") &&
        env("SMS_TWILIO_AUTH_TOKEN") &&
        env("SMS_FROM_NUMBER")) ||
        env("SMS_WEBHOOK_URL"),
    ),
  };
}

/**
 * Whether any transport is configured.
 *
 * Surfaced on the health endpoint because an unconfigured deployment fails in
 * the worst possible way: bookings succeed, patients believe they are booked,
 * and nobody at the clinic is ever told.
 */
export function notificationsConfigured(): boolean {
  const configured = notificationConfiguration();
  return configured.clinicEmail || configured.clinicWebhook;
}
