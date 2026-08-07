"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ClinicGrowth } from "@/db/analytics-growth";
import type { LiveCatalogue } from "./types";
import {
  BarChart,
  ChartFrame,
  Meter,
  StackedBarChart,
  StatTile,
  TrendChart,
} from "./charts/Charts";
import "./overview.css";

const WINDOWS = [30, 90, 180, 365] as const;
type WindowDays = (typeof WINDOWS)[number];

/** SQLite's strftime('%w') numbers Sunday as 0, which is also the clinic's
 *  week start — Friday (5) is the closed day. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T12:00:00.000Z`),
  );
const monthShort = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(
    new Date(`${month}-01T12:00:00.000Z`),
  );

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * The executive view of Clinic OS.
 *
 * Its job is to answer "is the practice growing, and when is it busy" in one
 * screen. Every figure is derived from appointments the clinic actually took —
 * there are no projections here, and where the history is too thin to support a
 * number the chart says so instead of drawing a confident line through three
 * points.
 */
export default function Overview({
  branchFilter,
  catalogue,
}: {
  branchFilter: string;
  catalogue: LiveCatalogue | null;
}) {
  const [days, setDays] = useState<WindowDays>(90);
  const [retry, setRetry] = useState(0);
  const requestKey = `${days}:${branchFilter}:${retry}`;
  const [result, setResult] = useState<{
    key: string;
    state: "loading" | "ready" | "error";
    growth: ClinicGrowth | null;
    error: string;
  }>({ key: "", state: "loading", growth: null, error: "" });

  // A changed filter is loading immediately rather than showing the previous
  // clinic's figures for a frame.
  const current = result.key === requestKey ? result : null;
  const state = current?.state ?? "loading";
  const growth = current?.growth ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(days) });
    if (branchFilter) params.set("branch", branchFilter);

    fetch(`/api/clinic/growth?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        // Checked before the body is read: a non-JSON edge error would
        // otherwise surface to staff as a raw parse error.
        const data = (await response.json().catch(() => ({}))) as {
          growth?: ClinicGrowth;
          message?: string;
        };
        if (!response.ok || !data.growth) {
          throw new Error(data.message ?? "Clinic growth could not be loaded.");
        }
        return data.growth;
      })
      .then((data) =>
        setResult({ key: requestKey, state: "ready", growth: data, error: "" }),
      )
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setResult({
          key: requestKey,
          state: "error",
          growth: null,
          error: caught instanceof Error ? caught.message : "Clinic growth could not be loaded.",
        });
      });

    return () => controller.abort();
  }, [days, branchFilter, retry, requestKey]);

  const branchName = branchFilter
    ? catalogue?.branches.find((branch) => branch.id === branchFilter)?.en ?? branchFilter
    : "All clinics";

  const monthSpark = useMemo(
    () => (growth?.months ?? []).filter((month) => month.complete).map((month) => month.total),
    [growth],
  );

  return (
    <section className="overview" aria-labelledby="overview-title">
      <header className="overview-header">
        <div>
          <span>PRACTICE OVERVIEW</span>
          <h2 id="overview-title">Is the practice growing?</h2>
          <p>
            Derived entirely from appointments taken at {branchName.toLowerCase()}. No
            projections, and no figure shown before there is enough history to support it.
          </p>
        </div>
        <div className="overview-controls">
          <label>
            Reporting window
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value) as WindowDays)}
            >
              {WINDOWS.map((option) => (
                <option key={option} value={option}>
                  Last {option} days
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setRetry((value) => value + 1)} disabled={state === "loading"}>
            <RefreshCw size={15} className={state === "loading" ? "spin" : undefined} />
            Refresh
          </button>
        </div>
      </header>

      {state === "loading" && (
        <div className="overview-skeleton" role="status" aria-live="polite">
          <span className="sr-only">Loading practice overview…</span>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton-tile" aria-hidden />
          ))}
          <div className="skeleton-chart" aria-hidden />
        </div>
      )}

      {state === "error" && (
        <div className="overview-error" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>The overview could not be loaded</strong>
            <span>{current?.error}</span>
          </div>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}

      {state === "ready" && growth && (
        <>
          <div className="overview-tiles">
            <StatTile
              hero
              label="Appointments"
              value={growth.appointments.current.total.toLocaleString("en-GB")}
              delta={{
                percent: growth.appointments.changePercent,
                direction: growth.appointments.direction,
                comparedTo: `vs previous ${growth.window.days} days`,
              }}
              spark={monthSpark}
              note={
                growth.appointments.sufficiency.ok
                  ? undefined
                  : growth.appointments.sufficiency.reason
              }
            />
            <StatTile
              label="First-time patients"
              value={growth.newPatients.current.total.toLocaleString("en-GB")}
              delta={{
                percent: growth.newPatients.changePercent,
                direction: growth.newPatients.direction,
                comparedTo: `vs previous ${growth.window.days} days`,
              }}
              note={
                growth.newPatients.sufficiency.ok
                  ? `Matched on phone number, so only within the ${growth.identityHorizonDays}-day retention window.`
                  : growth.newPatients.sufficiency.reason
              }
            />
            <StatTile
              label="Booked ahead"
              value={growth.leadTime.medianDays ?? "—"}
              unit={growth.leadTime.medianDays === null ? undefined : " days"}
              note={
                growth.leadTime.sufficiency.ok
                  ? "Median gap between booking and visit."
                  : growth.leadTime.sufficiency.reason
              }
            />
            <StatTile
              label="Clinic utilisation"
              value={growth.utilisation.averagePercent ?? "—"}
              unit={growth.utilisation.averagePercent === null ? undefined : "%"}
              note={
                growth.utilisation.sufficiency.ok
                  ? "Booked against published capacity on open days."
                  : growth.utilisation.sufficiency.reason
              }
            />
          </div>

          {/* ---------------------------------------------------- growth --- */}
          <ChartFrame
            title="Patient growth"
            caption="First-time patients against those returning, by month. A month still running is shown faded — it is still accumulating."
            sufficiency={growth.monthsSufficiency}
            legend={[
              { label: "First visit", token: "--chart-1" },
              { label: "Returning", token: "--chart-2" },
            ]}
            table={{
              columns: ["Month", "First visit", "Returning", "Total"],
              rows: growth.months.map((month) => [
                monthLabel(month.month) + (month.complete ? "" : " (in progress)"),
                month.newPatients,
                month.returning,
                month.total,
              ]),
            }}
          >
            <StackedBarChart
              primaryLabel="First visit"
              secondaryLabel="Returning"
              data={growth.months.map((month) => ({
                label: monthLabel(month.month),
                shortLabel: monthShort(month.month),
                primary: month.newPatients,
                secondary: month.returning,
                incomplete: !month.complete,
              }))}
            />
          </ChartFrame>

          <ChartFrame
            title="Appointments by month"
            caption="Every non-hold appointment, by the month it was scheduled for."
            sufficiency={growth.monthsSufficiency}
            table={{
              columns: ["Month", "Appointments"],
              rows: growth.months.map((month) => [monthLabel(month.month), month.total]),
            }}
          >
            <TrendChart
              points={growth.months.map((month) => ({
                label: monthShort(month.month),
                value: month.total,
              }))}
            />
          </ChartFrame>

          {/* ---------------------------------------------------- demand --- */}
          <div className="overview-pair">
            <ChartFrame
              title="Busiest hours"
              caption="When appointments are scheduled across the window."
              table={{
                columns: ["Hour", "Appointments"],
                rows: growth.demandByHour.map((row) => [hourLabel(row.hour), row.total]),
              }}
            >
              <BarChart
                data={growth.demandByHour.map((row) => ({
                  label: hourLabel(row.hour),
                  shortLabel: String(row.hour),
                  value: row.total,
                }))}
              />
            </ChartFrame>

            <ChartFrame
              title="Busiest days"
              caption="Friday is the clinic's closed day."
              table={{
                columns: ["Day", "Appointments"],
                rows: growth.demandByWeekday.map((row) => [WEEKDAYS[row.weekday], row.total]),
              }}
            >
              <BarChart
                data={growth.demandByWeekday.map((row) => ({
                  label: WEEKDAYS[row.weekday],
                  shortLabel: WEEKDAYS_SHORT[row.weekday],
                  value: row.total,
                }))}
              />
            </ChartFrame>
          </div>

          {/* ------------------------------------------------- lead time --- */}
          <ChartFrame
            title="How far ahead patients book"
            caption="Measured from when a booking was confirmed to the day of the visit."
            sufficiency={growth.leadTime.sufficiency}
            table={{
              columns: ["Notice", "Bookings"],
              rows: growth.leadTime.buckets.map((bucket) => [bucket.label, bucket.total]),
            }}
          >
            <BarChart
              valueLabel="Bookings"
              data={growth.leadTime.buckets.map((bucket) => ({
                label: bucket.label,
                value: bucket.total,
              }))}
            />
          </ChartFrame>

          {/* ----------------------------------------------- operational --- */}
          <div className="overview-pair">
            <ChartFrame
              title="Clinic utilisation"
              caption="Booked appointments against the capacity the published rota actually offers. Days the clinic does not consult are excluded rather than shown as unused."
              sufficiency={growth.utilisation.sufficiency}
              table={{
                columns: ["Date", "Booked", "Capacity", "Used"],
                rows: growth.utilisation.days.map((day) => [
                  day.date,
                  day.booked,
                  day.capacity,
                  `${day.percent}%`,
                ]),
              }}
            >
              <div className="overview-meters">
                {growth.utilisation.averagePercent !== null && (
                  <Meter
                    label="Average across open days"
                    percent={growth.utilisation.averagePercent}
                  />
                )}
                <BarChart
                  valueLabel="Percent used"
                  data={growth.utilisation.days.map((day) => ({
                    label: day.date,
                    shortLabel: day.date.slice(8),
                    value: day.percent,
                  }))}
                />
              </div>
            </ChartFrame>

            <ChartFrame
              title="Running to time"
              caption="How close to the appointed time patients are checked in. This is arrival, not waiting time — the system records no consultation-start event."
              sufficiency={growth.punctuality.sufficiency}
              table={{
                columns: ["Measure", "Value"],
                rows: [
                  ["Median arrival", `${growth.punctuality.medianMinutes ?? "—"} min`],
                  ["Early or on time", growth.punctuality.earlyOrOnTime],
                  ["Late", growth.punctuality.late],
                  [
                    "Median consultation",
                    growth.consultation.medianMinutes === null
                      ? "—"
                      : `${growth.consultation.medianMinutes} min`,
                  ],
                ],
              }}
            >
              <div className="overview-meters">
                <StatTile
                  label="Median arrival"
                  value={
                    growth.punctuality.medianMinutes === null
                      ? "—"
                      : growth.punctuality.medianMinutes > 0
                        ? `+${growth.punctuality.medianMinutes}`
                        : growth.punctuality.medianMinutes
                  }
                  unit={growth.punctuality.medianMinutes === null ? undefined : " min"}
                  note="Negative is early."
                />
                <StatTile
                  label="Median consultation"
                  value={growth.consultation.medianMinutes ?? "—"}
                  unit={growth.consultation.medianMinutes === null ? undefined : " min"}
                  note={
                    growth.consultation.sufficiency.ok
                      ? "Check-in to completion."
                      : growth.consultation.sufficiency.reason
                  }
                />
              </div>
            </ChartFrame>
          </div>

          <p className="overview-footnote">
            Patient counts are matched on a normalised phone number and are
            retention-qualified: contact details cleared under the clinic&apos;s{" "}
            {growth.identityHorizonDays}-day policy cannot be linked, so this is not an
            all-time patient total. Revenue, conversion and waiting time are absent because
            the system holds no payment ledger, does not retain abandoned bookings, and
            records no consultation-start event.
          </p>
        </>
      )}
    </section>
  );
}
