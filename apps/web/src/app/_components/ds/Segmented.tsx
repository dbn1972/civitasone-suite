"use client";

interface SegmentedProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export function Segmented({ options, value, onChange }: SegmentedProps) {
  return (
    <div className="seg">
      {options.map((opt) => (
        <span
          key={opt}
          className={opt === value ? "on" : undefined}
          onClick={() => onChange(opt)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onChange(opt)}
        >
          {opt}
        </span>
      ))}
    </div>
  );
}
