"use client";

import { forwardRef } from "react";

/**
 * GAP-REVENUE-ASSESSMENTS-02: a native select for choosing an assessee by name,
 * replacing raw 36-char UUID entry. Labelled `ownerName — identifierNo` so a
 * clerk never copies a UUID between screens. Options are passed in by the page
 * (server-fetched from /v1/revenue/assessees); the selected value is still the
 * assessee's UUID so the submit payload is unchanged.
 *
 * Shared under revenue/_components so bills/instalments/receipts/recovery/bbps
 * can reuse it instead of each duplicating an inline select.
 */
export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType?: string;
};

export const AssesseeSelect = forwardRef<
  HTMLSelectElement,
  {
    id: string;
    value: string;
    onChange: (v: string) => void;
    options: AssesseeOption[];
    required?: boolean;
    invalid?: boolean;
    describedBy?: string;
    placeholder?: string;
  }
>(function AssesseeSelect(
  { id, value, onChange, options, required, invalid, describedBy, placeholder = "Select an assessee…" },
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
          {o.ownerName} — {o.identifierNo}
        </option>
      ))}
    </select>
  );
});
