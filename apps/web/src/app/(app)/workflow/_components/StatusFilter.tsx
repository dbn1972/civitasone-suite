"use client";

/**
 * Accessible, deep-linkable status filter — a horizontal radiogroup of pills.
 * Keyboard: arrow keys move between options, Space/Enter selects. The selected
 * value is reflected in the URL by the parent (so filters are shareable).
 */
import { useRef, type KeyboardEvent } from "react";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface StatusFilterProps {
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}

export function StatusFilter({ label, options, value, onChange }: StatusFilterProps) {
  const ref = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
    if (!buttons) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = buttons[(idx + 1) % buttons.length];
      next?.focus();
      onChange(options[(idx + 1) % options.length].value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = (idx - 1 + options.length) % options.length;
      buttons[prevIdx]?.focus();
      onChange(options[prevIdx].value);
    }
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={`Filter by ${label.toLowerCase()}`}
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink2)" }}>{label}:</span>
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`pill ${selected ? "info" : "mut"} np`}
            style={{ cursor: "pointer", border: selected ? "1px solid var(--infobd)" : "1px solid var(--line)" }}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
          >
            {opt.label}
            {typeof opt.count === "number" ? ` (${opt.count})` : ""}
          </button>
        );
      })}
    </div>
  );
}
