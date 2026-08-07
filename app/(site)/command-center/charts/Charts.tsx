"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import "./charts.css";

/**
 * Makes a scroll container reachable by keyboard — but only while it actually
 * scrolls.
 *
 * A region that scrolls and cannot be focused is unreachable without a mouse
 * (axe: scrollable-region-focusable). Setting tabindex unconditionally trades
 * that for a different defect: an empty tab stop on every chart, on a screen
 * staff navigate all day. So it is measured, and re-measured on resize.
 */
function useFocusableWhenScrollable<T extends HTMLElement>(visible = true) {
  const ref = useRef<T | null>(null);
  const [scrollable, setScrollable] = useState(false);

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    setScrollable(
      node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
    );
  }, []);

  useEffect(() => {
    // `visible` is a dependency because a hidden element measures zero in every
    // dimension; without re-measuring on reveal the table would stay
    // unreachable exactly when it first has content to scroll.
    measure();
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, visible]);

  // A tuple, not an object: reading `.ref` off a returned object inside JSX
  // counts as accessing a ref during render.
  return [ref, scrollable ? 0 : undefined] as const;
}

/**
 * Hand-authored SVG chart primitives for Clinic OS.
 *
 * No charting library. Recharts or Chart.js would add 70–100 KB gzip to a
 * dashboard whose stylesheet is already over its CI budget, and would take
 * control of exactly the two things that have caused real defects on this
 * project: colour contrast and what a screen reader hears. These are ~10 KB,
 * driven by the design tokens, and every one ships its numbers as a table.
 *
 * PALETTE. Two steps of the brand burgundy hue, validated rather than chosen:
 * OKLCH lightness in band, chroma above the gray floor, CVD separation ΔE 15.9
 * (deuteranopia) against a target of 8. The obvious alternative — a red and a
 * green — measures ΔE 1.6 under deuteranopia and would have been indistinguishable
 * to the commonest form of colour blindness.
 *
 * Every chart here follows the same rules: one baseline, thin marks, recessive
 * hairline gridlines, a 2px surface gap between touching marks, labels placed
 * selectively rather than on every point, and text in ink tokens — never in the
 * series colour.
 */

export type Sufficiency = {
  ok: boolean;
  sample: number;
  required: number;
  reason?: string;
};

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Monotone cubic interpolation (Fritsch–Carlson).
 *
 * A plain cardinal spline overshoots between points, which on a count of
 * patients draws a curve dipping below values that never occurred — the chart
 * would be asserting something the data does not say. This cannot overshoot.
 */
function monotonePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const h = points[i + 1].x - points[i].x;
    dx.push(h);
    slope.push(h === 0 ? 0 : (points[i + 1].y - points[i].y) / h);
  }

  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent.push(0); // a local extreme: flatten so the curve cannot bulge past it
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangent.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
    }
  }
  tangent.push(slope[n - 2]);

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i] / 3;
    path +=
      ` C ${points[i].x + h} ${points[i].y + tangent[i] * h}` +
      ` ${points[i + 1].x - h} ${points[i + 1].y - tangent[i + 1] * h}` +
      ` ${points[i + 1].x} ${points[i + 1].y}`;
  }
  return path;
}

/** Round an axis maximum up to a readable number rather than the raw peak. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

const formatNumber = (value: number) => value.toLocaleString("en-GB");

/* -------------------------------------------------------------------------- */
/* Frame                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Shared chrome: heading, the sufficiency refusal, the legend, and the table
 * that carries the numbers to anyone not reading the picture.
 */
export function ChartFrame({
  title,
  caption,
  sufficiency,
  legend,
  table,
  children,
}: {
  title: string;
  caption?: string;
  sufficiency?: Sufficiency;
  legend?: Array<{ label: string; token: string }>;
  table: { columns: string[]; rows: Array<Array<string | number>> };
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const thin = sufficiency && !sufficiency.ok;
  const [plotRef, plotTabIndex] = useFocusableWhenScrollable<HTMLDivElement>();
  const [tableRef, tableTabIndex] = useFocusableWhenScrollable<HTMLDivElement>(showTable);

  return (
    <figure className="chart" role="group" aria-labelledby={`${tableId}-title`}>
      <figcaption className="chart-head">
        <div>
          <h3 id={`${tableId}-title`}>{title}</h3>
          {caption && <p>{caption}</p>}
        </div>
        <button
          type="button"
          className="chart-table-toggle"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((open) => !open)}
        >
          {showTable ? "Hide numbers" : "Show numbers"}
        </button>
      </figcaption>

      {thin ? (
        <p className="chart-insufficient" role="status">
          <strong>Not enough history yet.</strong> {sufficiency?.reason}{" "}
          <span>
            {sufficiency?.sample} of {sufficiency?.required} needed.
          </span>
        </p>
      ) : (
        <>
          {/* A legend exists whenever more than one series shares an axis, so
              identity is never carried by colour alone. */}
          {legend && legend.length > 1 && (
            <ul className="chart-legend">
              {legend.map((entry) => (
                <li key={entry.label}>
                  <i style={{ background: `var(${entry.token})` }} aria-hidden />
                  {entry.label}
                </li>
              ))}
            </ul>
          )}
          <div
            className="chart-plot"
            ref={plotRef}
            tabIndex={plotTabIndex}
            role={plotTabIndex === undefined ? undefined : "region"}
            aria-label={plotTabIndex === undefined ? undefined : `${title} chart, scrollable`}
          >
            {children}
          </div>
        </>
      )}

      {/* Always rendered so it is reachable, revealed on demand. This is the
          non-visual route to the same data, and the relief the palette
          validator requires wherever a mark sits below 3:1. */}
      <div
        id={tableId}
        className="chart-table"
        hidden={!showTable}
        ref={tableRef}
        tabIndex={tableTabIndex}
        role={tableTabIndex === undefined ? undefined : "region"}
        aria-label={tableTabIndex === undefined ? undefined : `${title}, data table`}
      >
        <table>
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th key={cellIndex} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={cellIndex}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend — line + area                                                         */
/* -------------------------------------------------------------------------- */

export type TrendPoint = { label: string; value: number; muted?: boolean };

/** Hoisted out of the component so the geometry memo has a stable dependency;
 *  an object literal rebuilt each render would invalidate it on every pass. */
const TREND_W = 720;
const TREND_H = 240;
const TREND_PAD = { top: 18, right: 18, bottom: 30, left: 42 };

export function TrendChart({
  points,
  valueLabel = "Appointments",
}: {
  points: TrendPoint[];
  valueLabel?: string;
}) {
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const max = niceMax(Math.max(1, ...points.map((point) => point.value)));
    const innerW = TREND_W - TREND_PAD.left - TREND_PAD.right;
    const innerH = TREND_H - TREND_PAD.top - TREND_PAD.bottom;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    const coords = points.map((point, index) => ({
      x: TREND_PAD.left + index * step,
      y: TREND_PAD.top + innerH - (point.value / max) * innerH,
    }));
    return { max, coords, innerH, innerW };
  }, [points]);

  if (points.length === 0) return null;

  const line = monotonePath(geometry.coords);
  const baseline = TREND_H - TREND_PAD.bottom;
  const area = `${line} L ${geometry.coords[geometry.coords.length - 1].x} ${baseline} L ${geometry.coords[0].x} ${baseline} Z`;
  const ticks = [0, 0.5, 1].map((fraction) => ({
    value: Math.round(geometry.max * fraction),
    y: TREND_PAD.top + geometry.innerH * (1 - fraction),
  }));

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${TREND_W} ${TREND_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${valueLabel} over ${points.length} periods. Use Show numbers for the values.`}
      onMouseLeave={() => setActive(null)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="chart-area-top" />
          <stop offset="100%" className="chart-area-bottom" />
        </linearGradient>
      </defs>

      {/* Recessive hairline gridlines, solid — dashed rules compete with the data. */}
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line className="chart-grid" x1={TREND_PAD.left} y1={tick.y} x2={TREND_W - TREND_PAD.right} y2={tick.y} />
          <text className="chart-tick" x={TREND_PAD.left - 8} y={tick.y + 4} textAnchor="end">
            {formatNumber(tick.value)}
          </text>
        </g>
      ))}

      <path className="chart-area" d={area} fill={`url(#${gradientId})`} />
      <path className="chart-line" d={line} />

      {/* One end-marker rather than a dot on every point. */}
      {geometry.coords.length > 0 && (
        <circle
          className="chart-endpoint"
          cx={geometry.coords[geometry.coords.length - 1].x}
          cy={geometry.coords[geometry.coords.length - 1].y}
          r={4.5}
        />
      )}

      {active !== null && geometry.coords[active] && (
        <g className="chart-crosshair" aria-hidden>
          <line
            x1={geometry.coords[active].x}
            y1={TREND_PAD.top}
            x2={geometry.coords[active].x}
            y2={baseline}
          />
          <circle cx={geometry.coords[active].x} cy={geometry.coords[active].y} r={5} />
        </g>
      )}

      {/* Hit targets are the full column height, so the pointer does not have to
          find a 2px line. */}
      {geometry.coords.map((coord, index) => (
        <rect
          key={points[index].label}
          className="chart-hit"
          x={coord.x - (geometry.innerW / Math.max(1, points.length - 1)) / 2}
          y={TREND_PAD.top}
          width={geometry.innerW / Math.max(1, points.length - 1)}
          height={geometry.innerH}
          onMouseEnter={() => setActive(index)}
        >
          <title>{`${points[index].label}: ${formatNumber(points[index].value)}`}</title>
        </rect>
      ))}

      {/* First, last and the active label only — a label under every point is
          unreadable at this width. */}
      {points.map((point, index) => {
        const show = index === 0 || index === points.length - 1 || index === active;
        if (!show) return null;
        return (
          <text
            key={point.label}
            className="chart-axis-label"
            x={geometry.coords[index].x}
            y={TREND_H - 10}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
          >
            {point.label}
          </text>
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Columns                                                                     */
/* -------------------------------------------------------------------------- */

export type BarDatum = { label: string; value: number; shortLabel?: string };

export function BarChart({
  data,
  valueLabel = "Appointments",
}: {
  data: BarDatum[];
  valueLabel?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const PAD = { top: 16, right: 12, bottom: 28, left: 42 };

  if (data.length === 0) return null;

  const max = niceMax(Math.max(1, ...data.map((datum) => datum.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  // Capped rather than filling the band: the leftover is deliberate air.
  const width = Math.min(24, band - 6);
  const baseline = PAD.top + innerH;
  const ticks = [0, 0.5, 1].map((fraction) => ({
    value: Math.round(max * fraction),
    y: PAD.top + innerH * (1 - fraction),
  }));

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${valueLabel} across ${data.length} categories. Use Show numbers for the values.`}
      onMouseLeave={() => setActive(null)}
    >
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line className="chart-grid" x1={PAD.left} y1={tick.y} x2={W - PAD.right} y2={tick.y} />
          <text className="chart-tick" x={PAD.left - 8} y={tick.y + 4} textAnchor="end">
            {formatNumber(tick.value)}
          </text>
        </g>
      ))}

      {data.map((datum, index) => {
        const height = (datum.value / max) * innerH;
        const x = PAD.left + index * band + (band - width) / 2;
        return (
          <g
            key={datum.label}
            className={`chart-column${active === index ? " is-active" : ""}`}
            onMouseEnter={() => setActive(index)}
          >
            {/* Full-height hit target, so a one-appointment bar is still hoverable. */}
            <rect className="chart-hit" x={PAD.left + index * band} y={PAD.top} width={band} height={innerH}>
              <title>{`${datum.label}: ${formatNumber(datum.value)}`}</title>
            </rect>
            {datum.value > 0 && (
              <rect
                className="chart-bar"
                x={x}
                y={baseline - height}
                width={width}
                height={height}
                // Rounded at the data end, square at the baseline.
                rx={Math.min(4, width / 2)}
              />
            )}
          </g>
        );
      })}

      {/* Baseline sits above the bars in the stacking order so it reads as one
          continuous rule rather than being nicked by every column. */}
      <line className="chart-baseline" x1={PAD.left} y1={baseline} x2={W - PAD.right} y2={baseline} />

      {data.map((datum, index) => {
        const dense = data.length > 12;
        if (dense && index % 3 !== 0 && index !== active) return null;
        return (
          <text
            key={datum.label}
            className="chart-axis-label"
            x={PAD.left + index * band + band / 2}
            y={H - 8}
            textAnchor="middle"
          >
            {datum.shortLabel ?? datum.label}
          </text>
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked columns                                                             */
/* -------------------------------------------------------------------------- */

export type StackedDatum = {
  label: string;
  shortLabel?: string;
  primary: number;
  secondary: number;
  incomplete?: boolean;
};

export function StackedBarChart({
  data,
  primaryLabel,
  secondaryLabel,
}: {
  data: StackedDatum[];
  primaryLabel: string;
  secondaryLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const PAD = { top: 16, right: 12, bottom: 30, left: 42 };

  if (data.length === 0) return null;

  const max = niceMax(Math.max(1, ...data.map((datum) => datum.primary + datum.secondary)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  const width = Math.min(24, band - 8);
  const baseline = PAD.top + innerH;
  const ticks = [0, 0.5, 1].map((fraction) => ({
    value: Math.round(max * fraction),
    y: PAD.top + innerH * (1 - fraction),
  }));

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${primaryLabel} and ${secondaryLabel} across ${data.length} months. Use Show numbers for the values.`}
      onMouseLeave={() => setActive(null)}
    >
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line className="chart-grid" x1={PAD.left} y1={tick.y} x2={W - PAD.right} y2={tick.y} />
          <text className="chart-tick" x={PAD.left - 8} y={tick.y + 4} textAnchor="end">
            {formatNumber(tick.value)}
          </text>
        </g>
      ))}

      {data.map((datum, index) => {
        const x = PAD.left + index * band + (band - width) / 2;
        const secondaryH = (datum.secondary / max) * innerH;
        const primaryH = (datum.primary / max) * innerH;
        // A 2px gap in the surface colour separates the segments. Never a
        // stroke — a border round a mark adds a colour the data does not have.
        const gap = secondaryH > 0 && primaryH > 0 ? 2 : 0;
        return (
          <g
            key={datum.label}
            className={`chart-column${active === index ? " is-active" : ""}${datum.incomplete ? " is-incomplete" : ""}`}
            onMouseEnter={() => setActive(index)}
          >
            <rect className="chart-hit" x={PAD.left + index * band} y={PAD.top} width={band} height={innerH}>
              <title>
                {`${datum.label}: ${formatNumber(datum.primary)} ${primaryLabel.toLowerCase()}, ${formatNumber(datum.secondary)} ${secondaryLabel.toLowerCase()}`}
              </title>
            </rect>
            {datum.secondary > 0 && (
              <rect
                className="chart-bar chart-bar--secondary"
                x={x}
                y={baseline - secondaryH}
                width={width}
                height={secondaryH}
              />
            )}
            {datum.primary > 0 && (
              <rect
                className="chart-bar chart-bar--primary"
                x={x}
                y={baseline - secondaryH - gap - primaryH}
                width={width}
                height={primaryH}
                rx={Math.min(4, width / 2)}
              />
            )}
          </g>
        );
      })}

      <line className="chart-baseline" x1={PAD.left} y1={baseline} x2={W - PAD.right} y2={baseline} />

      {data.map((datum, index) => (
        <text
          key={datum.label}
          className="chart-axis-label"
          x={PAD.left + index * band + band / 2}
          y={H - 10}
          textAnchor="middle"
        >
          {datum.shortLabel ?? datum.label}
        </text>
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                   */
/* -------------------------------------------------------------------------- */

/** Inline trend for a stat tile. No axes, no labels — it carries shape only,
 *  and the tile beside it carries the number. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 96;
  const H = 28;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const coords = values.map((value, index) => ({
    x: (index / (values.length - 1)) * W,
    y: H - 2 - ((value - min) / span) * (H - 4),
  }));
  return (
    <svg className="chart-sparkline" viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false">
      <path d={monotonePath(coords)} />
      <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={2.5} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tile                                                                   */
/* -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  unit,
  delta,
  spark,
  note,
  hero,
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { percent: number | null; direction: "up" | "down" | "flat" | "unknown"; comparedTo: string };
  spark?: number[];
  note?: string;
  hero?: boolean;
}) {
  return (
    <article className={`stat-tile${hero ? " stat-tile--hero" : ""}`}>
      <p className="stat-tile-label">{label}</p>
      <p className="stat-tile-value">
        {value}
        {unit && <span className="stat-tile-unit">{unit}</span>}
      </p>
      {delta && (
        <p className={`stat-tile-delta stat-tile-delta--${delta.direction}`}>
          {/* Direction is carried by a glyph and by words, never by colour
              alone — the same reason status pills ship an icon. */}
          <span aria-hidden>
            {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "—"}
          </span>
          {delta.percent === null
            ? "No comparable period"
            : `${delta.percent > 0 ? "+" : ""}${delta.percent}%`}
          <small>{delta.comparedTo}</small>
        </p>
      )}
      {spark && spark.length > 1 && <Sparkline values={spark} />}
      {note && <p className="stat-tile-note">{note}</p>}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Meter                                                                       */
/* -------------------------------------------------------------------------- */

/** A single proportion — utilisation, attendance. The unfilled remainder stays
 *  neutral so the fill is the only thing carrying meaning. */
export function Meter({
  label,
  percent,
  caption,
}: {
  label: string;
  percent: number;
  caption?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="chart-meter">
      <div className="chart-meter-head">
        <span>{label}</span>
        <strong>{clamped}%</strong>
      </div>
      <div
        className="chart-meter-track"
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <i style={{ width: `${clamped}%` }} />
      </div>
      {caption && <p>{caption}</p>}
    </div>
  );
}
