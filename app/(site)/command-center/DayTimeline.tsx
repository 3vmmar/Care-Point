"use client";

import { Plus } from "lucide-react";
import { BRANCHES, serviceLabel, type Branch } from "@/lib/clinic";
import { generateSlots } from "@/lib/schedule";
import { formatSlotTime } from "@/lib/dates";
import type { Appointment, LiveCatalogue } from "./types";

/**
 * The clinic day as a column of its actual consultation slots.
 *
 * A list of bookings answers "who is coming"; it does not answer "where are my
 * gaps", which is the question that decides whether reception can fit someone
 * in this afternoon. Every published slot is drawn whether or not it is taken,
 * so an empty 16:30 is as visible as a full one.
 */
export default function DayTimeline({
  appointments,
  branchFilter,
  clinicDate,
  clinicTime,
  onPick,
  onAdd,
  catalogue,
}: {
  appointments: Appointment[];
  branchFilter: string;
  clinicDate: string;
  clinicTime: string;
  onPick: (id: string) => void;
  onAdd: () => void;
  /** Null until the first dashboard load returns. */
  catalogue: LiveCatalogue | null;
}) {
  /**
   * Drawn from the live rota, not the constants.
   *
   * The clinic edits its hours in Clinic OS now, so a timeline built from
   * `lib/clinic.ts` would show the timetable the code was deployed with while the
   * booking page offered the one reception had just set. Falls back to the
   * constants only before the first load has returned.
   */
  const all: Branch[] = catalogue?.branches ?? BRANCHES;
  const branches = branchFilter ? all.filter((branch) => branch.id === branchFilter) : all;
  const context = catalogue
    ? {
        services: catalogue.services,
        closures: catalogue.closures,
        turnaround: catalogue.turnaroundMinutes,
      }
    : {};

  // One row per distinct start time actually running today, generated from the
  // day's sessions. A branch that does not open today contributes nothing,
  // which is the point of moving off a fixed per-branch slot list.
  const openings = branches.flatMap((branch) =>
    generateSlots(branch, clinicDate, "aesthetic", context).map((slot) => ({
      branch,
      time: slot.time,
      practitioner: slot.practitioner,
    })),
  );
  const times = Array.from(new Set(openings.map((o) => o.time))).sort();

  const live = appointments.filter(
    (item) => item.status !== "cancelled" && item.status !== "no_show",
  );

  if (times.length === 0) {
    return (
      <div className="empty-state">
        <p>No consultation sessions run today at the selected clinic.</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {times.map((time) => {
        const inSlot = live.filter((item) => item.slotTime === time);
        const past = time < clinicTime;
        const free = openings.filter(
          (opening) =>
            opening.time === time &&
            !inSlot.some((item) => item.branch === opening.branch.id),
        );

        return (
          <div
            key={time}
            className={`timeline-row${past ? " timeline-row--past" : ""}${
              inSlot.length === 0 ? " timeline-row--free" : ""
            }`}
          >
            <div className="timeline-time">
              <strong>{formatSlotTime(time)}</strong>
              {!past && inSlot.length === 0 && <small>free</small>}
            </div>

            <div className="timeline-body">
              {inSlot.map((item) => (
                <button
                  key={item.id}
                  className={`timeline-card timeline-card--${item.status}`}
                  onClick={() => onPick(item.id)}
                >
                  <strong>{item.patientName ?? "Unnamed"}</strong>
                  <small>
                    {serviceLabel(item.service)} · {item.branch}
                    {item.durationMinutes ? ` · ${item.durationMinutes} min` : ""}
                  </small>
                </button>
              ))}

              {free.map((opening) => (
                <button
                  key={`${opening.branch.id}-${opening.practitioner}`}
                  className="timeline-open"
                  onClick={onAdd}
                  title={`Add a booking at ${opening.branch.en}, ${time}`}
                  disabled={past}
                >
                  <Plus size={13} />
                  {opening.branch.en} open
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
