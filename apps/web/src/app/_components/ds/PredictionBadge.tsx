"use client";

import { ExplainabilityTooltip, type ExplainabilityFactor } from "./ExplainabilityTooltip";

export interface PredictionBadgeProps {
  /** Confidence value between 0.0 and 1.0 */
  confidence: number;
  /** Display label (e.g., "72% conversion") */
  label: string;
  /** Explainability factors shown in tooltip */
  factors?: ExplainabilityFactor[];
  /** Whether this prediction used a fallback model */
  isFallback?: boolean;
  /** Staleness indicator (e.g., "3h ago") */
  staleness?: string;
}

function getConfidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence > 0.7) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}

function getColorClasses(level: "high" | "medium" | "low"): string {
  switch (level) {
    case "high":
      return "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700";
    case "medium":
      return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700";
    case "low":
      return "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700";
  }
}

/**
 * PredictionBadge — inline colored badge showing ML prediction confidence.
 * Colors: green (>0.70), amber (0.40–0.70), red (<0.40).
 * Keyboard accessible: focusable via tabIndex, tooltip shown on focus.
 * Includes full aria-label with text explanation.
 */
export function PredictionBadge({
  confidence,
  label,
  factors,
  isFallback,
  staleness,
}: PredictionBadgeProps) {
  const level = getConfidenceLevel(confidence);
  const colorClasses = getColorClasses(level);
  const pct = Math.round(confidence * 100);

  const ariaLabel = `${label}, ${level} confidence${isFallback ? ", fallback model" : ""}${staleness ? `, predicted ${staleness}` : ""}`;

  const badge = (
    <span
      tabIndex={0}
      role="status"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${colorClasses}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      <span>{label}</span>
      {isFallback && (
        <span
          className="ml-0.5 text-[10px] opacity-70"
          aria-hidden="true"
          title="Fallback model used"
        >
          ⚠
        </span>
      )}
      {staleness && (
        <span className="ml-0.5 text-[10px] opacity-60" aria-hidden="true">
          {staleness}
        </span>
      )}
    </span>
  );

  if (factors && factors.length > 0) {
    return (
      <ExplainabilityTooltip factors={factors}>
        {badge}
      </ExplainabilityTooltip>
    );
  }

  return badge;
}
