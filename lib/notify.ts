/**
 * Outbound notifications for booking events.
 *
 * A confirmed appointment that notifies nobody is the single most expensive
 * failure mode for a clinic: the patient assumes they are booked, and reception
 * never learns about it. This module is the delivery layer for that.
 *
 * Two transports, both optional and both configured purely with environment
 * variables so the clinic can switch provider without a code change:
 *
 *   NOTIFY_WEBHOOK_URL   POST the event as JSON. Works directly with Zapier,
 *                        Make, n8n, or a WhatsApp Business gateway.
 *   NOTIFY_WEBHOOK_TOKEN Optional bearer token for that webhook.
 *   RESEND_API_KEY       Transactional email via Resend's HTTP API.
 *   NOTIFY_FROM_EMAIL    From address for those emails.
 *   CLINIC_NOTIFY_EMAIL  Where the clinic's own copy is sent.
 *
 * Nothing here is allowed to fail a booking. Delivery runs after the row is
 * committed, every transport is wrapped, and an unconfigured deployment simply
 * logs instead — so the flow degrades to exactly today's behaviour rather than
 * to an error.
 */

import { CONTACT, DOCTOR, findBranch, serviceLabel } from "./clinic";
import { formatFullDate, formatSlotTime } from "./dates";

export type NotificationKind =
  | "booking.confirmed"
  | "booking.cancelled"
  | "booking.rescheduled"
  | "booking.reminder"
  /** A patient exercising a data right. Time-bound in law, so it is announced. */
  | "data.request";

export type NotificationPayload = {
  kind: NotificationKind;
  appointment: {
    id: string;
    branch: string;
    service: string;
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

/** Human-readable summary reused by every transport. */
export function describeAppointment(payload: NotificationPayload) {
  const { appointment } = payload;
  const locale = appointment.language === "ar" ? "ar" : "en";
  const branch = findBranch(appointment.branch);
  const intlLocale = locale === "ar" ? "ar-EG" : "en-GB";

  return {
    locale,
    headline: HEADLINE[payload.kind][locale],
    service: serviceLabel(appointment.service, locale),
    doctor: locale === "ar" ? DOCTOR.nameAr : DOCTOR.nameEn,
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
            <td style="padding:14px 16px;font-size:14px">${detail.doctor}</td></tr>
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
    appointment.patientNote ? `Note: ${appointment.patientNote}` : "",
    `Ref: ${appointment.id.slice(0, 8).toUpperCase()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function postWebhook(payload: NotificationPayload): Promise<boolean> {
  const url = env("NOTIFY_WEBHOOK_URL");
  if (!url) return false;

  const token = env("NOTIFY_WEBHOOK_TOKEN");
  const response = await fetch(url, {
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
  if (!response.ok) {
    throw new Error(`webhook responded ${response.status}`);
  }
  return true;
}

async function sendEmail(input: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}): Promise<boolean> {
  const key = env("RESEND_API_KEY");
  const from = env("NOTIFY_FROM_EMAIL");
  if (!key || !from) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`email provider responded ${response.status}`);
  }
  return true;
}

/**
 * Fire-and-forget delivery. Pass the result to `ctx.waitUntil` where available;
 * awaiting it is also safe because every transport is individually guarded.
 */
export async function notify(payload: NotificationPayload): Promise<{
  webhook: boolean;
  patientEmail: boolean;
  clinicEmail: boolean;
}> {
  const detail = describeAppointment(payload);
  const outcome = { webhook: false, patientEmail: false, clinicEmail: false };

  const attempts: Array<Promise<void>> = [
    (async () => {
      outcome.webhook = await postWebhook(payload);
    })(),
  ];

  if (payload.appointment.patientEmail) {
    attempts.push(
      (async () => {
        outcome.patientEmail = await sendEmail({
          to: payload.appointment.patientEmail!,
          subject: `${detail.headline} — ${detail.date}, ${detail.time}`,
          html: patientEmailBody(payload),
        });
      })(),
    );
  }

  const clinicInbox = env("CLINIC_NOTIFY_EMAIL");
  if (clinicInbox) {
    attempts.push(
      (async () => {
        outcome.clinicEmail = await sendEmail({
          to: clinicInbox,
          subject: `[Care Point] ${detail.headline} — ${detail.branchName} ${detail.date}`,
          text: clinicAlertText(payload),
        });
      })(),
    );
  }

  const results = await Promise.allSettled(attempts);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("notification delivery failed", result.reason);
    }
  }

  if (!outcome.webhook && !outcome.patientEmail && !outcome.clinicEmail) {
    // No transport configured. Logging keeps the event recoverable from worker
    // logs instead of vanishing, and makes the gap obvious during setup.
    console.warn(
      `[notify] no transport configured; ${payload.kind}\n${clinicAlertText(payload)}`,
    );
  }

  return outcome;
}

/**
 * Whether any transport is configured.
 *
 * Surfaced on the health endpoint because an unconfigured deployment fails in
 * the worst possible way: bookings succeed, patients believe they are booked,
 * and nobody at the clinic is ever told.
 */
export function notificationsConfigured(): boolean {
  return Boolean(
    env("NOTIFY_WEBHOOK_URL") || (env("RESEND_API_KEY") && env("NOTIFY_FROM_EMAIL")),
  );
}
