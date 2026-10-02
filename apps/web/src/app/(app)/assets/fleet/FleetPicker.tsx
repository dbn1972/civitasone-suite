"use client";

import type { Ref } from "react";
import type { PickerOption } from "./_data/labels";

const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

type Props = {
  id: string;
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  error?: string;
  errorId: string;
  /** The list fetch failed -- say so instead of "nothing registered". */
  loadFailed?: boolean;
  /** Shown (with the link) when the list is genuinely empty. */
  emptyHint: string;
  emptyHref: string;
  selectRef?: Ref<HTMLSelectElement>;
};

/**
 * Select-by-label picker for fleet entities (GAP-ASSETS-FLEET-DEVICES-01,
 * GAP-ASSETS-FLEET-MAINTENANCE-02, GAP-ASSETS-FLEET-VEHICLES-01). The value
 * submitted is the entity id; the clerk only ever sees the label.
 */
export function FleetPicker({ id, label, options, value, onChange, error, errorId, loadFailed, emptyHint, emptyHref, selectRef }: Props) {
  const empty = options.length === 0;
  const helpId = `${id}-help`;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
        {label} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
      </label>
      <select
        id={id}
        ref={selectRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={empty}
        aria-required="true"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : empty ? helpId : undefined}
        style={inputStyle}
      >
        <option value="">{empty ? "None available" : `Select ${label.toLowerCase()}…`}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      {error && <p id={errorId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{error}</p>}
      {empty && (
        <p id={helpId} style={{ fontSize: 12, margin: 0, color: loadFailed ? "var(--bad, #c0392b)" : "var(--ink2)" }}>
          {loadFailed ? `Couldn't load the ${label.toLowerCase()} list. Reload the page to try again.` : <>{emptyHint} <a className="lnk" href={emptyHref}>Go there</a></>}
        </p>
      )}
    </div>
  );
}
