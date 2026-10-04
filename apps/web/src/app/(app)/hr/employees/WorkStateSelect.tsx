"use client";

import { INDIAN_STATES_UTS } from "@/lib/india/states";

/**
 * Optional "State of employment (for professional tax)" select over the ISO state / UT list.
 * Shared by the Add Employee wizard and the edit form; "" = not recorded.
 */
export function WorkStateSelect({ id, value, onChange, label, placeholder, style, labelStyle, hint }: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  label: string;
  placeholder: string;
  style?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  hint?: string;
}) {
  return (
    <>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={style} aria-describedby={hint ? `${id}-hint` : undefined}>
        <option value="">{placeholder}</option>
        {INDIAN_STATES_UTS.map((s) => <option key={s.code} value={s.code}>{`${s.name} (${s.code})`}</option>)}
      </select>
      {hint && <span id={`${id}-hint`} style={{ fontSize: 12, color: "var(--mut, #64748b)" }}>{hint}</span>}
    </>
  );
}
