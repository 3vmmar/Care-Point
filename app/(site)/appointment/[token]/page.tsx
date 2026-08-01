import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppointmentByManageToken } from "@/db/bookings";
import { CONTACT, DOCTOR, findBranch, serviceLabel } from "@/lib/clinic";
import { formatFullDate, formatSlotTime } from "@/lib/dates";
import { copyFor, isLanguage } from "@/lib/i18n";
import ManageBooking from "./ManageBooking";

export const metadata: Metadata = {
  title: "Your appointment",
  // The token is in the URL; this page must never be indexed or archived.
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function AppointmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const appointment = await getAppointmentByManageToken(token);
  if (!appointment) notFound();

  const language = isLanguage(appointment.language) ? appointment.language : "en";
  const t = copyFor(language);
  const rtl = language === "ar";
  const branch = findBranch(appointment.branch);
  const cancelled = appointment.status === "cancelled";

  return (
    <main className="manage-page" dir={rtl ? "rtl" : "ltr"} lang={language}>
      <div className="manage-card">
        <span className="manage-kicker">CARE POINT · {appointment.id.slice(0, 8).toUpperCase()}</span>
        <h1>
          {cancelled
            ? rtl
              ? "تم إلغاء هذا الموعد."
              : "This appointment is cancelled."
            : rtl
              ? "تفاصيل موعدك."
              : "Your appointment."}
        </h1>

        <dl className="manage-details">
          <div>
            <dt>{rtl ? "الموعد" : "When"}</dt>
            <dd>
              {formatFullDate(appointment.slotDate, t.intlLocale)}
              <strong>{formatSlotTime(appointment.slotTime, t.intlLocale)}</strong>
            </dd>
          </div>
          <div>
            <dt>{rtl ? "المكان" : "Where"}</dt>
            <dd>
              {branch ? (rtl ? branch.ar : branch.en) : appointment.branch}
              <small>{branch ? (rtl ? branch.addressAr : branch.addressEn) : ""}</small>
            </dd>
          </div>
          <div>
            <dt>{rtl ? "الاستشارة" : "Consultation"}</dt>
            <dd>
              {serviceLabel(appointment.service, language)}
              <small>{rtl ? DOCTOR.nameAr : DOCTOR.nameEn}</small>
            </dd>
          </div>
        </dl>

        {branch && (
          <a
            className="manage-map"
            href={branch.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.openInMaps} →
          </a>
        )}

        {!cancelled && (
          <ManageBooking
            token={token}
            language={language}
            branch={appointment.branch}
            service={appointment.service}
            slotDate={appointment.slotDate}
            slotTime={appointment.slotTime}
          />
        )}

        <div className="manage-footer">
          <a href={`tel:${CONTACT.phone}`}>{t.callClinic}</a>
          <Link href="/">{rtl ? "الصفحة الرئيسية" : "Back to the site"}</Link>
        </div>
      </div>
    </main>
  );
}
