"use client";

/**
 * Segmented control. Options may be plain strings (value === label) or
 * {value,label} pairs so callers can show a translated label while keeping a
 * stable, locale-independent value for state/filtering (GAP-CITIZEN-REQUESTS-05).
 * The string[] form is unchanged for every existing caller.
 */
export type SegmentedOption = string | { value: string; label: string };

interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
}

function optionValue(opt: SegmentedOption): string {
  return typeof opt === "string" ? opt : opt.value;
}
function optionLabel(opt: SegmentedOption): string {
  return typeof opt === "string" ? opt : opt.label;
}

export function Segmented({ options, value, onChange }: SegmentedProps) {
  return (
    <div className="seg" role="tablist">
      {options.map((opt) => {
        const val = optionValue(opt);
        const label = optionLabel(opt);
        const selected = val === value;
        return (
          <span
            key={val}
            className={selected ? "on" : undefined}
            onClick={() => onChange(val)}
            role="tab"
            aria-selected={selected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChange(val);
              }
            }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
