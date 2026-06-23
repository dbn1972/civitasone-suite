interface ProgressBarProps {
  value: number;
  color?: string;
}

export function ProgressBar({ value, color }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="bar">
      <i style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}
