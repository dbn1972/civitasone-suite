"use client";

import type { AccuracyTrendPoint } from "../_data";
import { metricBand, type MetricThresholds } from "../_metrics";

interface AccuracyTrendChartProps {
  data: AccuracyTrendPoint[];
  /** Metric name used in the accessible description (e.g. "MAPE", "AUC-ROC"). */
  metricLabel?: string;
  /** false for MAPE-style metrics where a smaller value is better. */
  higherIsBetter?: boolean;
  /** Colour cut-offs on the 0..1 axis, interpreted per `higherIsBetter`. */
  thresholds?: MetricThresholds;
}

const BAND_COLOUR: Record<"good" | "warn" | "poor", string> = {
  // DS status tokens with hex fallbacks for environments without the CSS vars.
  good: "var(--ok, #22c55e)",
  warn: "var(--warn, #f59e0b)",
  poor: "var(--err, #ef4444)",
};

const BAND_TEXT: Record<"good" | "warn" | "poor", string> = {
  good: "good",
  warn: "fair",
  poor: "poor",
};

/** dd MMM, including the year when the series spans more than one calendar year. */
function formatAxisLabel(iso: string, showYear: boolean): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: showYear ? "numeric" : undefined,
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Accuracy/metric trend as a bar chart.
 *
 * - Bars are scaled against a FIXED 0..1 axis (not the series maximum), so a
 *   flat 30% series reads as 30%-tall bars, not full height.
 * - Colour follows the domain's metric direction (MAPE: lower is better), and
 *   is backed by a non-colour status word so colour is never the only cue.
 * - A visually-hidden list exposes each date and value to screen readers;
 *   the bars themselves are aria-hidden (no aria-label on presentation nodes).
 * GAP-*-ML-INSIGHTS-*-03/04 (CHART / A11Y).
 */
export function AccuracyTrendChart({
  data,
  metricLabel = "Accuracy",
  higherIsBetter = true,
  thresholds = { good: 0.7, warn: 0.4 },
}: AccuracyTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <p>No trend data available yet.</p>
      </div>
    );
  }

  const metric = { higherIsBetter, thresholds };
  const years = new Set(
    data.map((p) => {
      const d = new Date(p.date);
      return Number.isNaN(d.getTime()) ? "" : String(d.getUTCFullYear());
    }),
  );
  const showYear = years.size > 1;
  const direction = higherIsBetter ? "higher is better" : "lower is better";

  return (
    <div>
      {/* Visually-hidden, screen-reader-accessible data table. */}
      <ul className="sr-only">
        <li>{`${metricLabel} trend over ${data.length} data points (${direction}).`}</li>
        {data.map((point, i) => {
          const band = metricBand(point.accuracy, metric);
          return (
            <li key={i}>
              {`${formatAxisLabel(point.date, showYear)}: ${Math.round(point.accuracy * 100)}% (${BAND_TEXT[band]})`}
            </li>
          );
        })}
      </ul>

      <div aria-hidden="true">
        <div className="flex items-end gap-1" style={{ height: 160 }}>
          {data.map((point, i) => {
            // Fixed 0..1 axis; clamp so a stray >1 value can't overflow.
            const heightPct = Math.min(Math.max(point.accuracy, 0), 1) * 100;
            const pctLabel = `${Math.round(point.accuracy * 100)}%`;
            const band = metricBand(point.accuracy, metric);
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end" style={{ height: "100%" }}>
                <span className="text-[10px] text-gray-500 mb-1">{pctLabel}</span>
                <div
                  className="w-full rounded-t"
                  style={{ height: `${heightPct}%`, minHeight: 4, backgroundColor: BAND_COLOUR[band] }}
                  role="presentation"
                  title={`${formatAxisLabel(point.date, showYear)}: ${pctLabel} (${BAND_TEXT[band]})`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {data.map((point, i) => (
            <div key={i} className="flex-1 text-center text-[9px] text-gray-400 truncate" title={formatAxisLabel(point.date, true)}>
              {formatAxisLabel(point.date, showYear)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
