"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Send, TimerReset } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type NotificationStatus =
  | "pending"
  | "processing"
  | "retrying"
  | "blocked"
  | "delivered"
  | "skipped"
  | "dead";

type NotificationJob = {
  id: string;
  kind: string;
  subjectId: string;
  channel: string;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  provider: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

type QueueSummary = {
  queued: number;
  blocked: number;
  dead: number;
  delivered24h: number;
  oldestOpenAt: string | null;
};

type ProviderState = {
  patientEmail: boolean;
  clinicEmail: boolean;
  patientWhatsApp: boolean;
  clinicWebhook: boolean;
  branchSms: boolean;
};

const STATUS_LABEL: Record<NotificationStatus, string> = {
  pending: "Pending",
  processing: "Sending",
  retrying: "Retrying",
  blocked: "Setup required",
  delivered: "Delivered",
  skipped: "Not applicable",
  dead: "Needs attention",
};

function channelLabel(channel: string) {
  return channel
    .replace("patient_", "Patient · ")
    .replace("clinic_", "Clinic · ")
    .replace("whatsapp", "WhatsApp")
    .replace("email", "email")
    .replace("webhook", "webhook");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function NotificationCenter({ onIssueCount }: { onIssueCount?: (count: number) => void }) {
  const [jobs, setJobs] = useState<NotificationJob[]>([]);
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [providers, setProviders] = useState<ProviderState | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const response = await fetch(`/api/clinic/notifications${query}`, { cache: "no-store" });
      const data = (await response.json()) as {
        jobs?: NotificationJob[];
        summary?: QueueSummary;
        providers?: ProviderState;
        message?: string;
      };
      if (!response.ok) throw new Error(data.message ?? "Could not load delivery status.");
      setJobs(data.jobs ?? []);
      setSummary(data.summary ?? null);
      setProviders(data.providers ?? null);
      onIssueCount?.((data.summary?.blocked ?? 0) + (data.summary?.dead ?? 0));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load delivery status.");
    } finally {
      setLoading(false);
    }
  }, [status, onIssueCount]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function retry(id: string) {
    setPendingId(id);
    try {
      const response = await fetch("/api/clinic/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "retry" }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Could not retry this delivery.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retry this delivery.");
    } finally {
      setPendingId("");
    }
  }

  async function processQueue() {
    setPendingId("queue");
    try {
      const response = await fetch("/api/clinic/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process" }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Could not process the queue.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not process the queue.");
    } finally {
      setPendingId("");
    }
  }

  return (
    <section className="notification-center">
      <div className="notification-heading">
        <div>
          <span>DELIVERY CONTROL</span>
          <h2>Notifications</h2>
          <p>Every booking message is durable, independently retried, and visible here.</p>
        </div>
        <div className="notification-heading-actions">
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter notification deliveries">
            <option value="">All deliveries</option>
            <option value="blocked">Setup required</option>
            <option value="dead">Needs attention</option>
            <option value="retrying">Retrying</option>
            <option value="delivered">Delivered</option>
            <option value="skipped">Not applicable</option>
          </select>
          <button onClick={() => void refresh()} disabled={loading} aria-label="Refresh notification deliveries">
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            Refresh
          </button>
          <button onClick={() => void processQueue()} disabled={pendingId === "queue"}>
            <Send size={15} />
            {pendingId === "queue" ? "Running…" : "Run queue"}
          </button>
        </div>
      </div>

      {error && (
        <div className="command-alert" role="alert">
          <AlertTriangle size={16} />
          <p>{error}</p>
        </div>
      )}

      <div className="notification-metrics" aria-label="Notification queue health">
        <article><TimerReset /><span>OPEN</span><strong>{summary?.queued ?? "—"}</strong></article>
        <article><AlertTriangle /><span>SETUP REQUIRED</span><strong>{summary?.blocked ?? "—"}</strong></article>
        <article><RotateCcw /><span>NEEDS ATTENTION</span><strong>{summary?.dead ?? "—"}</strong></article>
        <article><CheckCircle2 /><span>DELIVERED · 24H</span><strong>{summary?.delivered24h ?? "—"}</strong></article>
      </div>

      <div className="provider-strip" aria-label="Notification provider configuration">
        {providers && Object.entries({
          "Patient email": providers.patientEmail,
          "Clinic email": providers.clinicEmail,
          "Patient WhatsApp": providers.patientWhatsApp,
          "Clinic webhook": providers.clinicWebhook,
          "Branch SMS": providers.branchSms,
        }).map(([label, configured]) => (
          <span key={label} data-ready={configured || undefined}>
            <i /> {label} · {configured ? "ready" : "setup required"}
          </span>
        ))}
      </div>

      <div className="notification-table" role="region" aria-label="Delivery jobs">
        <div className="notification-row notification-row--head">
          <span>Event</span><span>Channel</span><span>Status</span><span>Attempts</span><span>Created</span><span>Action</span>
        </div>
        {loading && jobs.length === 0 ? (
          <p className="notification-empty">Loading delivery history…</p>
        ) : jobs.length === 0 ? (
          <p className="notification-empty">No deliveries match this filter.</p>
        ) : jobs.map((job) => (
          <div className="notification-row" key={job.id}>
            <span><strong>{job.kind.replace("booking.", "")}</strong><small>Ref {job.subjectId.slice(0, 8).toUpperCase()}</small></span>
            <span>{channelLabel(job.channel)}</span>
            <span><i className="delivery-status" data-status={job.status} />{STATUS_LABEL[job.status]}</span>
            <span>{job.attempts} / {job.maxAttempts}</span>
            <span>{formatDate(job.createdAt)}</span>
            <span>
              {(job.status === "dead" || job.status === "blocked" || job.status === "retrying") ? (
                <button onClick={() => void retry(job.id)} disabled={pendingId === job.id}>
                  <Send size={14} /> {pendingId === job.id ? "Queued" : "Retry"}
                </button>
              ) : <small>{job.deliveredAt ? formatDate(job.deliveredAt) : job.lastErrorCode ?? "—"}</small>}
            </span>
            {job.lastErrorMessage && <p>{job.lastErrorMessage}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
