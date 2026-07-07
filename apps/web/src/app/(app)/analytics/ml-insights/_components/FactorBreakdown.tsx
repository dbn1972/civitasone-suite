"use client";

import type { FactorBreakdownEntry } from "../_data";

interface FactorBreakdownProps {
  factors: FactorBreakdownEntry[];
}

/**
 * Shows the top contributing features across all predictions for a domain.
 * Renders horizontal bars with direction indicators.
 */
export function FactorBreakdown({ factors }: FactorBreakdownProps) {
  if (factors.length === 0) {
    return (
      <div className="text-center text-gray-400 py-6">
        <p>No factor data available yet.</p>
      </div>
    );
  }

  const maxContrib = Math.max(...factors.map((f) => f.avgContribution), 0.01);

  return (
    <div role="list" aria-label="Top prediction factors">
      {factors.map((factor, i) => {
        const widthPct = (factor.avgContribution / maxContrib) * 100;
        const isPositive = factor.direction === "positive";
        return (
          <div key={i} role="listitem" className="flex items-center gap-3 py-2 border-b last:border-0">
            <span
              className="text-xs font-medium shrink-0 w-5 text-center"
              aria-label={isPositive ? "positive direction" : "negative direction"}
            >
              {isPositive ? "↑" : "↓"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium truncate">{factor.feature}</span>
                <span className="text-xs text-gray-500 ml-2">
                  {Math.round(factor.avgContribution * 100)}% · {factor.frequency}×
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: isPositive ? "#3b82f6" : "#ef4444",
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
