"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock3,
  Download,
  FileText,
  Loader2,
  Phone,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { branchLabel, serviceLabel } from "@/lib/clinic";
import { formatShortDate, formatSlotTime } from "@/lib/dates";

type Kind = "access" | "erase" | "correct";
type Status = "pending" | "fulfilled" | "rejected";

type DataRequest = {
  id: string;
  kind: Kind;
  status: Status;
  requesterName: string;
  requesterPhone: string;
  requesterEmail: string | null;
  note: string | null;
  language: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  affectedCount: number | null;
};

type PatientRecord = {
  id: string;
  status: string;
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  patientNote: string | null;
  createdAt: string;
  consentGivenAt: string | null;
  consentVersion: string | null;
};

const KIND_META: Record<Kind, { label: string; tone: string; blurb: string }> = {
  access: {
    label: "Copy of data",
    tone: "access",
    blurb: "Send the patient everything the clinic holds about them.",
  },
  correct: {
    label: "Correction",
    tone: "access",
    blurb: "Review what is held, then correct it on the appointment record.",
  },
  erase: {
    label: "Erasure",
    tone: "erase",
    blurb: "Permanently remove this patient's identifying details.",
  },
};

/** PDPL expects requests to be answered without undue delay. */
const DUE_DAYS = 30;

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * The data-subject request queue.
 *
 * Deliberately the only place erasure can be performed. The API refuses it
 * without an explicit confirmation, and this screen makes the staff member
 * state *why* they are confident of the requester's identity before that
 * confirmation is sent — because the clinic, not the code, is the thing that
 * verified who was on the phone.
 */
export default function DataRequests() {
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [filter, setFilter] = useState<Status | "">("pending");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, PatientRecord[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const query = filter ? `?status=${filter}` : "";
      const response = await fetch(`/api/clinic/data-requests${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not load data requests.");
      const data = (await response.json()) as { requests?: DataRequest[] };
      setRequests(data.requests ?? []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load data requests.");
    } finally {
      setLoaded(true);
    }
  }, [filter]);

  useEffect(() => {
    // Deferred so the first render commits before the fetch touches state,
    // matching how the rest of the dashboard loads.
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function act(request: DataRequest, action: "fulfil" | "reject") {
    setBusyId(request.id);
    setError("");
    try {
      const response = await fetch("/api/clinic/data-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: request.id,
          action,
          resolution: notes[request.id] ?? "",
          // Only ever sent for an erasure the staff member has explicitly ticked.
          ...(action === "fulfil" && request.kind === "erase"
            ? { confirmed: verified[request.id] === true }
            : {}),
        }),
      });
      const data = (await response.json()) as {
        message?: string;
        records?: PatientRecord[];
        erased?: number;
      };

      if (!response.ok) {
        // 409 upcoming-appointments and 428 confirmation-required are both
        // expected outcomes, not faults — surface them as guidance.
        throw new Error(data.message ?? "That request could not be actioned.");
      }

      if (data.records) {
        setRecords((current) => ({ ...current, [request.id]: data.records! }));
      }

      /**
       * Updated in place rather than refetched.
       *
       * Reloading here would re-apply the "pending" filter and drop the row the
       * staff member is looking at — taking the records they just produced with
       * it, before they have had a chance to download them. The row stays,
       * showing its new status, until they dismiss it.
       */
      setRequests((current) =>
        current.map((row) =>
          row.id === request.id
            ? {
                ...row,
                status: action === "fulfil" ? "fulfilled" : "rejected",
                resolution: notes[request.id] ?? row.resolution,
                affectedCount: data.records?.length ?? data.erased ?? row.affectedCount,
              }
            : row,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That request could not be actioned.");
    } finally {
      setBusyId(null);
    }
  }

  function exportRecords(request: DataRequest) {
    const rows = records[request.id] ?? [];
    const header = [
      "Reference",
      "Date",
      "Time",
      "Clinic",
      "Consultation",
      "Status",
      "Name",
      "Phone",
      "Email",
      "Patient note",
      "Booked at",
      "Consent given",
      "Consent version",
    ];
    const cell = (value: string | null | undefined) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      header.map(cell).join(","),
      ...rows.map((row) =>
        [
          row.id.slice(0, 8).toUpperCase(),
          row.slotDate,
          row.slotTime,
          branchLabel(row.branch),
          serviceLabel(row.service),
          row.status,
          row.patientName,
          row.patientPhone,
          row.patientEmail,
          row.patientNote,
          row.createdAt,
          row.consentGivenAt,
          row.consentVersion,
        ]
          .map(cell)
          .join(","),
      ),
    ].join("\r\n");

    // BOM so Excel reads Arabic names correctly rather than as mojibake.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `data-request-${request.id.slice(0, 8)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const overdue = useMemo(
    () => requests.filter((r) => r.status === "pending" && daysSince(r.createdAt) >= DUE_DAYS),
    [requests],
  );

  return (
    <section className="schedule-card">
      <div className="card-heading">
        <div>
          <span>PATIENT DATA REQUESTS</span>
          <h2>Access, correction and erasure</h2>
        </div>
        <div className="card-heading-actions">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as Status | "")}
            aria-label="Filter by status"
          >
            <option value="pending">Pending</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      <div className="dsr-intro">
        <ShieldAlert size={16} />
        <p>
          Verify the requester&rsquo;s identity <strong>before</strong> acting. These
          requests arrive from a public form, so a phone number alone proves nothing —
          call the number the clinic already holds, or confirm in person.
        </p>
      </div>

      {overdue.length > 0 && (
        <div className="dsr-overdue" role="alert">
          <AlertTriangle size={16} />
          <p>
            {overdue.length} request{overdue.length === 1 ? "" : "s"} older than {DUE_DAYS} days.
            These carry a legal response deadline.
          </p>
        </div>
      )}

      {error && (
        <div className="dsr-error" role="alert">
          <AlertTriangle size={15} />
          <p>{error}</p>
          <button onClick={() => setError("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      {!loaded ? (
        <div className="empty-state">
          <p>Loading requests…</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="empty-state">
          <FileText size={26} />
          <h3>No {filter || ""} requests</h3>
          <p>
            Requests submitted from the privacy page appear here for a staff member to
            verify and action.
          </p>
        </div>
      ) : (
        <div className="dsr-list">
          {requests.map((request) => {
            const meta = KIND_META[request.kind];
            const age = daysSince(request.createdAt);
            const open = openId === request.id;
            const rows = records[request.id];
            const busy = busyId === request.id;

            return (
              <article
                key={request.id}
                className={`dsr-row${open ? " dsr-row--open" : ""}`}
              >
                <div className="dsr-main">
                  <span className={`dsr-kind dsr-kind--${meta.tone}`}>{meta.label}</span>

                  <div className="dsr-who">
                    <strong>{request.requesterName}</strong>
                    <small>
                      <Phone size={11} />
                      {request.requesterPhone}
                      {request.requesterEmail && ` · ${request.requesterEmail}`}
                    </small>
                  </div>

                  <div className="dsr-age">
                    <strong>{age === 0 ? "Today" : `${age}d ago`}</strong>
                    <small>
                      {request.status === "pending" ? (
                        <>
                          <Clock3 size={11} />
                          {Math.max(0, DUE_DAYS - age)}d left
                        </>
                      ) : (
                        `${request.status} by ${request.resolvedBy ?? "—"}`
                      )}
                    </small>
                  </div>

                  <div className="dsr-actions">
                    {request.status === "pending" ? (
                      <button onClick={() => setOpenId(open ? null : request.id)}>
                        {open ? "Close" : "Review"}
                      </button>
                    ) : (
                      <span className={`status-pill status-pill--${request.status === "fulfilled" ? "completed" : "cancelled"}`}>
                        {request.status}
                      </span>
                    )}
                  </div>
                </div>

                {open && request.status === "pending" && (
                  <div className="dsr-detail">
                    <p className="dsr-blurb">{meta.blurb}</p>

                    {request.note && (
                      <p className="dsr-note">
                        <FileText size={14} />
                        <span>
                          <small>What the patient wrote</small>
                          {request.note}
                        </span>
                      </p>
                    )}

                    <label className="dsr-resolution">
                      <span>How was identity verified?</span>
                      <input
                        value={notes[request.id] ?? ""}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        maxLength={500}
                        placeholder="e.g. Called 0150… on file, confirmed DOB and last visit date"
                      />
                    </label>

                    {request.kind === "erase" && (
                      <label className="dsr-confirm">
                        <input
                          type="checkbox"
                          checked={verified[request.id] === true}
                          onChange={(event) =>
                            setVerified((current) => ({
                              ...current,
                              [request.id]: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          <strong>I have verified this person&rsquo;s identity.</strong>
                          Erasure cannot be undone. Contact details are removed permanently;
                          the anonymous visit record is kept for clinic history.
                        </span>
                      </label>
                    )}

                    <div className="dsr-buttons">
                      <button
                        className={request.kind === "erase" ? "dsr-danger" : "dsr-primary"}
                        disabled={
                          busy ||
                          (request.kind === "erase" && verified[request.id] !== true)
                        }
                        onClick={() => void act(request, "fulfil")}
                      >
                        {busy ? (
                          <Loader2 size={15} className="spin" />
                        ) : request.kind === "erase" ? (
                          <Trash2 size={15} />
                        ) : (
                          <Check size={15} />
                        )}
                        {request.kind === "erase" ? "Erase this patient's data" : "Produce the data"}
                      </button>
                      <button disabled={busy} onClick={() => void act(request, "reject")}>
                        <X size={15} />
                        Reject
                      </button>
                    </div>

                    {rows && (
                      <div className="dsr-records">
                        <div className="dsr-records-head">
                          <strong>
                            {rows.length} record{rows.length === 1 ? "" : "s"} held
                          </strong>
                          <button onClick={() => exportRecords(request)}>
                            <Download size={14} />
                            Download CSV
                          </button>
                        </div>
                        {rows.length === 0 ? (
                          <p className="dsr-empty-records">
                            Nothing is held under that phone number.
                          </p>
                        ) : (
                          <ul>
                            {rows.map((row) => (
                              <li key={row.id}>
                                <span>{formatShortDate(row.slotDate)}</span>
                                <span>{formatSlotTime(row.slotTime)}</span>
                                <span>{serviceLabel(row.service)}</span>
                                <span>{branchLabel(row.branch)}</span>
                                <span className="dsr-record-status">{row.status}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="dsr-records-note">
                          Clinic notes are excluded: they are the practice&rsquo;s clinical
                          observations, not data the patient supplied, and releasing them
                          needs clinical review.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {open && request.status !== "pending" && (
                  <div className="dsr-detail">
                    <p className="dsr-blurb">
                      {request.resolution ?? "No resolution was recorded."}
                      {typeof request.affectedCount === "number" &&
                        ` — ${request.affectedCount} record(s) affected.`}
                    </p>

                    {/* The produced data stays available until dismissed. */}
                    {rows && (
                      <div className="dsr-records">
                        <div className="dsr-records-head">
                          <strong>
                            {rows.length} record{rows.length === 1 ? "" : "s"} held
                          </strong>
                          <button onClick={() => exportRecords(request)}>
                            <Download size={14} />
                            Download CSV
                          </button>
                        </div>
                        {rows.length === 0 ? (
                          <p className="dsr-empty-records">
                            Nothing is held under that phone number.
                          </p>
                        ) : (
                          <ul>
                            {rows.map((row) => (
                              <li key={row.id}>
                                <span>{formatShortDate(row.slotDate)}</span>
                                <span>{formatSlotTime(row.slotTime)}</span>
                                <span>{serviceLabel(row.service)}</span>
                                <span>{branchLabel(row.branch)}</span>
                                <span className="dsr-record-status">{row.status}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="dsr-records-note">
                          Clinic notes are excluded: they are the practice&rsquo;s clinical
                          observations, not data the patient supplied, and releasing them
                          needs clinical review.
                        </p>
                      </div>
                    )}

                    <div className="dsr-buttons">
                      <button
                        onClick={() => {
                          setOpenId(null);
                          void load();
                        }}
                      >
                        <Check size={15} />
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
