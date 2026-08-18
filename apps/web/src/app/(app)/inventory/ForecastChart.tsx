"use client";

import { Chart, type ChartDataPoint } from "@/app/_components/Chart";
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
}

/**
 * Renders the item demand-forecast line chart, plus a visually-hidden
 * (but screen-reader and keyboard reachable) data table carrying the same
 * date/quantity series the chart visualizes. See requirement 3.1.
 */
export function ForecastChart({ itemName, data }: ForecastChartProps) {
  const chartData: ChartDataPoint[] = data.map((p) => ({
    label: formatIndianDate(p.date).slice(0, 6),
    value: p.qty,
  }));

  return (
    <div>
      <Chart type="line" data={chartData} title={`30-day demand forecast — ${itemName}`} height={180} />
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
