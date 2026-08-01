"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import Modal from "@/app/components/Modal";
import { BRANCHES, SERVICE_CATEGORIES, SERVICES, servicesInCategory } from "@/lib/clinic";
import { formatShortDate } from "@/lib/dates";

type AvailabilityDay = { date: string; slots: string[] };

/**
 * Reception-side booking.
 *
 * Most of a clinic's appointments arrive by phone or at the desk. Without a way
 * to record them the dashboard only ever shows website traffic, which makes the
 * day view an unreliable schedule and the reporting meaningless.
 */
export default function AddAppointment({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [branch, setBranch] = useState(BRANCHES[0].id);
  const [service, setService] = useState(SERVICES[0].id);
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [slotDate, setSlotDate] = useState("");
  const [slotTime, setSlotTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /**
   * Open slots for the chosen clinic **and consultation type**.
   *
   * The service was previously left out of this request, so the form listed slots
   * generated for the default 45-minute consultation whatever reception had
   * selected. Booking a 60-minute one into a 45-minute slot was then refused by
   * the server — safe, but it looked like a bug in the dashboard. Now that the
   * clinic can edit durations, the two would diverge further with every change.
   */
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/availability?branch=${encodeURIComponent(branch)}&service=${encodeURIComponent(service)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as { dates?: AvailabilityDay[] };
      })
      .then((data) => {
        const dates = data.dates ?? [];
        setDays(dates);
        setSlotDate(dates.find((day) => day.slots.length > 0)?.date ?? dates[0]?.date ?? "");
        setSlotTime("");
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError("Could not load open slots. Check the connection and try again.");
      });
    return () => controller.abort();
  }, [branch, service]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/clinic/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          service,
          slotDate,
          slotTime,
          patientName: form.get("name"),
          patientPhone: form.get("phone"),
          patientEmail: form.get("email"),
          staffNote: form.get("note"),
          language: form.get("language"),
          source: form.get("source"),
        }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "That appointment did not save.");
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That appointment did not save.");
    } finally {
      setSaving(false);
    }
  }

  const selectedDay = days.find((day) => day.date === slotDate);

  return (
    <Modal onClose={onClose} layerClassName="modal-layer command-modal-layer" labelledBy="add-appointment-title">
      <form className="add-appointment" onSubmit={submit}>
        <header>
          <div>
            <span>DESK BOOKING</span>
            <h2 id="add-appointment-title">Add an appointment</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="add-grid">
          <label>
            <span>Clinic</span>
            <select value={branch} onChange={(event) => setBranch(event.target.value as typeof branch)}>
              {BRANCHES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.en}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Consultation</span>
            <select value={service} onChange={(event) => setService(event.target.value)}>
              {SERVICE_CATEGORIES.map((category) => (
                <optgroup key={category.id} label={category.en}>
                  {servicesInCategory(category.id).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.en} · {item.durationMinutes} min
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span>Day</span>
            <select
              value={slotDate}
              onChange={(event) => {
                setSlotDate(event.target.value);
                setSlotTime("");
              }}
            >
              {days.map((day) => (
                <option key={day.date} value={day.date} disabled={day.slots.length === 0}>
                  {formatShortDate(day.date)}
                  {day.slots.length === 0 ? " — full" : ` — ${day.slots.length} free`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Time</span>
            <select value={slotTime} onChange={(event) => setSlotTime(event.target.value)} required>
              <option value="">Choose a time</option>
              {(selectedDay?.slots ?? []).map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Patient name</span>
            <input name="name" required maxLength={120} placeholder="Full name" />
          </label>
          <label>
            <span>Mobile number</span>
            <input name="phone" required pattern="[+()\d\s-]{7,20}" placeholder="+20 or 01…" />
          </label>
          <label>
            <span>Email (optional)</span>
            <input name="email" type="email" maxLength={200} placeholder="name@example.com" />
          </label>
          <label>
            <span>Booked via</span>
            <select name="source" defaultValue="phone">
              <option value="phone">Phone</option>
              <option value="walk_in">Walk-in</option>
              <option value="clinic">Clinic</option>
            </select>
          </label>
          <label>
            <span>Language</span>
            <select name="language" defaultValue="en">
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </select>
          </label>
          <label className="add-full">
            <span>Clinic note (optional)</span>
            <input name="note" maxLength={500} placeholder="Referral, follow-up, anything the team should know" />
          </label>
        </div>

        {error && (
          <p className="add-error" role="alert">
            {error}
          </p>
        )}

        <footer>
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="add-primary" disabled={saving || !slotTime}>
            {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            Save appointment
          </button>
        </footer>
      </form>
    </Modal>
  );
}
