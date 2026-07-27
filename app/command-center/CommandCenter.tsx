"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Booking = {
  id: string;
  branch: string;
  service: string;
  slotDate: string;
  slotTime: string;
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  confirmedAt?: string;
  live?: boolean;
};

function dateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const seededBookings: Booking[] = [
  {
    id: "DEMO-1024",
    branch: "Maadi",
    service: "Rhinoplasty consultation",
    slotDate: dateOffset(1),
    slotTime: "11:00",
    patientName: "Mariam H.",
    patientPhone: "+20 10 *** 4821",
  },
  {
    id: "DEMO-1025",
    branch: "Mohandessin",
    service: "Face & neck consultation",
    slotDate: dateOffset(1),
    slotTime: "14:00",
    patientName: "Nour A.",
    patientPhone: "+20 12 *** 0344",
  },
  {
    id: "DEMO-1026",
    branch: "Fifth Settlement",
    service: "Body contouring consultation",
    slotDate: dateOffset(2),
    slotTime: "18:00",
    patientName: "Salma K.",
    patientPhone: "+20 11 *** 7162",
  },
  {
    id: "DEMO-1027",
    branch: "Maadi",
    service: "Non-surgical aesthetics",
    slotDate: dateOffset(3),
    slotTime: "16:30",
    patientName: "Dina M.",
    patientPhone: "+20 10 *** 1994",
  },
];

export default function CommandCenter() {
  const [liveBookings, setLiveBookings] = useState<Booking[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [activeNav, setActiveNav] = useState("Overview");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/bookings", { cache: "no-store" });
      const data = (await response.json()) as { bookings?: Booking[] };
      setLiveBookings(
        (data.bookings ?? []).map((booking) => ({ ...booking, live: true })),
      );
      setLastUpdated(new Date());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 15000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const bookings = useMemo(() => {
    const all = [...liveBookings, ...seededBookings];
    const normalized = query.toLowerCase().trim();
    if (!normalized) return all;
    return all.filter((booking) =>
      [booking.patientName, booking.service, booking.branch, booking.slotDate].some(
        (value) => value.toLowerCase().includes(normalized),
      ),
    );
  }, [liveBookings, query]);

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
          {["Overview", "Appointments", "Patients", "NOOR Insights"].map((item) => (
            <button
              key={item}
              className={activeNav === item ? "active" : ""}
              onClick={() => setActiveNav(item)}
            >
              {item === "Overview" && <Activity size={17} />}
              {item === "Appointments" && <CalendarCheck2 size={17} />}
              {item === "Patients" && <UsersRound size={17} />}
              {item === "NOOR Insights" && <Sparkles size={17} />}
              {item}
            </button>
          ))}
        </nav>
        <div className="command-sidebar-bottom">
          <div className="system-status">
            <span />
            <div>
              <strong>All systems online</strong>
              <small>Booking · NOOR · CRM</small>
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
            <h1>Good morning, Dr. Ashraf.</h1>
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
            <button onClick={refresh} aria-label="Refresh">
              <RefreshCw className={refreshing ? "spin" : ""} size={17} />
            </button>
            <div className="avatar">AM</div>
          </div>
        </header>

        <div className="demo-ribbon">
          <Sparkles size={15} />
          <p>
            Tomorrow demo mode — new reservations from the patient website appear
            here automatically.
          </p>
          <span>
            Updated{" "}
            {lastUpdated.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        <section className="metric-grid">
          <article>
            <div><span>UPCOMING VISITS</span><CalendarCheck2 /></div>
            <strong>{bookings.length + 8}</strong>
            <p><TrendingUp size={13} /> 18% vs. last week</p>
          </article>
          <article>
            <div><span>NEW INQUIRIES</span><MessageCircle /></div>
            <strong>27</strong>
            <p><TrendingUp size={13} /> 9 qualified by NOOR</p>
          </article>
          <article>
            <div><span>CONFIRMATION RATE</span><CheckCircle2 /></div>
            <strong>86<small>%</small></strong>
            <p>4 awaiting confirmation</p>
          </article>
          <article>
            <div><span>AVG. RESPONSE</span><Clock3 /></div>
            <strong>38<small>s</small></strong>
            <p>Powered by NOOR concierge</p>
          </article>
        </section>

        <section className="command-grid">
          <div className="schedule-card">
            <div className="card-heading">
              <div><span>APPOINTMENT FLOW</span><h2>Next visits</h2></div>
              <button onClick={() => setActiveNav("Appointments")}>View schedule</button>
            </div>
            <div className="booking-table">
              <div className="table-head">
                <span>PATIENT</span><span>CONSULTATION</span><span>TIME & PLACE</span>
                <span>STATUS</span><span />
              </div>
              {bookings.slice(0, 6).map((booking, index) => (
                <div className="table-row" key={`${booking.id}-${index}`}>
                  <div className="patient-cell">
                    <span>{booking.patientName.slice(0, 1)}</span>
                    <div><strong>{booking.patientName}</strong><small>{booking.patientPhone}</small></div>
                  </div>
                  <div>
                    <strong>{booking.service}</strong>
                    <small>{booking.live ? "Website booking" : "Demo patient"}</small>
                  </div>
                  <div>
                    <strong>{formatDate(booking.slotDate)} · {booking.slotTime}</strong>
                    <small><MapPin size={11} />{booking.branch}</small>
                  </div>
                  <div>
                    <span className={booking.live ? "status-pill live" : "status-pill"}>
                      {booking.live ? "New" : "Confirmed"}
                    </span>
                  </div>
                  <button aria-label="More options"><MoreHorizontal size={17} /></button>
                </div>
              ))}
            </div>
          </div>

          <aside className="insight-card">
            <div className="insight-orb"><span /><span /></div>
            <span>NOOR SIGNAL</span>
            <h2>Patients are asking about recovery.</h2>
            <p>
              42% of this week’s conversations mention return-to-work timing,
              swelling, or aftercare.
            </p>
            <div className="insight-bars">
              <div><span>Recovery timeline</span><strong>82</strong><i><b style={{ width: "82%" }} /></i></div>
              <div><span>Expected results</span><strong>64</strong><i><b style={{ width: "64%" }} /></i></div>
              <div><span>Cost & payment</span><strong>49</strong><i><b style={{ width: "49%" }} /></i></div>
            </div>
            <button>Turn insight into content <Sparkles size={14} /></button>
          </aside>
        </section>
      </section>
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
}
