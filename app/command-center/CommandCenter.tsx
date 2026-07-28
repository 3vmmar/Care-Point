"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarCheck2,
  CalendarDays,
  Clock3,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BRANCHES, SERVICES } from "@/lib/clinic";
import { CLINIC_TIMEZONE } from "@/lib/clinic";
import { clinicToday } from "@/lib/dates";

type Booking = {
  id: string;
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail?: string | null;
  language?: string;
  confirmedAt?: string | null;
};

type Summary = {
  upcoming: number;
  today: number;
  confirmedThisWeek: number;
};

type View = "Overview" | "Appointments" | "NOOR Insights";

const REFRESH_INTERVAL_MS = 15000;

const serviceLabel = (id: string) =>
  SERVICES.find((service) => service.id === id)?.en ?? id;
const branchLabel = (id: string) =>
  BRANCHES.find((branch) => branch.id === id)?.en ?? id;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: CLINIC_TIMEZONE,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function CommandCenter({ staffName }: { staffName: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("Overview");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/bookings", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Your session expired. Sign in again to view appointments."
            : "Could not reach the appointment database.",
        );
      }
      const data = (await response.json()) as {
        bookings?: Booking[];
        summary?: Summary;
      };
      setBookings(data.bookings ?? []);
      setSummary(data.summary ?? null);
      setLastUpdated(new Date());
      setLoadError("");
    } catch (error) {
      // Previously uncaught: a network blip left the dashboard silently stale.
      setLoadError(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

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

  const filtered = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return bookings;
    return bookings.filter((booking) =>
      [
        booking.patientName,
        booking.patientPhone,
        serviceLabel(booking.service),
        branchLabel(booking.branch),
        booking.slotDate,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [bookings, query]);

  const today = clinicToday();
  const visible = view === "Overview" ? filtered.slice(0, 6) : filtered;

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
        <nav>
          {(["Overview", "Appointments", "NOOR Insights"] as View[]).map((item) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
              aria-current={view === item ? "page" : undefined}
            >
              {item === "Overview" && <Activity size={17} />}
              {item === "Appointments" && <CalendarCheck2 size={17} />}
              {item === "NOOR Insights" && <Sparkles size={17} />}
              {item}
            </button>
          ))}
        </nav>
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
          <Link href="/">
            <ArrowLeft size={15} />
            Patient experience
          </Link>
        </div>
      </aside>

      <section className="command-main">
        <header className="command-header">
          <div>
            <span>LIVE CLINIC VIEW</span>
            <h1>
              {greeting()}, {staffName}.
            </h1>
          </div>
          <div className="command-header-actions">
            <label>
              <Search size={16} />
              <input
                placeholder="Search appointments"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button onClick={() => void refresh()} aria-label="Refresh appointments">
              <RefreshCw className={refreshing ? "spin" : ""} size={17} />
            </button>
            <div className="avatar">AM</div>
          </div>
        </header>

        {loadError && (
          <div className="command-alert" role="alert">
            <AlertTriangle size={15} />
            <p>{loadError}</p>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}

        {view !== "NOOR Insights" && (
          <section className="metric-grid">
            <article>
              <div><span>UPCOMING VISITS</span><CalendarCheck2 /></div>
              <strong>{summary?.upcoming ?? "—"}</strong>
              <p>Confirmed, from today onward</p>
            </article>
            <article>
              <div><span>TODAY</span><CalendarDays /></div>
              <strong>{summary?.today ?? "—"}</strong>
              <p>{formatDate(today)}</p>
            </article>
            <article>
              <div><span>BOOKED THIS WEEK</span><Clock3 /></div>
              <strong>{summary?.confirmedThisWeek ?? "—"}</strong>
              <p>Confirmed in the last 7 days</p>
            </article>
            <article>
              <div><span>CLINICS</span><MapPin /></div>
              <strong>{BRANCHES.length}</strong>
              <p>{BRANCHES.map((branch) => branch.en).join(" · ")}</p>
            </article>
          </section>
        )}

        {view === "NOOR Insights" ? (
          <section className="command-grid command-grid--single">
            <div className="schedule-card">
              <div className="card-heading">
                <div><span>NOOR SIGNAL</span><h2>Patient question trends</h2></div>
              </div>
              <div className="empty-state">
                <Sparkles size={22} />
                <h3>No conversation data yet</h3>
                <p>
                  NOOR conversations are not recorded, so there are no question
                  trends to report. Once conversation logging is enabled, the most
                  common patient questions will appear here.
                </p>
              </div>
            </div>
          </section>
        ) : (
          <section className="command-grid command-grid--single">
            <div className="schedule-card">
              <div className="card-heading">
                <div>
                  <span>APPOINTMENT FLOW</span>
                  <h2>{view === "Overview" ? "Next visits" : "All upcoming appointments"}</h2>
                </div>
                {view === "Overview" && filtered.length > 6 && (
                  <button onClick={() => setView("Appointments")}>View schedule</button>
                )}
              </div>

              {!loaded ? (
                <div className="empty-state">
                  <p>Loading appointments…</p>
                </div>
              ) : visible.length === 0 ? (
                <div className="empty-state">
                  <CalendarCheck2 size={22} />
                  <h3>{query ? "No matching appointments" : "No upcoming appointments"}</h3>
                  <p>
                    {query
                      ? "Try a different name, phone number, or clinic."
                      : "Confirmed bookings from the patient website appear here as soon as they are made."}
                  </p>
                </div>
              ) : (
                <div className="booking-table">
                  <div className="table-head">
                    <span>PATIENT</span><span>CONSULTATION</span><span>TIME &amp; PLACE</span>
                    <span>STATUS</span><span />
                  </div>
                  {visible.map((booking) => (
                    <div className="table-row" key={booking.id}>
                      <div className="patient-cell">
                        <span>{(booking.patientName ?? "?").slice(0, 1)}</span>
                        <div>
                          <strong>{booking.patientName ?? "Unnamed"}</strong>
                          <small>{booking.patientPhone ?? "No phone"}</small>
                        </div>
                      </div>
                      <div>
                        <strong>{serviceLabel(booking.service)}</strong>
                        <small>{booking.language === "ar" ? "Arabic" : "English"}</small>
                      </div>
                      <div>
                        <strong>
                          {formatDate(booking.slotDate)} · {booking.slotTime}
                        </strong>
                        <small><MapPin size={11} />{branchLabel(booking.branch)}</small>
                      </div>
                      <div>
                        <span
                          className={
                            booking.slotDate === today ? "status-pill live" : "status-pill"
                          }
                        >
                          {booking.slotDate === today ? "Today" : "Confirmed"}
                        </span>
                      </div>
                      {booking.patientPhone ? (
                        <a
                          href={`tel:${booking.patientPhone}`}
                          aria-label={`Call ${booking.patientName ?? "patient"}`}
                        >
                          <Phone size={16} />
                        </a>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
