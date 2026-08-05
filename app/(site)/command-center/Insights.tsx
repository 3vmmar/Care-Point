"use client";

import {
  Activity,
  AlertTriangle,
  CreditCard,
  Image as ImageIcon,
  RefreshCw,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { SERVICES } from "@/lib/clinic";
import { formatShortDate } from "@/lib/dates";
import {
  STATUS_META,
  type AnalyticsWindowDays,
  type ClinicAnalytics,
  type LiveCatalogue,
} from "./types";

const WINDOW_OPTIONS: AnalyticsWindowDays[] = [30, 90, 180];

type LoadState = "loading" | "ready" | "error";

function compactDate(key: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${key}T12:00:00.000Z`));
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function BarList({
  rows,
  label,
  empty,
}: {
  rows: Array<{ key: string; label: string; total: number }>;
  label: string;
  empty: string;
}) {
  const maximum = Math.max(0, ...rows.map((row) => row.total));
  if (maximum === 0) return <p className="insight-empty">{empty}</p>;

  return (
    <div className="analytics-bars" role="list" aria-label={label}>
      {rows.map((row) => {
        const tooltip = `${row.label}: ${row.total}`;
        return (
          <div
            className="analytics-bar analytics-tooltip"
            key={row.key}
            role="listitem"
            tabIndex={0}
            aria-label={tooltip}
            data-tooltip={tooltip}
            title={tooltip}
          >
            <span>{row.label}</span>
            <strong>{row.total}</strong>
            <i aria-hidden>
              <b style={{ width: `${(row.total / maximum) * 100}%` }} />
            </i>
          </div>
        );
      })}
    </div>
  );
}

function CoverageCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <article>
      <div aria-hidden>{icon}</div>
      <span>NO DATA SOURCE</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

export default function Insights({
  branchFilter,
  catalogue,
}: {
  branchFilter: string;
  catalogue: LiveCatalogue | null;
}) {
  const [days, setDays] = useState<AnalyticsWindowDays>(30);
  const [retry, setRetry] = useState(0);
  const requestKey = `${days}:${branchFilter}:${retry}`;
  const [result, setResult] = useState<{
    key: string;
    state: LoadState;
    analytics: ClinicAnalytics | null;
    error: string;
    updatedAt: Date | null;
  }>({
    key: "",
    state: "loading",
    analytics: null,
    error: "",
    updatedAt: null,
  });
  // A changed filter is loading immediately, before the effect for the new key
  // starts. This avoids a frame showing the previous clinic's figures.
  const current = result.key === requestKey ? result : null;
  const state: LoadState = current?.state ?? "loading";
  const analytics = current?.analytics ?? null;
  const error = current?.error ?? "";
  const updatedAt = current?.updatedAt ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(days) });
    if (branchFilter) params.set("branch", branchFilter);

    fetch(`/api/clinic/analytics?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          analytics?: ClinicAnalytics;
          message?: string;
        };
        if (!response.ok || !data.analytics) {
          throw new Error(data.message ?? "Clinic analytics could not be loaded.");
        }
        return data.analytics;
      })
      .then((data) => {
        setResult({
          key: requestKey,
          state: "ready",
          analytics: data,
          error: "",
          updatedAt: new Date(),
        });
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setResult({
          key: requestKey,
          state: "error",
          analytics: null,
          error:
            caught instanceof Error
              ? caught.message
              : "Clinic analytics could not be loaded.",
          updatedAt: null,
        });
      });

    return () => controller.abort();
  }, [days, branchFilter, retry, requestKey]);

  const serviceNames = useMemo(
    () =>
      new Map(
        (catalogue?.services ?? SERVICES).map((service) => [service.id, service.en]),
      ),
    [catalogue],
  );
  const branchName = branchFilter
    ? catalogue?.branches.find((branch) => branch.id === branchFilter)?.en ?? branchFilter
    : "All clinics";
  const trendMaximum = analytics
    ? Math.max(1, ...analytics.trend.map((point) => point.total))
    : 1;

  return (
    <section className="analytics-workspace" aria-labelledby="analytics-title">
      <header className="analytics-header">
        <div>
          <span>REAL CLINIC DATA</span>
          <h2 id="analytics-title">Practice insights</h2>
          <p>
            Aggregate appointment records for {branchName.toLowerCase()}. No estimates or
            invented clinical results.
          </p>
        </div>
        <div className="analytics-controls">
          <label>
            Reporting window
            <select
              value={days}
              onChange={(event) =>
                setDays(Number(event.target.value) as AnalyticsWindowDays)
              }
            >
              {WINDOW_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option} days
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            disabled={state === "loading"}
          >
            <RefreshCw size={15} className={state === "loading" ? "spin" : undefined} />
            Refresh
          </button>
        </div>
      </header>

      {state === "loading" && (
        <div className="analytics-loading" role="status" aria-live="polite">
          <RefreshCw size={20} className="spin" />
          <div>
            <strong>Loading real appointment data</strong>
            <span>Calculating patient cohorts, demand and attendance…</span>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="analytics-error" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>Insights could not be loaded</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}

      {state === "ready" && analytics && (
        <>
          <div className="analytics-period" role="status">
            <span>{branchName}</span>
            <span>
              {formatShortDate(analytics.window.from)} — {formatShortDate(analytics.window.to)}
            </span>
            {updatedAt && (
              <span>
                Refreshed {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          <section className="insight-grid">
            <article className="insight-panel insight-panel--wide analytics-patients">
              <span>PATIENT COHORT</span>
              <h2>Known patients in retained records</h2>
              <div className="analytics-kpis">
                <div>
                  <Users size={18} aria-hidden />
                  <strong>{analytics.patients.known}</strong>
                  <span>Known patients</span>
                </div>
                <div>
                  <strong>{analytics.patients.new}</strong>
                  <span>New in this window</span>
                </div>
                <div>
                  <strong>{analytics.patients.returning}</strong>
                  <span>Returning</span>
                </div>
              </div>
              {analytics.patients.known === 0 ? (
                <p className="insight-empty">No retained patient contact records fall in this window.</p>
              ) : null}
              <p className="insight-footnote">
                Patients are matched by normalized phone number. This is retention-qualified:
                contact details already purged under clinic policy cannot be linked, so this is
                not an all-time patient total.
              </p>
            </article>

            <article className="insight-panel insight-panel--wide">
              <span>SCHEDULED TREND</span>
              <h2>Appointments by {analytics.window.bucketDays === 1 ? "day" : "week"}</h2>
              {Math.max(...analytics.trend.map((point) => point.total), 0) === 0 ? (
                <p className="insight-empty">No scheduled appointments fall in this window.</p>
              ) : (
                <div className="analytics-trend-scroll">
                  <ol className="analytics-trend" aria-label="Scheduled appointment trend">
                    {analytics.trend.map((point) => {
                      const range =
                        point.from === point.to
                          ? compactDate(point.from)
                          : `${compactDate(point.from)} to ${compactDate(point.to)}`;
                      const tooltip = `${range}: ${point.total} appointment${point.total === 1 ? "" : "s"}`;
                      return (
                        <li
                          key={point.from}
                          className="analytics-tooltip"
                          tabIndex={0}
                          aria-label={tooltip}
                          data-tooltip={tooltip}
                          title={tooltip}
                        >
                          <strong>{point.total}</strong>
                          <i aria-hidden>
                            <b
                              style={
                                {
                                  "--analytics-height": `${(point.total / trendMaximum) * 100}%`,
                                } as CSSProperties
                              }
                            />
                          </i>
                          <time dateTime={point.from}>{compactDate(point.from)}</time>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
              <p className="insight-footnote">
                Based on appointment dates and includes every non-hold status. Longer windows
                are grouped weekly to remain readable.
              </p>
            </article>

            <article className="insight-panel">
              <span>APPOINTMENT STATUS</span>
              <h2>Where scheduled visits stand</h2>
              <BarList
                label="Appointments by current status"
                empty="No appointment statuses are available in this window."
                rows={analytics.statuses.map((row) => ({
                  key: row.status,
                  label: STATUS_META[row.status].label,
                  total: row.total,
                }))}
              />
            </article>

            <article className="insight-panel">
              <span>REQUESTED SERVICES</span>
              <h2>What patients asked to book</h2>
              <BarList
                label="Booking requests by service"
                empty="No booking requests were confirmed in this window."
                rows={analytics.requestedServices.map((row) => ({
                  key: row.service,
                  label: serviceNames.get(row.service) ?? row.service,
                  total: row.total,
                }))}
              />
              <p className="insight-footnote">
                Counted when a booking was confirmed, including later cancellations and
                no-shows. This measures demand, not procedures performed.
              </p>
            </article>

            <article className="insight-panel insight-panel--wide">
              <span>TREATMENT AREA MIX</span>
              <h2>Requests across the clinic</h2>
              <BarList
                label="Booking requests by treatment area"
                empty="No treatment-area demand is available in this window."
                rows={analytics.categories.map((row) => ({
                  key: row.category,
                  label: row.label,
                  total: row.total,
                }))}
              />
              <p className="insight-footnote">
                Dental, Face, Breast and Body are explicit service mappings. Broad or
                unclassified consultations remain visible as Other instead of being guessed.
              </p>
            </article>

            <article className="insight-panel">
              <span>ATTENDANCE OUTCOMES</span>
              <h2>Completed versus missed</h2>
              {analytics.attendance.decided === 0 ? (
                <p className="insight-empty">
                  No visits have been marked completed or no-show in this window.
                </p>
              ) : (
                <div className="attendance-grid">
                  <div>
                    <strong>{analytics.attendance.completed}</strong>
                    <small>Completed</small>
                  </div>
                  <div>
                    <strong>{analytics.attendance.noShow}</strong>
                    <small>No-shows</small>
                  </div>
                  <div>
                    <strong>
                      {analytics.attendance.attendedRate}
                      <small>%</small>
                    </strong>
                    <small>Attendance rate</small>
                  </div>
                </div>
              )}
              <p className="insight-footnote">
                These are operational attendance outcomes only, not clinical results.
              </p>
            </article>

            <article className="insight-panel">
              <span>BOOKING SOURCE</span>
              <h2>How requests reached the clinic</h2>
              <BarList
                label="Booking requests by source"
                empty="No booking-source activity is available in this window."
                rows={analytics.sources.map((row) => ({
                  key: row.source,
                  label: titleCase(row.source),
                  total: row.total,
                }))}
              />
            </article>

            <article className="insight-panel insight-panel--wide">
              <span>PRACTITIONER LOAD</span>
              <h2>Appointments handled by clinician</h2>
              <BarList
                label="Scheduled appointments by practitioner"
                empty="No clinician load is available in this window."
                rows={analytics.practitioners.map((row, index) => ({
                  key: row.practitioner ?? `unassigned-${index}`,
                  label: row.practitioner ?? "Unassigned legacy records",
                  total: row.total,
                }))}
              />
              <p className="insight-footnote">
                Cancelled visits are excluded. Legacy appointments without a stored clinician
                remain visible as unassigned.
              </p>
            </article>
          </section>
        </>
      )}

      <section className="analytics-coverage" aria-labelledby="coverage-title">
        <div>
          <span>DATA COVERAGE</span>
          <h2 id="coverage-title">Not recorded in Clinic OS</h2>
          <p>
            A missing source is shown honestly—not converted into a misleading zero.
          </p>
        </div>
        <div className="analytics-coverage-grid">
          <CoverageCard icon={<CreditCard size={20} />} title="Payments">
            There is no invoice, payment or refund ledger connected to this system.
          </CoverageCard>
          <CoverageCard icon={<Activity size={20} />} title="Clinical progress & outcomes">
            Appointment status and staff notes do not constitute a structured clinical outcome
            or progress measure.
          </CoverageCard>
          <CoverageCard icon={<ImageIcon size={20} />} title="Before & after activity">
            No consented patient-media library or before-and-after activity log is stored here.
          </CoverageCard>
        </div>
      </section>
    </section>
  );
}
