"use client";

interface SegmentedProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export function Segmented({ options, value, onChange }: SegmentedProps) {
  return (
    <div className="seg" role="tablist">
      {options.map((opt) => {
        const selected = opt === value;
        return (
          <span
            key={opt}
            className={selected ? "on" : undefined}
            onClick={() => onChange(opt)}
            role="tab"
            aria-selected={selected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChange(opt);
              }
            }}
          >
            {opt}
          </span>
        );
      })}
    </div>
  );
}
