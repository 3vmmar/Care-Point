"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { branchLabel, serviceLabel } from "@/lib/clinic";
import { formatShortDate, formatSlotTime } from "@/lib/dates";
import { STATUS_META, type Appointment } from "./types";

/**
 * Previous visits for the same patient.
 *
 * Whether someone is new or returning changes how the consultation opens, and
 * it is the one thing a paper day sheet can never tell you. Fetched only when a
 * row is expanded — most rows never are, and the day view should stay light.
 */
export default function PatientHistory({ appointmentId }: { appointmentId: string }) {
  const [history, setHistory] = useState<Appointment[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/bookings/${appointmentId}/history`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as { history?: Appointment[] };
      })
      .then((data) => setHistory(data.history ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [appointmentId]);

  if (failed) {
    return <p className="history-note">Previous visits could not be loaded.</p>;
  }

  if (history === null) {
    return (
      <p className="history-note">
        <Loader2 size={13} className="spin" />
        Checking previous visits…
      </p>
    );
  }

  if (history.length === 0) {
    return (
      <p className="history-note history-note--new">
        <History size={13} />
        First visit — no earlier appointments on this number.
      </p>
    );
  }

  const attended = history.filter((item) => item.status === "completed").length;
  const missed = history.filter((item) => item.status === "no_show").length;

  return (
    <div className="history">
      <p className="history-head">
        <History size={13} />
        <span>
          <strong>Returning patient</strong>
          {" · "}
          {history.length} earlier appointment{history.length === 1 ? "" : "s"}
          {attended > 0 && `, ${attended} attended`}
          {missed > 0 && `, ${missed} missed`}
        </span>
      </p>
      <ul className="history-list">
        {history.slice(0, 5).map((item) => {
          const meta = STATUS_META[item.status];
          return (
            <li key={item.id}>
              <span className="history-when">
                {formatShortDate(item.slotDate)} · {formatSlotTime(item.slotTime)}
              </span>
              <span className="history-what">
                {serviceLabel(item.service)} · {branchLabel(item.branch)}
              </span>
              <span className={`status-pill status-pill--${meta?.tone ?? "confirmed"}`}>
                {meta?.label ?? item.status}
              </span>
              {item.staffNote && <span className="history-note-text">{item.staffNote}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
