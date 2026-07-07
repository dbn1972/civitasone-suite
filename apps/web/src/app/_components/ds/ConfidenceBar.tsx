"use client";

export interface ConfidenceBarProps {
  /** Confidence value between 0.0 and 1.0 */
  value: number;
  /** Optional height in pixels (default 8) */
  height?: number;
  /** Optional aria-label override */
  ariaLabel?: string;
}

/**
 * ConfidenceBar — a horizontal bar visualization showing confidence level.
 * Color-coded: green (>0.70), amber (0.40–0.70), red (<0.40).
 */
export function ConfidenceBar({ value, height = 8, ariaLabel }: ConfidenceBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const pct = Math.round(clamped * 100);

  const color = clamped > 0.7
    ? "bg-green-500"
    : clamped >= 0.4
      ? "bg-amber-500"
      : "bg-red-500";

  const label = ariaLabel ?? `Confidence: ${pct}%`;

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
      style={{ height: `${height}px` }}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
