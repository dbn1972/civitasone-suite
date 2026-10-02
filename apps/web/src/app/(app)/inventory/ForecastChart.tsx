"use client";

import { Chart, type ChartDataPoint } from "@/app/_components/Chart";
import { ConfidenceBar } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export interface ForecastPoint {
  /** ISO date (YYYY-MM-DD) the forecasted quantity applies to. */
  date: string;
  /** Predicted demand quantity for that date. */
  qty: number;
}

interface ForecastChartProps {
  itemName: string;
  data: ForecastPoint[];
  /** Total predicted demand over the forecast window, in the item's units. */
  totalDemand?: number;
  /** Model confidence, 0..1. Omitted/0 means the service did not report one. */
  confidence?: number;
}

/**
 * Renders the item demand-forecast line chart, plus a visually-hidden
 * (but screen-reader and keyboard reachable) data table carrying the same
 * date/quantity series the chart visualizes. See requirement 3.1.
 */
export function ForecastChart({ itemName, data, totalDemand, confidence }: ForecastChartProps) {
  const chartData: ChartDataPoint[] = data.map((p) => ({
    label: formatIndianDate(p.date).slice(0, 6),
    value: p.qty,
  }));

  return (
    <div>
      <Chart type="line" data={chartData} title={`30-day demand forecast — ${itemName}`} height={180} />
      {/* GAP-INVENTORY-HOME-04: the service's total and confidence were mapped but never shown. */}
      {totalDemand !== undefined ? (
        <p style={{ margin: "8px 0 4px", fontSize: 13 }}>
          Total 30-day demand: <strong>{totalDemand.toLocaleString("en-IN")} units</strong>
        </p>
      ) : null}
      {confidence !== undefined && confidence > 0 ? (
        <div style={{ maxWidth: 280 }}>
          <span style={{ fontSize: 12, color: "var(--mut, #475569)" }}>
            Forecast confidence: {Math.round(Math.min(1, confidence) * 100)}%
          </span>
          <ConfidenceBar value={confidence} />
        </div>
      ) : null}
      <table className="sr-only" aria-label={`Forecast data table — ${itemName}`}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Predicted demand</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.date}>
              <td>{formatIndianDate(row.date)}</td>
              <td>{row.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
