interface ProgressBarProps {
  value: number;
  color?: string;
  /**
   * GAP-TENANT-ADMIN-READINESS-05: accessible name for the progress bar. When
   * provided, the bar exposes role="progressbar" with aria-valuenow/min/max so
   * a screen reader announces e.g. "Overall completion 75%". Additive — callers
   * that omit it keep the previous presentation-only markup.
   */
  label?: string;
}

export function ProgressBar({ value, color, label }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  const a11y = label
    ? {
        role: "progressbar" as const,
        "aria-label": label,
        "aria-valuenow": Math.round(pct),
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuetext": `${Math.round(pct)}%`,
      }
    : {};
  return (
    <div className="bar" {...a11y}>
      <i style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}
