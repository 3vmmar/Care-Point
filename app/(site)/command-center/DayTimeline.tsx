"use client";

import { Plus } from "lucide-react";
import { BRANCHES, findBranch, serviceLabel } from "@/lib/clinic";
import { generateSlots } from "@/lib/schedule";
import { formatSlotTime } from "@/lib/dates";
import type { Appointment } from "./types";

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
}: {
  appointments: Appointment[];
  branchFilter: string;
  clinicDate: string;
  clinicTime: string;
  onPick: (id: string) => void;
  onAdd: () => void;
}) {
  const branches = branchFilter
    ? [findBranch(branchFilter)].filter(Boolean).map((b) => b!)
    : BRANCHES;

  // One row per distinct start time actually running today, generated from the
  // day's sessions. A branch that does not open today contributes nothing,
  // which is the point of moving off a fixed per-branch slot list.
  const openings = branches.flatMap((branch) =>
    generateSlots(branch, clinicDate, "aesthetic").map((slot) => ({
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
