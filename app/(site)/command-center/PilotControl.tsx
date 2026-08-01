"use client";

import {
  AlertOctagon,
  HelpCircle,
  Check,
  CirclePause,
  ClipboardCheck,
  Flag,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { BRANCHES, branchLabel } from "@/lib/clinic";
import { formatShortDate } from "@/lib/dates";
import "./pilot-control.css";

type PilotStatus = "setup" | "running" | "paused" | "complete";
type PilotDecision = "pending" | "go" | "extend" | "stop";
type PilotRecommendation = "continue" | "investigate" | "stop";

type PilotDashboard = {
  settings: {
    status: PilotStatus;
    branchId: string | null;
    startDate: string | null;
    endDate: string | null;
    decision: PilotDecision;
    decisionNote: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
  };
  checklist: Array<{
    key: string;
    label: string;
    detail: string;
    completed: boolean;
    note: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
  }>;
  metrics: {
    weekStart: string;
    bookings: number;
    websiteBookings: number;
    completed: number;
    noShows: number;
    noShowRate: number;
    cancelled: number;
    notificationTotal: number;
    notificationFailed: number;
    notificationFailureRate: number;
    openIncidents: number;
    criticalIncidents: number;
  };
  incidents: Array<{
    id: string;
    summary: string;
    severity: string;
    status: string;
    openedBy: string;
    openedAt: string;
    resolvedBy: string | null;
    resolvedAt: string | null;
  }>;
  reviews: Array<{
    id: string;
    weekStart: string;
    branchId: string | null;
    bookings: number;
    completed: number;
    noShows: number;
    cancelled: number;
    notificationTotal: number;
    notificationFailed: number;
    openIncidents: number;
    recommendation: PilotRecommendation;
    note: string | null;
    createdBy: string;
    createdAt: string;
  }>;
  evaluation: {
    recommendation: PilotRecommendation;
    checks: Array<{
      key: string;
      label: string;
      pass: boolean;
      /** "unknown" means not enough evidence yet — distinct from a failure. */
      state: "pass" | "fail" | "unknown";
      detail: string;
    }>;
  };
  readyToStart: boolean;
};

type Draft = {
  status: PilotStatus;
  branchId: string;
  startDate: string;
  endDate: string;
  decision: PilotDecision;
  decisionNote: string;
};

const STATUS_LABEL: Record<PilotStatus, string> = {
  setup: "Setup",
  running: "Running in parallel",
  paused: "Emergency pause",
  complete: "Pilot complete",
};

function settingsDraft(data: PilotDashboard): Draft {
  return {
    status: data.settings.status,
    branchId: data.settings.branchId ?? BRANCHES[0].id,
    startDate: data.settings.startDate ?? "",
    endDate: data.settings.endDate ?? "",
    decision: data.settings.decision,
    decisionNote: data.settings.decisionNote ?? "",
  };
}

export default function PilotControl() {
  const [data, setData] = useState<PilotDashboard | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [incidentSummary, setIncidentSummary] = useState("");
  const [incidentSeverity, setIncidentSeverity] = useState("medium");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewRecommendation, setReviewRecommendation] = useState<PilotRecommendation>("continue");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/clinic/pilot", { cache: "no-store" });
      const body = (await response.json()) as PilotDashboard & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Pilot controls could not load.");
      setData(body);
      setDraft(settingsDraft(body));
      setReviewRecommendation(body.evaluation.recommendation);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot controls could not load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function mutate(label: string, body: Record<string, unknown>) {
    setSaving(label);
    setError("");
    try {
      const response = await fetch("/api/clinic/pilot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const next = (await response.json()) as PilotDashboard & { message?: string };
      if (!response.ok) throw new Error(next.message ?? "That pilot change did not save.");
      setData(next);
      setDraft(settingsDraft(next));
      setReviewRecommendation(next.evaluation.recommendation);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That pilot change did not save.");
      return false;
    } finally {
      setSaving("");
    }
  }

  async function saveSettings(status = draft?.status) {
    if (!draft || !status) return;
    if (
      (status === "running" || status === "complete") &&
      !window.confirm(
        status === "running"
          ? "Start the bounded public-booking pilot for this branch?"
          : "Mark this pilot complete? Public booking will no longer be pilot-restricted.",
      )
    ) {
      return;
    }
    await mutate("settings", { action: "configure", ...draft, status });
  }

  async function emergencyPause() {
    if (!draft) return;
    if (!window.confirm("Pause every new online booking immediately? Existing appointments stay intact.")) {
      return;
    }
    await mutate("pause", { action: "configure", ...draft, status: "paused" });
  }

  async function addIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      await mutate("incident", {
        action: "incident",
        summary: incidentSummary,
        severity: incidentSeverity,
      })
    ) {
      setIncidentSummary("");
    }
  }

  async function saveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      await mutate("review", {
        action: "review",
        recommendation: reviewRecommendation,
        note: reviewNote,
      })
    ) {
      setReviewNote("");
    }
  }

  if (loading && !data) {
    return <p className="pilot-loading">Loading Pilot Control…</p>;
  }
  if (!data || !draft) {
    return (
      <div className="command-alert" role="alert">
        <AlertOctagon size={17} />
        <p>{error || "Pilot controls are unavailable."}</p>
        <button onClick={() => void load()}>Retry</button>
      </div>
    );
  }

  const checklistDone = data.checklist.filter((item) => item.completed).length;
  return (
    <section className="pilot-control" aria-labelledby="pilot-title">
      <header className="pilot-hero">
        <div>
          <span>PHASE 6 · CONTROLLED PARALLEL RUN</span>
          <h2 id="pilot-title">Pilot Control</h2>
          <p>Bound the rollout, watch the evidence and stop safely if reality disagrees.</p>
        </div>
        <div className="pilot-hero-actions">
          <span className="pilot-state" data-status={data.settings.status}>
            <i /> {STATUS_LABEL[data.settings.status]}
          </span>
          <button onClick={() => void load()} disabled={loading} aria-label="Refresh pilot data">
            <RefreshCw className={loading ? "spin" : ""} size={16} />
            Refresh
          </button>
          {data.settings.status === "running" && (
            <button className="pilot-pause" onClick={() => void emergencyPause()} disabled={Boolean(saving)}>
              <CirclePause size={16} />
              Pause bookings
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="command-alert" role="alert">
          <AlertOctagon size={17} />
          <p>{error}</p>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}

      <div className="pilot-metrics" aria-label={`Pilot metrics since ${data.metrics.weekStart}`}>
        <article>
          <span>BOOKINGS THIS WEEK</span>
          <strong>{data.metrics.bookings}</strong>
          <p>{data.metrics.websiteBookings} came through the website</p>
        </article>
        <article>
          <span>NO-SHOW RATE</span>
          <strong>{data.metrics.noShowRate}%</strong>
          <p>{data.metrics.noShows} missed · threshold 15%</p>
        </article>
        <article>
          <span>DELIVERY FAILURES</span>
          <strong>{data.metrics.notificationFailureRate}%</strong>
          <p>{data.metrics.notificationFailed} of {data.metrics.notificationTotal} jobs</p>
        </article>
        <article data-alert={data.metrics.criticalIncidents > 0 || undefined}>
          <span>OPEN INCIDENTS</span>
          <strong>{data.metrics.openIncidents}</strong>
          <p>{data.metrics.criticalIncidents} critical</p>
        </article>
      </div>

      <div className="pilot-layout">
        <section className="pilot-panel pilot-configuration">
          <div className="pilot-panel-heading">
            <Flag size={18} />
            <div><span>BLAST RADIUS</span><h3>One-branch rollout</h3></div>
          </div>
          <div className="pilot-form-grid">
            <label>
              <span>Pilot branch</span>
              <select value={draft.branchId} onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}>
                {BRANCHES.map((branch) => <option value={branch.id} key={branch.id}>{branch.en}</option>)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as PilotStatus })}>
                <option value="setup">Setup</option>
                <option value="running">Running in parallel</option>
                <option value="paused">Paused</option>
                <option value="complete">Complete</option>
              </select>
            </label>
            <label><span>Starts</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
            <label><span>Review date</span><input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label>
          </div>
          <p className="pilot-boundary">
            {data.settings.status === "running" && data.settings.branchId
              ? `Public booking is restricted to ${branchLabel(data.settings.branchId)}. The existing website stays live.`
              : data.settings.status === "paused"
                ? "New public holds are blocked. Existing appointments and Clinic OS remain available."
                : "Public booking is not currently restricted by the pilot controller."}
          </p>
          <button className="pilot-primary" onClick={() => void saveSettings()} disabled={Boolean(saving)}>
            {saving === "settings" ? "Saving…" : "Save pilot configuration"}
          </button>
        </section>

        <section className="pilot-panel">
          <div className="pilot-panel-heading">
            <ClipboardCheck size={18} />
            <div><span>READINESS</span><h3>{checklistDone} of {data.checklist.length} signed off</h3></div>
          </div>
          <div className="pilot-checklist">
            {data.checklist.map((item) => (
              <label key={item.key} data-complete={item.completed || undefined}>
                <input
                  type="checkbox"
                  checked={item.completed}
                  disabled={Boolean(saving)}
                  onChange={(event) => void mutate(`checklist-${item.key}`, {
                    action: "checklist",
                    key: item.key,
                    completed: event.target.checked,
                    note: item.note,
                  })}
                />
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <Check size={15} />
              </label>
            ))}
          </div>
          {!data.readyToStart && <p className="pilot-gate">Choose dates and complete every sign-off before Start can succeed.</p>}
        </section>
      </div>

      <section className="pilot-panel pilot-decision">
        <div className="pilot-panel-heading">
          <Gauge size={18} />
          <div><span>GO / NO-GO</span><h3>Evidence, not instinct</h3></div>
          <strong data-recommendation={data.evaluation.recommendation}>{data.evaluation.recommendation}</strong>
        </div>
        <div className="pilot-checks">
          {data.evaluation.checks.map((check) => (
            <span key={check.key} data-state={check.state} title={check.detail}>
              {check.state === "pass" ? (
                <Check size={14} />
              ) : check.state === "unknown" ? (
                <HelpCircle size={14} />
              ) : (
                <AlertOctagon size={14} />
              )}
              {check.label}
            </span>
          ))}
        </div>
        <div className="pilot-decision-form">
          <label><span>Decision</span><select value={draft.decision} onChange={(event) => setDraft({ ...draft, decision: event.target.value as PilotDecision })}><option value="pending">Pending</option><option value="go">Go</option><option value="extend">Extend pilot</option><option value="stop">Stop</option></select></label>
          <label><span>Decision evidence</span><textarea rows={2} maxLength={1000} value={draft.decisionNote} onChange={(event) => setDraft({ ...draft, decisionNote: event.target.value })} placeholder="Who decided, what the numbers showed, and any conditions…" /></label>
          <button onClick={() => void saveSettings()} disabled={Boolean(saving)}>Record decision</button>
        </div>
      </section>

      <div className="pilot-layout">
        <section className="pilot-panel">
          <div className="pilot-panel-heading"><Siren size={18} /><div><span>OPERATIONS</span><h3>Incident log</h3></div></div>
          <form className="pilot-incident-form" onSubmit={addIncident}>
            <label><span>Severity</span><select value={incidentSeverity} onChange={(event) => setIncidentSeverity(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
            <label><span>What happened? No patient details.</span><input required maxLength={240} value={incidentSummary} onChange={(event) => setIncidentSummary(event.target.value)} placeholder="Example: confirmation email delayed by 12 minutes" /></label>
            <button disabled={Boolean(saving)}>Log incident</button>
          </form>
          <div className="pilot-incidents">
            {data.incidents.length === 0 && <p>No pilot incidents recorded.</p>}
            {data.incidents.map((incident) => (
              <article key={incident.id} data-severity={incident.severity} data-resolved={incident.status === "resolved" || undefined}>
                <span>{incident.severity}</span><strong>{incident.summary}</strong><small>{new Date(incident.openedAt).toLocaleString()}</small>
                {incident.status === "open" ? <button onClick={() => void mutate(`resolve-${incident.id}`, { action: "resolve_incident", id: incident.id })}>Resolve</button> : <em>Resolved</em>}
              </article>
            ))}
          </div>
        </section>

        <section className="pilot-panel">
          <div className="pilot-panel-heading"><ShieldCheck size={18} /><div><span>WEEKLY EVIDENCE</span><h3>Frozen reviews</h3></div></div>
          <form className="pilot-review-form" onSubmit={saveReview}>
            <label><span>Recommendation</span><select value={reviewRecommendation} onChange={(event) => setReviewRecommendation(event.target.value as PilotRecommendation)}><option value="continue">Continue</option><option value="investigate">Investigate</option><option value="stop">Stop</option></select></label>
            <label><span>Review note</span><textarea rows={2} maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Staff feedback, delivery issues and actions for next week…" /></label>
            <button disabled={Boolean(saving)}>Save this week&rsquo;s snapshot</button>
          </form>
          <div className="pilot-reviews">
            {data.reviews.length === 0 && <p>No weekly review has been frozen yet.</p>}
            {data.reviews.map((review) => (
              <article key={review.id}>
                <span>{formatShortDate(review.weekStart)} · {review.branchId ? branchLabel(review.branchId) : "All clinics"}</span>
                <strong>{review.recommendation}</strong>
                <small>{review.bookings} bookings · {review.noShows} no-shows · {review.notificationFailed} delivery failures · {review.openIncidents} open incidents</small>
                {review.note && <p>{review.note}</p>}
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
