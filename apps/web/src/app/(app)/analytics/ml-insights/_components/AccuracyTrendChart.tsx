"use client";

import type { AccuracyTrendPoint } from "../_data";

interface AccuracyTrendChartProps {
  data: AccuracyTrendPoint[];
}

/**
 * Simple accuracy trend visualization using a bar chart approach.
 * Accessible via aria-labels on each data point.
 */
export function AccuracyTrendChart({ data }: AccuracyTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8" role="img" aria-label="No accuracy trend data available">
        <p>No trend data available yet.</p>
      </div>
    );
  }

  const maxAccuracy = Math.max(...data.map((p) => p.accuracy), 0.01);

  return (
    <div role="img" aria-label={`Accuracy trend over ${data.length} data points`}>
      <div className="flex items-end gap-1" style={{ height: 160 }}>
        {data.map((point, i) => {
          const heightPct = (point.accuracy / maxAccuracy) * 100;
          const pctLabel = `${Math.round(point.accuracy * 100)}%`;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end"
              style={{ height: "100%" }}
            >
              <span className="text-[10px] text-gray-500 mb-1">{pctLabel}</span>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${heightPct}%`,
                  minHeight: 4,
                  backgroundColor: point.accuracy >= 0.7 ? "#22c55e" : point.accuracy >= 0.4 ? "#f59e0b" : "#ef4444",
                }}
                role="presentation"
                aria-label={`${point.date}: ${pctLabel} accuracy`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {data.map((point, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-gray-400 truncate">
            {point.date.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}
