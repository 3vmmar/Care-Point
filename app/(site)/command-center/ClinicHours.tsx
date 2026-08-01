"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Plus, Trash2, X } from "lucide-react";
import "./clinic-hours.css";

/**
 * The clinic's timetable, editable by the clinic.
 *
 * This is the screen that ends the practice's dependence on a developer for its
 * own opening hours. Three things live here, in the order they change: the weekly
 * rota, one-off closures, and how long each consultation takes.
 *
 * Every save is validated on the server against the *resulting* rota, so a change
 * that would put the surgeon in two branches at once is refused with the reason
 * rather than accepted and discovered by two patients arriving for one slot.
 */

type Session = {
  id: string;
  branchId: string;
  practitionerId: string;
  practitionerName: string;
  weekday: number;
  start: string;
  end: string;
  interval: number;
  categories: string[];
};

type Catalogue = {
  branches: Array<{ id: string; name: string }>;
  practitioners: Array<{ id: string; name: string; departmentId: string }>;
  categories: Array<{ id: string; en: string; ar: string }>;
  sessions: Session[];
  services: Array<{
    id: string;
    en: string;
    ar: string;
    category: string;
    durationMinutes: number;
    turnaroundMinutes: number;
  }>;
  closures: Array<{ date: string; en: string; ar: string }>;
  problems: Array<{ branch: string; message: string }>;
  live: boolean;
  canEdit: boolean;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Friday in Cairo. Shown but never offered, so nobody wonders where it went. */
const CLOSED_WEEKDAY = 5;

const BLANK: Omit<Session, "id" | "practitionerName"> = {
  branchId: "",
  practitionerId: "",
  weekday: 0,
  start: "16:00",
  end: "20:00",
  interval: 30,
  categories: [],
};

export default function ClinicHours() {
  const [data, setData] = useState<Catalogue | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<Session | null>(null);
  const [draft, setDraft] = useState<typeof BLANK & { id?: string }>(BLANK);
  const [closureDraft, setClosureDraft] = useState({ date: "", en: "", ar: "" });
  const [personDraft, setPersonDraft] = useState({
    id: "",
    nameEn: "",
    nameAr: "",
    departmentId: "",
    titleEn: "",
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/clinic/catalogue", { cache: "no-store" });
      const body = (await response.json()) as Catalogue & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Could not load the timetable.");
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the timetable.");
    }
  }, []);

  useEffect(() => {
    // Deferred so the first render commits before state changes, matching the
    // rest of the dashboard.
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function save(action: string, payload: Record<string, unknown>) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/clinic/catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = (await response.json()) as Catalogue & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "That change did not save.");
      setData(body);
      setNotice("Saved. The booking page is already offering the new hours.");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change did not save.");
      return false;
    } finally {
      setBusy("");
    }
  }

  if (!data) {
    return (
      <section className="schedule-card">
        <div className="card-heading">
          <div>
            <span>CLINIC HOURS</span>
            <h2>Loading the timetable…</h2>
          </div>
        </div>
        {error && (
          <p className="hours-message hours-message--error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  const readOnly = !data.canEdit;
  const byBranch = data.branches.map((branch) => ({
    ...branch,
    sessions: data.sessions
      .filter((session) => session.branchId === branch.id)
      .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)),
  }));

  function startNew(branchId: string) {
    setEditing(null);
    setDraft({
      ...BLANK,
      branchId,
      practitionerId: data!.practitioners[0]?.id ?? "",
      categories: [data!.categories[0]?.id ?? "surgical"],
    });
  }

  return (
    <>
      {/* ---------------- the weekly rota ---------------- */}
      <section className="schedule-card">
        <div className="card-heading">
          <div>
            <span>CLINIC HOURS</span>
            <h2>The weekly rota</h2>
          </div>
        </div>

        <p className="hours-lede">
          When each practitioner is at each branch. The booking page offers only
          times that fit inside a session, including the gap left between patients,
          so a change here takes effect immediately.
          {readOnly && " Only an owner or the doctor can change it."}
        </p>

        {!data.live && (
          <p className="hours-message hours-message--warn" role="alert">
            <AlertTriangle size={15} />
            Showing the timetable built into the code, because the database copy
            could not be read. Changes cannot be saved until that recovers.
          </p>
        )}

        {data.problems.length > 0 && (
          <div className="hours-message hours-message--error" role="alert">
            <strong>This timetable has problems that will affect bookings:</strong>
            <ul>
              {data.problems.map((problem) => (
                <li key={`${problem.branch}-${problem.message}`}>
                  {problem.branch}: {problem.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="hours-message hours-message--error" role="alert">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="hours-message hours-message--ok" role="status">
            <Check size={15} />
            {notice}
          </p>
        )}

        {byBranch.map((branch) => (
          <div className="hours-branch" key={branch.id}>
            <div className="hours-branch-head">
              <h3>{branch.name}</h3>
              {!readOnly && (
                <button type="button" onClick={() => startNew(branch.id)}>
                  <Plus size={14} />
                  Add a session
                </button>
              )}
            </div>

            {branch.sessions.length === 0 ? (
              <p className="hours-empty">
                No sessions yet, so this clinic offers no appointments at all.
              </p>
            ) : (
              <div className="hours-table-wrap">
                <table className="hours-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Time</th>
                      <th>Practitioner</th>
                      <th>Every</th>
                      <th>Bookable for</th>
                      {!readOnly && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {branch.sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          {DAYS[session.weekday]}
                          {session.weekday === CLOSED_WEEKDAY && (
                            <small>Closed weekday — never offered</small>
                          )}
                        </td>
                        <td>
                          {session.start} – {session.end}
                        </td>
                        <td>{session.practitionerName}</td>
                        <td>{session.interval} min</td>
                        <td>
                          {session.categories
                            .map(
                              (id) =>
                                data.categories.find((category) => category.id === id)?.en ?? id,
                            )
                            .join(", ") || "—"}
                        </td>
                        {!readOnly && (
                          <td>
                            <div className="hours-row-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing(session);
                                  setDraft({ ...session });
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={busy === "remove_session"}
                                onClick={() =>
                                  void save("remove_session", { id: session.id })
                                }
                                title="Existing appointments are kept; the slot simply stops being offered."
                              >
                                <Trash2 size={13} />
                                Remove
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {/* ---------------- session editor ---------------- */}
        {!readOnly && draft.branchId && (
          <div className="hours-editor">
            <div className="hours-editor-head">
              <h3>{editing ? "Change this session" : "New session"}</h3>
              <button
                type="button"
                className="icon-button"
                aria-label="Close the session editor"
                onClick={() => {
                  setEditing(null);
                  setDraft(BLANK);
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="hours-fields">
              <label>
                Clinic
                <select
                  value={draft.branchId}
                  onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}
                >
                  {data.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Day
                <select
                  value={draft.weekday}
                  onChange={(event) =>
                    setDraft({ ...draft, weekday: Number(event.target.value) })
                  }
                >
                  {DAYS.map((day, index) => (
                    <option key={day} value={index} disabled={index === CLOSED_WEEKDAY}>
                      {day}
                      {index === CLOSED_WEEKDAY ? " (closed)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Practitioner
                <select
                  value={draft.practitionerId}
                  onChange={(event) =>
                    setDraft({ ...draft, practitionerId: event.target.value })
                  }
                >
                  {data.practitioners.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Starts
                <input
                  type="time"
                  step={900}
                  value={draft.start}
                  onChange={(event) => setDraft({ ...draft, start: event.target.value })}
                />
              </label>
              <label>
                Ends
                <input
                  type="time"
                  step={900}
                  value={draft.end}
                  onChange={(event) => setDraft({ ...draft, end: event.target.value })}
                />
              </label>
              <label>
                Appointment every
                <select
                  value={draft.interval}
                  onChange={(event) =>
                    setDraft({ ...draft, interval: Number(event.target.value) })
                  }
                >
                  {[15, 30, 45, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="hours-categories">
              <legend>Bookable for</legend>
              {data.categories.map((category) => (
                <label key={category.id}>
                  <input
                    type="checkbox"
                    checked={draft.categories.includes(category.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        categories: event.target.checked
                          ? [...draft.categories, category.id]
                          : draft.categories.filter((id) => id !== category.id),
                      })
                    }
                  />
                  {category.en}
                </label>
              ))}
            </fieldset>

            <div className="hours-actions">
              <button
                type="button"
                className="hours-primary"
                disabled={busy === "session" || draft.categories.length === 0}
                onClick={async () => {
                  if (
                    await save("session", {
                      id: editing?.id,
                      branchId: draft.branchId,
                      practitionerId: draft.practitionerId,
                      weekday: draft.weekday,
                      start: draft.start,
                      end: draft.end,
                      interval: draft.interval,
                      categories: draft.categories,
                    })
                  ) {
                    setEditing(null);
                    setDraft(BLANK);
                  }
                }}
              >
                {busy === "session" ? "Checking…" : editing ? "Save changes" : "Add session"}
              </button>
            </div>
            <p className="hours-note">
              Checked against the whole rota before it saves: a practitioner cannot
              be booked into two places at the same time, and every time must fall
              on a quarter hour.
            </p>
          </div>
        )}
      </section>

      {/* ---------------- practitioners ---------------- */}
      <section className="schedule-card">
        <div className="card-heading">
          <div>
            <span>PRACTITIONERS</span>
            <h2>Who consults here</h2>
          </div>
        </div>
        <p className="hours-lede">
          The people the rota can be built around. Adding an associate or a second
          dentist here is what makes it possible to give them their own sessions —
          and their own room in the occupancy grid, so two clinicians at one address
          never collide.
        </p>

        <div className="hours-table-wrap">
          <table className="hours-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Line of care</th>
                <th>Sessions</th>
                {!readOnly && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.practitioners.map((person) => {
                const sessions = data.sessions.filter(
                  (session) => session.practitionerId === person.id,
                ).length;
                return (
                  <tr key={person.id}>
                    <td>
                      <strong>{person.name}</strong>
                      <small>{person.id}</small>
                    </td>
                    <td>
                      {data.categories.find((c) => c.id === person.departmentId)?.en ??
                        person.departmentId}
                    </td>
                    <td>{sessions}</td>
                    {!readOnly && (
                      <td>
                        <div className="hours-row-actions">
                          <button
                            type="button"
                            onClick={() =>
                              setPersonDraft({
                                id: person.id,
                                nameEn: person.name,
                                nameAr: "",
                                departmentId: person.departmentId,
                                titleEn: "",
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy === "remove_practitioner" || sessions > 0}
                            title={
                              sessions > 0
                                ? "Remove their sessions from the rota first"
                                : "Take them off the rota"
                            }
                            onClick={() =>
                              void save("remove_practitioner", { id: person.id })
                            }
                          >
                            <Trash2 size={13} />
                            Remove
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <div className="hours-editor">
            <div className="hours-editor-head">
              <h3>{personDraft.id ? "Change this practitioner" : "Add a practitioner"}</h3>
              {personDraft.id ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Stop editing this practitioner"
                  onClick={() =>
                    setPersonDraft({
                      id: "",
                      nameEn: "",
                      nameAr: "",
                      departmentId: "",
                      titleEn: "",
                    })
                  }
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
            <div className="hours-fields">
              <label>
                Name
                <input
                  value={personDraft.nameEn}
                  placeholder="Dr. Sara Fouad"
                  onChange={(event) =>
                    setPersonDraft({ ...personDraft, nameEn: event.target.value })
                  }
                />
              </label>
              <label>
                Name in Arabic
                <input
                  dir="rtl"
                  lang="ar"
                  value={personDraft.nameAr}
                  placeholder="د. سارة فؤاد"
                  onChange={(event) =>
                    setPersonDraft({ ...personDraft, nameAr: event.target.value })
                  }
                />
              </label>
              <label>
                Line of care
                <select
                  value={personDraft.departmentId}
                  onChange={(event) =>
                    setPersonDraft({ ...personDraft, departmentId: event.target.value })
                  }
                >
                  <option value="">Choose…</option>
                  {data.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.en}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input
                  value={personDraft.titleEn}
                  placeholder="Consultant"
                  onChange={(event) =>
                    setPersonDraft({ ...personDraft, titleEn: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="hours-actions">
              <button
                type="button"
                className="hours-primary"
                disabled={
                  busy === "practitioner" ||
                  !personDraft.nameEn.trim() ||
                  !personDraft.departmentId
                }
                onClick={async () => {
                  if (await save("practitioner", personDraft)) {
                    setPersonDraft({
                      id: "",
                      nameEn: "",
                      nameAr: "",
                      departmentId: "",
                      titleEn: "",
                    });
                  }
                }}
              >
                {busy === "practitioner"
                  ? "Saving…"
                  : personDraft.id
                    ? "Save changes"
                    : "Add practitioner"}
              </button>
            </div>
            <p className="hours-note">
              Renaming somebody leaves appointments already booked protected under the
              name they were taken against; only new bookings use the new name. That is
              the safe direction — the alternative is rewriting historical records.
            </p>
          </div>
        )}
      </section>

      {/* ---------------- closures ---------------- */}
      <section className="schedule-card">
        <div className="card-heading">
          <div>
            <span>CLOSURES</span>
            <h2>Days the clinic is shut</h2>
          </div>
        </div>
        <p className="hours-lede">
          Eid, public holidays, conference travel, leave. A closure removes the
          whole day from the booking calendar and shows patients the reason in their
          own language. Appointments already booked are not cancelled — check the day
          view and move them.
        </p>

        {data.closures.length === 0 ? (
          <p className="hours-empty">No closures recorded.</p>
        ) : (
          <div className="hours-table-wrap">
            <table className="hours-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reason (English)</th>
                  <th>Reason (Arabic)</th>
                  {!readOnly && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.closures.map((closure) => (
                  <tr key={closure.date}>
                    <td>{closure.date}</td>
                    <td>{closure.en}</td>
                    <td dir="rtl" lang="ar">
                      {closure.ar}
                    </td>
                    {!readOnly && (
                      <td>
                        <div className="hours-row-actions">
                          <button
                            type="button"
                            disabled={busy === "remove_closure"}
                            onClick={() =>
                              void save("remove_closure", { date: closure.date })
                            }
                          >
                            Reopen
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!readOnly && (
          <div className="hours-editor">
            <div className="hours-fields">
              <label>
                Date
                <input
                  type="date"
                  value={closureDraft.date}
                  onChange={(event) =>
                    setClosureDraft({ ...closureDraft, date: event.target.value })
                  }
                />
              </label>
              <label>
                Reason in English
                <input
                  value={closureDraft.en}
                  placeholder="Eid al-Fitr"
                  onChange={(event) =>
                    setClosureDraft({ ...closureDraft, en: event.target.value })
                  }
                />
              </label>
              <label>
                Reason in Arabic
                <input
                  dir="rtl"
                  lang="ar"
                  value={closureDraft.ar}
                  placeholder="عيد الفطر"
                  onChange={(event) =>
                    setClosureDraft({ ...closureDraft, ar: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="hours-actions">
              <button
                type="button"
                className="hours-primary"
                disabled={
                  busy === "closure" ||
                  !closureDraft.date ||
                  !closureDraft.en.trim() ||
                  !closureDraft.ar.trim()
                }
                onClick={async () => {
                  if (await save("closure", closureDraft)) {
                    setClosureDraft({ date: "", en: "", ar: "" });
                  }
                }}
              >
                {busy === "closure" ? "Saving…" : "Close this day"}
              </button>
            </div>
            <p className="hours-note">
              Both languages are required because patients see this on the booking
              calendar, and half the practice&rsquo;s patients read Arabic.
            </p>
          </div>
        )}
      </section>

      {/* ---------------- consultation lengths ---------------- */}
      <section className="schedule-card">
        <div className="card-heading">
          <div>
            <span>CONSULTATION LENGTHS</span>
            <h2>How long each appointment takes</h2>
          </div>
        </div>
        <p className="hours-lede">
          Chair time, excluding the {data.services[0]?.turnaroundMinutes ?? 10}-minute
          turnaround between patients. Making a consultation longer reduces how many
          fit in a session, so the booking page will offer fewer times the moment you
          save.
        </p>

        <div className="hours-table-wrap">
          <table className="hours-table">
            <thead>
              <tr>
                <th>Consultation</th>
                <th>Line of care</th>
                <th>Minutes</th>
              </tr>
            </thead>
            <tbody>
              {data.services.map((service) => (
                <tr key={service.id}>
                  <td>
                    <strong>{service.en}</strong>
                    <small dir="rtl" lang="ar">
                      {service.ar}
                    </small>
                  </td>
                  <td>
                    {data.categories.find((category) => category.id === service.category)?.en ??
                      service.category}
                  </td>
                  <td>
                    {readOnly ? (
                      `${service.durationMinutes} min`
                    ) : (
                      <select
                        value={service.durationMinutes}
                        disabled={busy === "service"}
                        aria-label={`Minutes for ${service.en}`}
                        onChange={(event) =>
                          void save("service", {
                            id: service.id,
                            durationMinutes: Number(event.target.value),
                          })
                        }
                      >
                        {[15, 30, 45, 60, 75, 90, 120].map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} min
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
