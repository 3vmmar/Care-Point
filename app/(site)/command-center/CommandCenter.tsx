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
  Radar,
  BellRing,
  Search,
  ShieldCheck,
  UserX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "./command-center.css";
import { BRANCHES, CLINIC_TIMEZONE, branchLabel, findBranch, serviceLabel } from "@/lib/clinic";
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
  type LiveCatalogue,
  type Summary,
} from "./types";

type View =
  | "Today"
  | "Week"
  | "Schedule"
  | "Insights"
  | "Requests"
  | "Notifications"
  | "Hours"
  | "Pilot";

const ALL_VIEWS: View[] = [
  "Today",
  "Week",
  "Schedule",
  "Insights",
  "Requests",
  "Notifications",
  "Hours",
  "Pilot",
];

/**
 * The permission each section's data actually needs.
 *
 * A read-only auditor opening "Today" would see an empty list and an error,
 * because `/api/bookings` refuses them — so the section is not offered. The
 * server refuses regardless; this only keeps the dashboard honest about what it
 * can do.
 */
const VIEW_PERMISSIONS: Record<View, string> = {
  Today: "patient:read",
  Week: "patient:read",
  Schedule: "patient:read",
  Insights: "patient:read",
  Requests: "dsr:read",
  Notifications: "notifications:read",
  // Everyone who works here needs to know when the clinic is open; only an owner
  // or the doctor can change it, which the editor enforces separately.
  Hours: "patient:read",
  Pilot: "pilot:read",
};

const REFRESH_INTERVAL_MS = 20000;
const PAGE_SIZE = 50;

// The hours editor is opened a few times a month, not on every shift. Its
// markup and stylesheet stay out of the dashboard's first paint.
const ClinicHours = dynamic(() => import("./ClinicHours"), {
  loading: () => <p className="pilot-loading">Loading the clinic timetable…</p>,
});

// Pilot operations are never needed on the patient surface or the dashboard's
// first view. Keep its controls and CSS out of both critical paths.
const PilotControl = dynamic(() => import("./PilotControl"), {
  ssr: false,
  loading: () => <p className="pilot-loading">Loading Pilot Control…</p>,
});

// Historical cohorts perform deliberately heavier aggregate reads than the day
// view. Load both the interface and its API request only when Insights is opened.
const Insights = dynamic(() => import("./Insights"), {
  loading: () => <p className="pilot-loading">Preparing clinic insights…</p>,
});

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function CommandCenter({
  staffName,
  roleSummary,
  permissions,
}: {
  staffName: string;
  roleSummary: string;
  /**
   * What this person may do. Used to hide controls that would only return 403.
   *
   * A UI affordance, never the boundary: every one of these is enforced again on
   * the server, because a hidden button is still a reachable endpoint.
   */
  permissions: readonly string[];
}) {
  const allows = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  );
  const views = useMemo(
    () => ALL_VIEWS.filter((item) => allows(VIEW_PERMISSIONS[item])),
    [allows],
  );
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [clinicDate, setClinicDate] = useState("");
  const [clinicTime, setClinicTime] = useState("");
  const [capacity, setCapacity] = useState<CapacityDay[]>([]);
  /** The live rota, so every schedule the dashboard draws matches the booking page. */
  const [catalogue, setCatalogue] = useState<LiveCatalogue | null>(null);
  /** Reasons offered when staff cancel, so the answer can be counted later. */
  const [cancellationReasons, setCancellationReasons] = useState<
    Array<{ code: string; labelEn: string }>
  >([]);
  const [arrivals, setArrivals] = useState<Appointment[]>([]);
  const [allowlistConfigured, setAllowlistConfigured] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // An auditor has no patient views at all, so the landing section is the first
  // one their role can actually load rather than a "Today" that 403s.
  const [view, setView] = useState<View>(
    () => ALL_VIEWS.find((item) => permissions.includes(VIEW_PERMISSIONS[item])) ?? "Today",
  );
  const [query, setQuery] = useState("");
  const [serverQuery, setServerQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [exporting, setExporting] = useState(false);
  /** Outstanding data-subject requests, badged in the nav. */
  const [pendingRequests, setPendingRequests] = useState(0);
  const [notificationIssues, setNotificationIssues] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Ids present at the last refresh; `null` until the first load settles. */
  const seenIds = useRef<Set<string> | null>(null);

  const today = view === "Today";
  const wide = view === "Today" || view === "Week";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setServerQuery(query.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

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
        if (serverQuery) params.set("q", serverQuery);
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
        catalogue?: LiveCatalogue;
        cancellationReasons?: Array<{ code: string; labelEn: string }>;
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
      if (data.catalogue) setCatalogue(data.catalogue);
      if (data.cancellationReasons) setCancellationReasons(data.cancellationReasons);
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
  }, [wide, page, branchFilter, statusFilter, serverQuery]);

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
        if (allows("patient:write")) setAddOpen(true);
      } else if (event.key >= "1" && event.key <= "7") {
        // Numbered against the sections this role can see, so the shortcuts match
        // the sidebar rather than a fixed list with gaps in it.
        const target = views[Number(event.key) - 1];
        if (target) setView(target);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [refresh, views, allows]);

  const act = useCallback(
    async (
      id: string,
      body: {
        status?: AppointmentStatus;
        staffNote?: string;
        cancellationReason?: string;
        cancellationNote?: string;
      },
    ) => {
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
        item.practitioner,
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

  /**
   * Asks the server for the file.
   *
   * Built here once, from the rows already on screen — but that left no record of
   * who had taken a copy of the register, and could not be refused to a role that
   * should not have one. The server now produces it, checks `patient:export`, and
   * writes an audit entry.
   */
  async function exportCsv() {
    setExporting(true);
    setActionError("");
    try {
      const params = new URLSearchParams();
      if (clinicDate) params.set("from", clinicDate);
      if (today && clinicDate) params.set("to", clinicDate);
      else if (clinicDate) params.set("to", addDays(clinicDate, 13));
      if (branchFilter) params.set("branch", branchFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (serverQuery) params.set("q", serverQuery);

      const response = await fetch(`/api/clinic/export?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? "That export was refused.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `care-point-${today && clinicDate ? clinicDate : "schedule"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That export failed.");
    } finally {
      setExporting(false);
    }
  }

  const todayCapacity = capacity.find((day) => day.date === clinicDate) ?? null;
  const hour = Number(clinicTime.slice(0, 2) || "9");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="command-shell">
      <a className="skip-link" href="#clinic-content">
        Skip to clinic workspace
      </a>
      <aside className="command-sidebar">
        <div className="command-brand">
          <span>AM</span>
          <div>
            <strong>CLINIC OS</strong>
            <small>COMMAND CENTER</small>
          </div>
        </div>

        <nav aria-label="Dashboard sections">
          {views.map((item, index) => (
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
              {item === "Hours" && <Clock3 size={18} />}
              {item === "Pilot" && <Radar size={18} />}
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
            {(catalogue?.branches ?? BRANCHES).map((branch) => (
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
          <a href="/command-center/security">
            <ShieldCheck size={15} />
            Security &amp; access
          </a>
          <a href="https://drashrafmetwally.com">
            <ArrowLeft size={15} />
            Patient experience
          </a>
        </div>
      </aside>

      <section className="command-main" id="clinic-content" tabIndex={-1}>
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
            {allows("patient:write") && (
              <button className="ghost-button" onClick={() => setAddOpen(true)}>
                <Plus size={16} />
                Add appointment
              </button>
            )}
            <button
              className="icon-button"
              onClick={() => void refresh()}
              aria-label="Refresh appointments"
              title="Refresh (R)"
            >
              <RefreshCw className={refreshing ? "spin" : ""} size={17} />
            </button>
            <div className="avatar" title={`${staffName} · ${roleSummary}`}>
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

        {view !== "Insights" && view !== "Pilot" && view !== "Hours" && (
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
                  {allows("patient:export") && (
                    <button
                      onClick={() => void exportCsv()}
                      disabled={visible.length === 0 || exporting}
                    >
                      <Download size={15} />
                      {exporting ? "Preparing…" : "Export CSV"}
                    </button>
                  )}
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
                cancellationReasons={cancellationReasons}
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
                catalogue={catalogue}
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
                {allows("patient:export") && (
                  <button
                    onClick={() => void exportCsv()}
                    disabled={visible.length === 0 || exporting}
                  >
                    <Download size={15} />
                    {exporting ? "Preparing…" : "Export CSV"}
                  </button>
                )}
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
                {allows("patient:export") && (
                  <button
                    onClick={() => void exportCsv()}
                    disabled={visible.length === 0 || exporting}
                  >
                    <Download size={15} />
                    {exporting ? "Preparing…" : "Export CSV"}
                  </button>
                )}
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
              cancellationReasons={cancellationReasons}
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

        {view === "Insights" && (
          <Insights
            branchFilter={branchFilter}
            catalogue={catalogue}
          />
        )}

        {view === "Hours" && <ClinicHours />}

        {view === "Requests" && <DataRequests />}

        {view === "Notifications" && (
          <NotificationCenter onIssueCount={setNotificationIssues} />
        )}

        {view === "Pilot" && <PilotControl />}
      </section>

      {addOpen && (
        <AddAppointment
          catalogue={catalogue}
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
            {serviceLabel(appointment.service)}
            {appointment.practitioner ? ` · ${appointment.practitioner}` : ""}
            {` · ${branchLabel(appointment.branch)}`}
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
  cancellationReasons,
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
  onAct: (
    id: string,
    body: {
      status?: AppointmentStatus;
      staffNote?: string;
      cancellationReason?: string;
      cancellationNote?: string;
    },
  ) => void;
  clinicTime: string;
  cancellationReasons: Array<{ code: string; labelEn: string }>;
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
          cancellationReasons={cancellationReasons}
          showDate={showDate}
        />
      ))}
    </div>
  );
}

/**
 * Cancelling a visit, with the reason captured at the moment it is known.
 *
 * Two steps rather than one button: the first press reveals the reason, the
 * second commits. That is deliberate — cancelling was previously a single click
 * on a row that might not be the one reception meant, and this is the only
 * irreversible-feeling action in the day view.
 *
 * The reason is optional. Reception is often told nothing, and forcing a choice
 * would only teach them to always pick the first one, which is worse than null.
 */
function CancelVisit({
  pending,
  reasons,
  onCancel,
}: {
  pending: boolean;
  reasons: Array<{ code: string; labelEn: string }>;
  onCancel: (reason: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button className="danger" disabled={pending} onClick={() => setOpen(true)}>
        <X size={15} />
        Cancel visit
      </button>
    );
  }

  return (
    <div className="cancel-visit">
      {reasons.length > 0 && (
        <select
          value={reason}
          aria-label="Reason for cancelling"
          onChange={(event) => setReason(event.target.value)}
        >
          <option value="">Reason not given</option>
          {reasons.map((item) => (
            <option key={item.code} value={item.code}>
              {item.labelEn}
            </option>
          ))}
        </select>
      )}
      <button
        className="danger"
        disabled={pending}
        onClick={() => {
          onCancel(reason || undefined);
          setOpen(false);
          setReason("");
        }}
      >
        <Check size={15} />
        Confirm cancel
      </button>
      <button disabled={pending} onClick={() => setOpen(false)}>
        Keep it
      </button>
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
  cancellationReasons,
  showDate,
}: {
  appointment: Appointment;
  expanded: boolean;
  onToggle: () => void;
  pending: boolean;
  onAct: (
    id: string,
    body: {
      status?: AppointmentStatus;
      staffNote?: string;
      cancellationReason?: string;
      cancellationNote?: string;
    },
  ) => void;
  clinicTime: string;
  cancellationReasons: Array<{ code: string; labelEn: string }>;
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
    <div
      className={`table-row${expanded ? " table-row--open" : ""}`}
      data-appointment-id={appointment.id}
    >
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
            {appointment.practitioner ? `${appointment.practitioner} · ` : ""}
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
              <CancelVisit
                pending={pending}
                reasons={cancellationReasons}
                onCancel={(cancellationReason) =>
                  onAct(appointment.id, { status: "cancelled", cancellationReason })
                }
              />
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
