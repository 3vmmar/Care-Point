"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  ChartNoAxesColumn,
  ShieldAlert,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  LogIn,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  BellRing,
  Search,
  UserX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRANCHES, CLINIC_TIMEZONE, SERVICES, branchLabel, findBranch, serviceLabel } from "@/lib/clinic";
import { addDays, formatShortDate, formatSlotTime } from "@/lib/dates";
import AddAppointment from "./AddAppointment";
import DataRequests from "./DataRequests";
import NotificationCenter from "./NotificationCenter";
import DayTimeline from "./DayTimeline";
import PatientHistory from "./PatientHistory";
import WeekView from "./WeekView";
import {
  STATUS_META,
  initials,
  type Appointment,
  type AppointmentStatus,
  type CapacityDay,
  type Summary,
} from "./types";

type View = "Today" | "Week" | "Schedule" | "Insights" | "Requests" | "Notifications";

const REFRESH_INTERVAL_MS = 20000;
const PAGE_SIZE = 50;

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Escapes a value for CSV: quotes it and doubles any internal quote. */
function csvCell(value: string | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function CommandCenter({ staffName }: { staffName: string }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [clinicDate, setClinicDate] = useState("");
  const [clinicTime, setClinicTime] = useState("");
  const [capacity, setCapacity] = useState<CapacityDay[]>([]);
  const [arrivals, setArrivals] = useState<Appointment[]>([]);
  const [allowlistConfigured, setAllowlistConfigured] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [view, setView] = useState<View>("Today");
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  /** Outstanding data-subject requests, badged in the nav. */
  const [pendingRequests, setPendingRequests] = useState(0);
  const [notificationIssues, setNotificationIssues] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Ids present at the last refresh; `null` until the first load settles. */
  const seenIds = useRef<Set<string> | null>(null);

  const today = view === "Today";
  const wide = view === "Today" || view === "Week";

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (wide) {
        // Day and week are schedules, not lists: they take the whole fortnight
        // in one go so a busy month can never push today's visits off the page.
        params.set("limit", "300");
      } else {
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(page * PAGE_SIZE));
        if (statusFilter) params.set("status", statusFilter);
      }
      // Applies to every view — the sidebar selector used to be ignored on the
      // day view, so filtering to one clinic silently did nothing there.
      if (branchFilter) params.set("branch", branchFilter);

      const response = await fetch(`/api/bookings?${params}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Your session has expired, or this account is not on the clinic staff list."
            : "Could not reach the appointment database.",
        );
      }
      const data = (await response.json()) as {
        appointments?: Appointment[];
        summary?: Summary;
        capacity?: CapacityDay[];
        total?: number;
        clinicToday?: string;
        clinicTime?: string;
        allowlistConfigured?: boolean;
      };
      const incoming = data.appointments ?? [];

      // Anything whose id was not in the previous snapshot arrived while the
      // dashboard was open. The first load only seeds the baseline, or every
      // appointment would be announced as new.
      if (seenIds.current) {
        const fresh = incoming.filter(
          (item) =>
            !seenIds.current!.has(item.id) &&
            item.status !== "cancelled" &&
            item.source === "website",
        );
        if (fresh.length > 0) setArrivals((current) => [...fresh, ...current].slice(0, 8));
      }
      seenIds.current = new Set(incoming.map((item) => item.id));

      setAppointments(incoming);
      setSummary(data.summary ?? null);
      setCapacity(data.capacity ?? []);
      setTotal(data.total ?? 0);
      setClinicDate(data.clinicToday ?? "");
      setClinicTime(data.clinicTime ?? "");
      setAllowlistConfigured(data.allowlistConfigured ?? true);
      setLastUpdated(new Date());
      setLoadError("");
    } catch (error) {
      // A network blip used to leave the dashboard silently stale.
      setLoadError(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }

    // Counted on the same cycle so the badge cannot go stale while someone
    // sits on the dashboard all day. A failure here must never surface as a
    // dashboard error — the appointment book is the important part.
    try {
      const response = await fetch("/api/clinic/data-requests?status=pending", {
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as { requests?: unknown[] };
        setPendingRequests(data.requests?.length ?? 0);
      }
    } catch {
      // Leave the previous count in place.
    }

    try {
      const response = await fetch("/api/clinic/notifications?limit=1", {
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as {
          summary?: { blocked?: number; dead?: number };
        };
        setNotificationIssues((data.summary?.blocked ?? 0) + (data.summary?.dead ?? 0));
      }
    } catch {
      // Delivery status is additive; appointment refresh remains authoritative.
    }
  }, [wide, page, branchFilter, statusFilter]);

  useEffect(() => {
    // Deferred so the first render commits before the fetch flips `refreshing`.
    const initial = window.setTimeout(() => void refresh(), 0);
    // Polling a hidden tab wastes requests and keeps a phone awake in a pocket.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /** Reception works this screen all day; the keyboard should keep up. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if (event.key === "Escape" && typing) {
        (target as HTMLElement).blur();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refresh();
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setAddOpen(true);
      } else if (event.key >= "1" && event.key <= "6") {
        setView(
          (["Today", "Week", "Schedule", "Insights", "Requests", "Notifications"] as View[])[
            Number(event.key) - 1
          ],
        );
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [refresh]);

  const act = useCallback(
    async (id: string, body: { status?: AppointmentStatus; staffNote?: string }) => {
      setPendingId(id);
      setActionError("");
      try {
        const response = await fetch(`/api/bookings/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { message?: string };
        if (!response.ok) throw new Error(data.message ?? "That change did not save.");
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "That change did not save.");
      } finally {
        setPendingId(null);
      }
    },
    [refresh],
  );

  const visible = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    const scoped =
      view === "Today"
        ? appointments.filter((item) => item.slotDate === clinicDate)
        : appointments;
    if (!normalized) return scoped;
    return scoped.filter((item) =>
      [
        item.patientName,
        item.patientPhone,
        item.patientEmail,
        serviceLabel(item.service),
        branchLabel(item.branch),
        item.slotDate,
        item.slotTime,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [appointments, query, view, clinicDate]);

  /** The one thing the doctor looks for first: who is in the room, and who is next. */
  const { current, next } = useMemo(() => {
    const live = visible
      .filter((item) => item.status === "confirmed" || item.status === "checked_in")
      .sort((a, b) => a.slotTime.localeCompare(b.slotTime));
    const inRoom = live.find((item) => item.status === "checked_in") ?? null;
    const upcoming = live.find(
      (item) => item.status === "confirmed" && item.slotTime >= clinicTime,
    ) ?? null;
    return { current: inRoom, next: upcoming };
  }, [visible, clinicTime]);

  function exportCsv() {
    const header = [
      "Date",
      "Time",
      "Patient",
      "Phone",
      "Email",
      "Consultation",
      "Clinic",
      "Status",
      "Source",
      "Note",
    ];
    const rows = visible.map((item) =>
      [
        item.slotDate,
        item.slotTime,
        item.patientName,
        item.patientPhone,
        item.patientEmail,
        serviceLabel(item.service),
        branchLabel(item.branch),
        STATUS_META[item.status]?.label ?? item.status,
        item.source,
        item.staffNote ?? item.patientNote,
      ].map(csvCell),
    );
    const csv = [header.map(csvCell).join(","), ...rows.map((row) => row.join(","))].join("\r\n");
    // A BOM makes Excel read the Arabic names correctly instead of as mojibake.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `care-point-${today ? clinicDate : "schedule"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const todayCapacity = capacity.find((day) => day.date === clinicDate) ?? null;
  const hour = Number(clinicTime.slice(0, 2) || "9");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="command-shell">
      <aside className="command-sidebar">
        <div className="command-brand">
          <span>AM</span>
          <div>
            <strong>CLINIC OS</strong>
            <small>COMMAND CENTER</small>
          </div>
        </div>

        <nav aria-label="Dashboard sections">
          {(["Today", "Week", "Schedule", "Insights", "Requests", "Notifications"] as View[]).map((item, index) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => {
                setView(item);
                setPage(0);
              }}
              aria-current={view === item ? "page" : undefined}
            >
              {item === "Today" && <Activity size={18} />}
              {item === "Week" && <CalendarRange size={18} />}
              {item === "Schedule" && <CalendarCheck2 size={18} />}
              {item === "Insights" && <ChartNoAxesColumn size={18} />}
              {item === "Requests" && <ShieldAlert size={18} />}
              {item === "Notifications" && <BellRing size={18} />}
              {item}
              {/* A pending data request carries a legal response deadline, so
                  it is surfaced in the nav rather than waiting to be found. */}
              {(item === "Requests" && pendingRequests > 0) ||
              (item === "Notifications" && notificationIssues > 0) ? (
                <span className="nav-badge">
                  {item === "Requests" ? pendingRequests : notificationIssues}
                </span>
              ) : (
                <kbd>{index + 1}</kbd>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <span className="sidebar-label">Clinic</span>
          <select
            value={branchFilter}
            onChange={(event) => {
              setBranchFilter(event.target.value);
              setPage(0);
            }}
            aria-label="Filter by clinic"
          >
            <option value="">All clinics</option>
            {BRANCHES.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.en}
              </option>
            ))}
          </select>
          {branchFilter && findBranch(branchFilter) && (
            <a
              className="sidebar-map"
              href={findBranch(branchFilter)!.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Navigation size={13} />
              Open in Google Maps
            </a>
          )}
        </div>

        <div className="command-sidebar-bottom">
          <div className="system-status">
            <span className={loadError ? "offline" : undefined} />
            <div>
              <strong>{loadError ? "Connection issue" : "Booking service online"}</strong>
              <small>
                {lastUpdated
                  ? `Updated ${lastUpdated.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "Connecting…"}
              </small>
            </div>
          </div>
          <a href="https://drashrafmetwally.com">
            <ArrowLeft size={15} />
            Patient experience
          </a>
        </div>
      </aside>

      <section className="command-main">
        <header className="command-header">
          <div className="command-title">
            <span>
              LIVE CLINIC VIEW · {clinicDate ? formatShortDate(clinicDate) : "—"}
              {clinicTime && ` · ${formatSlotTime(clinicTime)} ${CLINIC_TIMEZONE.split("/")[1]}`}
            </span>
            <h1>
              {greeting(hour)}, {staffName}.
            </h1>
          </div>
          <div className="command-header-actions">
            <label className="command-search">
              <Search size={16} />
              <input
                ref={searchRef}
                placeholder="Search name, phone, clinic…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search appointments"
              />
              <kbd>/</kbd>
            </label>
            <button className="ghost-button" onClick={() => setAddOpen(true)}>
              <Plus size={16} />
              Add appointment
            </button>
            <button
              className="icon-button"
              onClick={() => void refresh()}
              aria-label="Refresh appointments"
              title="Refresh (R)"
            >
              <RefreshCw className={refreshing ? "spin" : ""} size={17} />
            </button>
            <div className="avatar" title={staffName}>
              {initials(staffName)}
            </div>
          </div>
        </header>

        {!allowlistConfigured && (
          <div className="command-alert command-alert--warn" role="alert">
            <AlertTriangle size={16} />
            <p>
              No staff allowlist is configured. Set <code>STAFF_EMAILS</code> in the
              deployment environment so only clinic staff can open this dashboard.
            </p>
          </div>
        )}

        {loadError && (
          <div className="command-alert" role="alert">
            <AlertTriangle size={16} />
            <p>{loadError}</p>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}

        {actionError && (
          <div className="command-alert" role="alert">
            <AlertTriangle size={16} />
            <p>{actionError}</p>
            <button onClick={() => setActionError("")}>Dismiss</button>
          </div>
        )}

        {arrivals.length > 0 && (
          <div className="arrivals" role="status">
            <BellRing size={17} />
            <p>
              <strong>
                {arrivals.length} new booking{arrivals.length === 1 ? "" : "s"} from the website
              </strong>
              <span>
                {arrivals
                  .slice(0, 3)
                  .map(
                    (item) =>
                      `${item.patientName ?? "Unnamed"} — ${formatShortDate(item.slotDate)} ${formatSlotTime(item.slotTime)}`,
                  )
                  .join(" · ")}
                {arrivals.length > 3 && ` and ${arrivals.length - 3} more`}
              </span>
            </p>
            <button onClick={() => setArrivals([])}>Dismiss</button>
          </div>
        )}

        {view !== "Insights" && (
          <section className="metric-grid" aria-label="Clinic metrics">
            <article>
              <div><span>TODAY</span><CalendarDays /></div>
              <strong>{summary?.today ?? "—"}</strong>
              <p>
                {summary ? `${summary.todayRemaining} still to come` : "Loading…"}
              </p>
            </article>
            <article>
              <div><span>TODAY&rsquo;S CAPACITY</span><CalendarCheck2 /></div>
              <strong>
                {todayCapacity ? todayCapacity.percent : "—"}
                {todayCapacity && <small>%</small>}
              </strong>
              <p>
                {todayCapacity
                  ? `${todayCapacity.booked} of ${todayCapacity.total} slots taken`
                  : "Loading…"}
              </p>
            </article>
            <article>
              <div><span>BOOKED THIS WEEK</span><Clock3 /></div>
              <strong>{summary?.bookedLast7Days ?? "—"}</strong>
              <p>Confirmed in the last 7 days</p>
            </article>
            <article>
              <div><span>NO-SHOW RATE</span><UserX /></div>
              <strong>
                {summary ? `${summary.noShowRate}` : "—"}
                {summary && <small>%</small>}
              </strong>
              <p>
                {summary
                  ? `${summary.noShowLast30Days} missed of ${
                      summary.noShowLast30Days + summary.completedLast30Days
                    } in 30 days`
                  : "Loading…"}
              </p>
            </article>
          </section>
        )}

        {view === "Today" && (
          <>
            <section className="focus-row" aria-label="Now and next">
              <FocusCard
                kind="In the room"
                appointment={current}
                empty="Nobody is checked in right now."
                pendingId={pendingId}
                onAct={act}
              />
              <FocusCard
                kind="Up next"
                appointment={next}
                empty="No further appointments today."
                pendingId={pendingId}
                onAct={act}
              />
            </section>

            <section className="schedule-card">
              <div className="card-heading">
                <div>
                  <span>TODAY&rsquo;S LIST</span>
                  <h2>{clinicDate ? formatShortDate(clinicDate) : "Today"}</h2>
                </div>
                <div className="card-heading-actions">
                  <button onClick={() => window.print()}>
                    <Printer size={15} />
                    Print day sheet
                  </button>
                  <button onClick={exportCsv} disabled={visible.length === 0}>
                    <Download size={15} />
                    Export CSV
                  </button>
                </div>
              </div>
              <AppointmentList
                appointments={visible}
                loaded={loaded}
                query={query}
                emptyTitle="Nothing booked today"
                emptyBody="Confirmed bookings from the patient website appear here the moment they are made."
                expanded={expanded}
                setExpanded={setExpanded}
                pendingId={pendingId}
                onAct={act}
                clinicTime={clinicTime}
                showDate={false}
              />
            </section>

            <section className="schedule-card timeline-card">
              <div className="card-heading">
                <div>
                  <span>THE DAY IN ORDER</span>
                  <h2>Slots and gaps</h2>
                </div>
                {todayCapacity && (
                  <div className="capacity-readout">
                    <div className="week-bar" aria-hidden>
                      <i
                        style={{ width: `${Math.min(100, todayCapacity.percent)}%` }}
                        data-heavy={todayCapacity.percent >= 80 || undefined}
                      />
                    </div>
                    <span>
                      {todayCapacity.booked} of {todayCapacity.total} taken
                    </span>
                  </div>
                )}
              </div>
              <DayTimeline
                appointments={visible}
                branchFilter={branchFilter}
                clinicDate={clinicDate}
                clinicTime={clinicTime}
                onPick={(id) => {
                  setView("Today");
                  setExpanded(id);
                }}
                onAdd={() => setAddOpen(true)}
              />
            </section>
          </>
        )}

        {view === "Week" && (
          <section className="schedule-card">
            <div className="card-heading">
              <div>
                <span>PLANNING</span>
                <h2>The week ahead</h2>
              </div>
              <div className="card-heading-actions">
                <button onClick={exportCsv} disabled={visible.length === 0}>
                  <Download size={15} />
                  Export CSV
                </button>
              </div>
            </div>
            <WeekView
              appointments={visible}
              capacity={capacity}
              clinicDate={clinicDate}
              onPick={(id) => {
                setView("Schedule");
                setExpanded(id);
              }}
            />
          </section>
        )}

        {view === "Schedule" && (
          <section className="schedule-card">
            <div className="card-heading">
              <div>
                <span>APPOINTMENT FLOW</span>
                <h2>Schedule</h2>
              </div>
              <div className="card-heading-actions">
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    setPage(0);
                  }}
                  aria-label="Filter by status"
                >
                  <option value="">All statuses</option>
                  <option value="active">Active (confirmed + checked in)</option>
                  {Object.entries(STATUS_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </select>
                <button onClick={exportCsv} disabled={visible.length === 0}>
                  <Download size={15} />
                  Export CSV
                </button>
              </div>
            </div>
            <AppointmentList
              appointments={visible}
              loaded={loaded}
              query={query}
              emptyTitle="No matching appointments"
              emptyBody="Try a different clinic, status, or search term."
              expanded={expanded}
              setExpanded={setExpanded}
              pendingId={pendingId}
              onAct={act}
              clinicTime={clinicTime}
              showDate
            />
            {total > PAGE_SIZE && (
              <div className="pagination">
                <button onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>
                  <ChevronLeft size={15} />
                  Previous
                </button>
                <span>
                  Page {page + 1} of {pages} · {total} appointments
                </span>
                <button
                  onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}
                  disabled={page >= pages - 1}
                >
                  Next
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
          </section>
        )}

        {view === "Insights" && <Insights summary={summary} clinicDate={clinicDate} />}

        {view === "Requests" && <DataRequests />}

        {view === "Notifications" && (
          <NotificationCenter onIssueCount={setNotificationIssues} />
        )}
      </section>

      {addOpen && (
        <AddAppointment
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            void refresh();
          }}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function FocusCard({
  kind,
  appointment,
  empty,
  pendingId,
  onAct,
}: {
  kind: string;
  appointment: Appointment | null;
  empty: string;
  pendingId: string | null;
  onAct: (id: string, body: { status?: AppointmentStatus }) => void;
}) {
  return (
    <article className={`focus-card${appointment ? "" : " focus-card--empty"}`}>
      <span className="focus-kind">{kind}</span>
      {appointment ? (
        <>
          <strong className="focus-time">{formatSlotTime(appointment.slotTime)}</strong>
          <h3>{appointment.patientName ?? "Unnamed"}</h3>
          <p>
            {serviceLabel(appointment.service)} · {branchLabel(appointment.branch)}
          </p>
          <div className="focus-actions">
            {appointment.patientPhone && (
              <a href={`tel:${appointment.patientPhone}`}>
                <Phone size={15} />
                {appointment.patientPhone}
              </a>
            )}
            {appointment.status === "confirmed" ? (
              <button
                disabled={pendingId === appointment.id}
                onClick={() => onAct(appointment.id, { status: "checked_in" })}
              >
                <LogIn size={15} />
                Check in
              </button>
            ) : (
              <button
                disabled={pendingId === appointment.id}
                onClick={() => onAct(appointment.id, { status: "completed" })}
              >
                <BadgeCheck size={15} />
                Complete
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="focus-empty">{empty}</p>
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------- */

function AppointmentList({
  appointments,
  loaded,
  query,
  emptyTitle,
  emptyBody,
  expanded,
  setExpanded,
  pendingId,
  onAct,
  clinicTime,
  showDate,
}: {
  appointments: Appointment[];
  loaded: boolean;
  query: string;
  emptyTitle: string;
  emptyBody: string;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  pendingId: string | null;
  onAct: (id: string, body: { status?: AppointmentStatus; staffNote?: string }) => void;
  clinicTime: string;
  showDate: boolean;
}) {
  if (!loaded) {
    return (
      <div className="empty-state">
        <p>Loading appointments…</p>
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div className="empty-state">
        <CalendarCheck2 size={26} />
        <h3>{query ? "No matching appointments" : emptyTitle}</h3>
        <p>{query ? "Try a different name, phone number, or clinic." : emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="booking-table">
      <div className="table-head">
        <span>TIME</span>
        <span>PATIENT</span>
        <span>CONSULTATION</span>
        <span>CLINIC</span>
        <span>STATUS</span>
        <span />
      </div>
      {appointments.map((item) => (
        <AppointmentRow
          key={item.id}
          appointment={item}
          expanded={expanded === item.id}
          onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
          pending={pendingId === item.id}
          onAct={onAct}
          clinicTime={clinicTime}
          showDate={showDate}
        />
      ))}
    </div>
  );
}

function AppointmentRow({
  appointment,
  expanded,
  onToggle,
  pending,
  onAct,
  clinicTime,
  showDate,
}: {
  appointment: Appointment;
  expanded: boolean;
  onToggle: () => void;
  pending: boolean;
  onAct: (id: string, body: { status?: AppointmentStatus; staffNote?: string }) => void;
  clinicTime: string;
  showDate: boolean;
}) {
  const [note, setNote] = useState(appointment.staffNote ?? "");
  const meta = STATUS_META[appointment.status] ?? { label: appointment.status, tone: "confirmed" };
  const branch = findBranch(appointment.branch);
  const imminent =
    appointment.status === "confirmed" &&
    !showDate &&
    appointment.slotTime >= clinicTime &&
    appointment.slotTime <= addMinutes(clinicTime, 60);

  return (
    <div className={`table-row${expanded ? " table-row--open" : ""}`}>
      <div className="row-main">
        <div className="time-cell">
          <strong>{formatSlotTime(appointment.slotTime)}</strong>
          {showDate ? (
            <small>{formatShortDate(appointment.slotDate)}</small>
          ) : (
            <small>{appointment.durationMinutes} min</small>
          )}
          {imminent && <span className="soon-flag">soon</span>}
        </div>

        <div className="patient-cell">
          <span aria-hidden>{initials(appointment.patientName)}</span>
          <div>
            <strong>{appointment.patientName ?? "Unnamed"}</strong>
            <small>{appointment.patientPhone ?? "No phone"}</small>
          </div>
        </div>

        <div>
          <strong>{serviceLabel(appointment.service)}</strong>
          <small>
            {appointment.language === "ar" ? "Arabic" : "English"}
            {appointment.source !== "website" && ` · ${appointment.source.replace("_", " ")}`}
          </small>
        </div>

        <div>
          <strong>{branchLabel(appointment.branch)}</strong>
          {branch && (
            <a
              className="row-map"
              href={branch.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin size={11} />
              Directions
            </a>
          )}
        </div>

        <div>
          <span className={`status-pill status-pill--${meta.tone}`}>{meta.label}</span>
        </div>

        <div className="row-quick">
          {appointment.patientPhone && (
            <a
              href={`tel:${appointment.patientPhone}`}
              aria-label={`Call ${appointment.patientName ?? "patient"}`}
              title="Call"
            >
              <Phone size={16} />
            </a>
          )}
          <button
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide details" : "Show details"}
            title="Details"
          >
            <ChevronRight size={16} className={expanded ? "rotate" : ""} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="row-detail">
          <div className="detail-actions">
            {appointment.status === "confirmed" && (
              <button disabled={pending} onClick={() => onAct(appointment.id, { status: "checked_in" })}>
                <LogIn size={15} />
                Check in
              </button>
            )}
            {(appointment.status === "checked_in" || appointment.status === "confirmed") && (
              <button disabled={pending} onClick={() => onAct(appointment.id, { status: "completed" })}>
                <BadgeCheck size={15} />
                Mark completed
              </button>
            )}
            {appointment.status !== "no_show" && appointment.status !== "cancelled" && (
              <button
                className="danger"
                disabled={pending}
                onClick={() => onAct(appointment.id, { status: "no_show" })}
              >
                <UserX size={15} />
                No-show
              </button>
            )}
            {appointment.status !== "cancelled" && (
              <button
                className="danger"
                disabled={pending}
                onClick={() => onAct(appointment.id, { status: "cancelled" })}
              >
                <X size={15} />
                Cancel visit
              </button>
            )}
          </div>

          {appointment.patientPhone && <PatientHistory appointmentId={appointment.id} />}

          {appointment.patientNote && (
            <p className="detail-note">
              <MessageSquare size={14} />
              <span>
                <small>From the patient</small>
                {appointment.patientNote}
              </span>
            </p>
          )}

          <div className="detail-meta">
            {appointment.patientEmail && <span>{appointment.patientEmail}</span>}
            {appointment.confirmedAt && (
              <span>Booked {new Date(appointment.confirmedAt).toLocaleString()}</span>
            )}
            {appointment.checkedInAt && (
              <span>Arrived {new Date(appointment.checkedInAt).toLocaleTimeString()}</span>
            )}
            <span>Ref {appointment.id.slice(0, 8).toUpperCase()}</span>
          </div>

          <form
            className="detail-note-form"
            onSubmit={(event) => {
              event.preventDefault();
              onAct(appointment.id, { staffNote: note });
            }}
          >
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="Clinic note — only staff can see this"
              aria-label="Clinic note"
            />
            <button disabled={pending || note === (appointment.staffNote ?? "")}>
              <Check size={15} />
              Save note
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour || 0) * 60 + (minute || 0) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */

function Insights({ summary, clinicDate }: { summary: Summary | null; clinicDate: string }) {
  if (!summary) {
    return (
      <div className="empty-state">
        <p>Loading insights…</p>
      </div>
    );
  }

  const peakDay = Math.max(1, ...summary.byDay.map((day) => day.total));
  const serviceTotal = Math.max(
    1,
    summary.byService.reduce((sum, row) => sum + row.total, 0),
  );

  // A fortnight of clinic load, filled in so quiet days still occupy their slot
  // rather than collapsing the chart into a misleadingly busy line.
  const fortnight = Array.from({ length: 14 }, (_, index) => {
    const date = clinicDate ? addDays(clinicDate, index) : "";
    return {
      key: date || `pending-${index}`,
      date,
      total: summary.byDay.find((day) => day.date === date)?.total ?? 0,
    };
  });

  return (
    <section className="insight-grid">
      <article className="insight-panel insight-panel--wide">
        <span>CLINIC LOAD</span>
        <h2>Next 14 days</h2>
        <div className="load-chart" role="img" aria-label="Appointments per day for the next fortnight">
          {fortnight.map((day) => (
            <div key={day.key} className="load-column">
              <i style={{ height: `${(day.total / peakDay) * 100}%` }} data-empty={day.total === 0} />
              <strong>{day.total || ""}</strong>
              <small>{day.date ? formatShortDate(day.date).split(" ")[0] : ""}</small>
            </div>
          ))}
        </div>
      </article>

      <article className="insight-panel">
        <span>DEMAND</span>
        <h2>By consultation</h2>
        {summary.byService.length === 0 ? (
          <p className="insight-empty">No completed or upcoming consultations in the last 30 days yet.</p>
        ) : (
          <div className="insight-bars">
            {summary.byService.map((row) => (
              <div key={row.service}>
                <span>{serviceLabel(row.service)}</span>
                <strong>{row.total}</strong>
                <i>
                  <b style={{ width: `${(row.total / serviceTotal) * 100}%` }} />
                </i>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="insight-panel">
        <span>LOCATIONS</span>
        <h2>Upcoming by clinic</h2>
        <div className="branch-list">
          {BRANCHES.map((branch) => {
            const total = summary.byBranch.find((row) => row.branch === branch.id)?.total ?? 0;
            return (
              <div key={branch.id}>
                <div>
                  <strong>{branch.en}</strong>
                  <small>{branch.addressEn}</small>
                </div>
                <span className="branch-count">{total}</span>
                <a href={branch.mapUrl} target="_blank" rel="noopener noreferrer" title="Open in Google Maps">
                  <Navigation size={14} />
                </a>
              </div>
            );
          })}
        </div>
      </article>

      <article className="insight-panel">
        <span>LAST 30 DAYS</span>
        <h2>Attendance</h2>
        <div className="attendance-grid">
          <div>
            <strong>{summary.completedLast30Days}</strong>
            <small>Completed</small>
          </div>
          <div>
            <strong>{summary.noShowLast30Days}</strong>
            <small>No-shows</small>
          </div>
          <div>
            <strong>{summary.cancelledLast30Days}</strong>
            <small>Cancelled</small>
          </div>
          <div>
            <strong>
              {summary.noShowRate}
              <small>%</small>
            </strong>
            <small>No-show rate</small>
          </div>
        </div>
        <p className="insight-footnote">
          Figures come from appointment outcomes recorded on this dashboard. Marking
          visits complete or missed is what keeps them accurate.
        </p>
      </article>

      <article className="insight-panel insight-panel--wide">
        <span>CONSULTATION MIX</span>
        <h2>What the clinic is being asked for</h2>
        <div className="mix-row">
          {SERVICES.map((service) => {
            const total = summary.byService.find((row) => row.service === service.id)?.total ?? 0;
            return (
              <div key={service.id}>
                <strong>{total}</strong>
                <small>{service.en}</small>
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}
