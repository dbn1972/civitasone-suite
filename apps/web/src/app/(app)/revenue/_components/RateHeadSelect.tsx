"use client";

import { forwardRef } from "react";

/**
 * GAP-REVENUE-ASSESSMENTS-02: a native select for choosing a rate head by name,
 * replacing raw UUID entry. Labelled `name (code)`. The selected value remains
 * the rate head's UUID so the submit payload is unchanged. Options are passed
 * in by the page (server-fetched from /v1/revenue/rate-heads).
 */
export type RateHeadOption = {
  id: string;
  code: string;
  name: string;
};

export const RateHeadSelect = forwardRef<
  HTMLSelectElement,
  {
    id: string;
    value: string;
    onChange: (v: string) => void;
    options: RateHeadOption[];
    required?: boolean;
    invalid?: boolean;
    describedBy?: string;
    placeholder?: string;
  }
>(function RateHeadSelect(
  { id, value, onChange, options, required, invalid, describedBy, placeholder = "Select a rate head…" },
  ref,
) {
  return (
    <select
      id={id}
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} ({o.code})
        </option>
      ))}
    </select>
  );
});
