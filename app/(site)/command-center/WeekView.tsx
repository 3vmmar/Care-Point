"use client";

import { serviceLabel } from "@/lib/clinic";
import { formatShortDate, formatSlotTime } from "@/lib/dates";
import type { Appointment, CapacityDay } from "./types";

/**
 * The fortnight ahead, one column per day.
 *
 * The day view answers "what is happening now"; this answers "when am I busy",
 * which is the question behind theatre lists, travel and leave. Utilisation is
 * shown against real published capacity rather than as a raw count, so a light
 * day at one branch is not mistaken for a light day overall.
 */
export default function WeekView({
  appointments,
  capacity,
  clinicDate,
  onPick,
}: {
  appointments: Appointment[];
  capacity: CapacityDay[];
  clinicDate: string;
  onPick: (id: string) => void;
}) {
  const days = capacity.filter((day) => day.open).slice(0, 7);

  if (days.length === 0) {
    return (
      <div className="empty-state">
        <p>No open clinic days in the next fortnight.</p>
      </div>
    );
  }

  return (
    <div className="week-grid">
      {days.map((day) => {
        const forDay = appointments
          .filter(
            (item) =>
              item.slotDate === day.date &&
              item.status !== "cancelled" &&
              item.status !== "no_show",
          )
          .sort((a, b) => a.slotTime.localeCompare(b.slotTime));

        const heavy = day.percent >= 80;

        return (
          <section
            className={`week-column${day.date === clinicDate ? " week-column--today" : ""}`}
            key={day.date}
          >
            <header>
              <strong>{formatShortDate(day.date).split(" ")[0]}</strong>
              <small>{formatShortDate(day.date).split(" ").slice(1).join(" ")}</small>
            </header>

            <div className="week-load">
              <div className="week-bar" aria-hidden>
                <i
                  style={{ width: `${Math.min(100, day.percent)}%` }}
                  data-heavy={heavy || undefined}
                />
              </div>
              <span>
                {day.booked}/{day.total}
              </span>
            </div>

            <div className="week-items">
              {forDay.length === 0 ? (
                <p className="week-empty">Nothing booked</p>
              ) : (
                forDay.map((item) => (
                  <button key={item.id} onClick={() => onPick(item.id)}>
                    <strong>{formatSlotTime(item.slotTime)}</strong>
                    <span>{item.patientName ?? "Unnamed"}</span>
                    <small>{serviceLabel(item.service)}</small>
                  </button>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
