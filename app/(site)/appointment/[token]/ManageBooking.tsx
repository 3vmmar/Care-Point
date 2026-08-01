"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Loader2, X } from "lucide-react";
import { copyFor, type Language } from "@/lib/i18n";

type AvailabilityDay = {
  date: string;
  weekday: string;
  day: string;
  slots: string[];
};

export default function ManageBooking({
  token,
  language,
  branch,
  service,
  slotDate,
  slotTime,
}: {
  token: string;
  language: Language;
  branch: string;
  /**
   * The consultation actually booked.
   *
   * Without it the calendar below is generated for the *default* service, so a
   * 60-minute rhinoplasty is offered 45-minute spacing and a dental patient is
   * offered the surgeon's sessions — which the server then rejects, one slot at a
   * time, with no way for the patient to succeed.
   */
  service: string;
  slotDate: string;
  slotTime: string;
}) {
  const t = copyFor(language);
  const rtl = language === "ar";
  const [mode, setMode] = useState<"idle" | "reschedule" | "confirmCancel">("idle");
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [pickedDate, setPickedDate] = useState(slotDate);
  const [pickedTime, setPickedTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"cancelled" | "moved" | null>(null);
  /**
   * Optional, and asked *while* cancelling rather than in a follow-up nobody
   * answers. Never required: a patient who cannot cancel simply does not turn up,
   * which costs the clinic the slot and the goodwill.
   */
  const [reasons, setReasons] = useState<
    Array<{ code: string; labelEn: string; labelAr: string }>
  >([]);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (mode !== "confirmCancel" || reasons.length > 0) return;
    const controller = new AbortController();
    fetch(`/api/appointments/${token}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as {
          cancellationReasons?: Array<{ code: string; labelEn: string; labelAr: string }>;
        };
      })
      .then((data) => setReasons(data.cancellationReasons ?? []))
      .catch(() => {
        // The reason is a nicety. If the list will not load, the patient must
        // still be able to cancel.
      });
    return () => controller.abort();
  }, [mode, token, reasons.length]);

  useEffect(() => {
    if (mode !== "reschedule") return;
    const controller = new AbortController();
    fetch(
      `/api/availability?branch=${encodeURIComponent(branch)}&service=${encodeURIComponent(service)}&locale=${language}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as { dates?: AvailabilityDay[] };
      })
      .then((data) => {
        const dates = data.dates ?? [];
        setDays(dates);
        setPickedDate(dates.find((day) => day.slots.length > 0)?.date ?? "");
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(t.loadFailed);
      });
    return () => controller.abort();
  }, [mode, branch, service, language, t.loadFailed]);

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/appointments/${token}`, {
        method: "DELETE",
        // The header is required whether or not there is a body: the CSRF guard
        // rejects any mutation that is not declared as JSON, which is what
        // stops a cross-site HTML form from reaching these endpoints.
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message);
      setOutcome("cancelled");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!pickedDate || !pickedTime) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/appointments/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotDate: pickedDate, slotTime: pickedTime }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message);
      setOutcome("moved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  if (outcome) {
    return (
      <div className="manage-outcome" role="status">
        <Check size={18} />
        <p>
          {outcome === "cancelled"
            ? rtl
              ? "تم إلغاء موعدك. يمكنك الحجز مرة أخرى في أي وقت."
              : "Your appointment is cancelled. You can book again whenever you are ready."
            : rtl
              ? "تم نقل موعدك. سنرسل لك التفاصيل المحدثة."
              : "Your appointment has been moved. Updated details are on their way."}
        </p>
        {outcome === "moved" && (
          <a className="manage-ics" href={`/api/appointments/${token}/calendar`}>
            <CalendarDays size={15} />
            {t.addToCalendar}
          </a>
        )}
      </div>
    );
  }

  const selectedDay = days.find((day) => day.date === pickedDate);

  return (
    <div className="manage-actions">
      <a className="manage-ics" href={`/api/appointments/${token}/calendar`}>
        <CalendarDays size={15} />
        {t.addToCalendar}
      </a>

      {mode === "idle" && (
        <div className="manage-buttons">
          <button onClick={() => setMode("reschedule")}>
            {rtl ? "تغيير الموعد" : "Change time"}
          </button>
          <button className="manage-danger" onClick={() => setMode("confirmCancel")}>
            {rtl ? "إلغاء الموعد" : "Cancel appointment"}
          </button>
        </div>
      )}

      {mode === "confirmCancel" && (
        <div className="manage-confirm">
          <p>
            {rtl
              ? "هل أنت متأكد من إلغاء هذا الموعد؟"
              : "Are you sure you want to cancel this appointment?"}
          </p>
          {reasons.length > 0 && (
            <div className="manage-reason">
              <label htmlFor="cancel-reason">
                {rtl
                  ? "لماذا تلغي الموعد؟ (اختياري)"
                  : "Why are you cancelling? (optional)"}
              </label>
              <select
                id="cancel-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="">
                  {rtl ? "أفضل عدم القول" : "Prefer not to say"}
                </option>
                {reasons.map((item) => (
                  <option key={item.code} value={item.code}>
                    {rtl ? item.labelAr : item.labelEn}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="manage-buttons">
            <button className="manage-danger" onClick={() => void cancel()} disabled={busy}>
              {busy ? <Loader2 size={15} className="manage-spin" /> : <X size={15} />}
              {rtl ? "نعم، ألغِ الموعد" : "Yes, cancel it"}
            </button>
            <button onClick={() => setMode("idle")} disabled={busy}>
              {rtl ? "تراجع" : "Keep it"}
            </button>
          </div>
        </div>
      )}

      {mode === "reschedule" && (
        <div className="manage-reschedule">
          <p>{t.selectDateFirst}</p>
          <div className="manage-dates">
            {days.map((day) => (
              <button
                key={day.date}
                className={pickedDate === day.date ? "active" : ""}
                disabled={day.slots.length === 0}
                onClick={() => {
                  setPickedDate(day.date);
                  setPickedTime("");
                }}
              >
                <small>{day.weekday}</small>
                <strong>{day.day}</strong>
              </button>
            ))}
          </div>
          <div className="manage-slots">
            {(selectedDay?.slots ?? []).map((time) => (
              <button
                key={time}
                className={pickedTime === time ? "active" : ""}
                onClick={() => setPickedTime(time)}
                aria-pressed={pickedTime === time}
              >
                {time}
              </button>
            ))}
          </div>
          <div className="manage-buttons">
            <button
              className="manage-primary"
              onClick={() => void reschedule()}
              disabled={!pickedTime || busy}
            >
              {busy ? <Loader2 size={15} className="manage-spin" /> : <Check size={15} />}
              {rtl ? "أكّد الموعد الجديد" : "Confirm new time"}
            </button>
            <button onClick={() => setMode("idle")} disabled={busy}>
              {t.back}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="manage-error" role="alert">
          {error}
        </p>
      )}
      <p className="manage-note">
        {rtl
          ? `الموعد الحالي: ${slotTime}. للتغييرات العاجلة تواصل مع العيادة مباشرة.`
          : `Current time: ${slotTime}. For urgent changes, please call the clinic.`}
      </p>
    </div>
  );
}
