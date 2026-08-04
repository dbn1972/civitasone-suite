"use client";
/**
 * ClassificationFields — LQ-003. Presentational, controlled fieldset for a
 * lead/contact's classification: temperature, priority, market segment,
 * product, region and expected value. The parent owns state and persistence
 * (PATCH /v1/crm/contacts/:id/classification); expected value is entered in
 * rupees and converted to paise via lib/money.ts before saving.
 */
import { useId } from "react";
import { TEMPERATURES, PRIORITIES, type Temperature, type Priority } from "@/lib/crm/leadQualification";

export interface ClassificationFormValue {
  temperature: "" | Temperature;
  priority: "" | Priority;
  segment: string;
  product: string;
  region: string;
  /** Rupees, as typed by the clerk (converted to paise on save). */
  expectedValueRupees: string;
}

export const EMPTY_CLASSIFICATION: ClassificationFormValue = {
  temperature: "",
  priority: "",
  segment: "",
  product: "",
  region: "",
  expectedValueRupees: "",
};

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errStyle = { fontSize: 12, color: "#b42318", marginTop: 4 } as const;

interface Props {
  value: ClassificationFormValue;
  onChange: (patch: Partial<ClassificationFormValue>) => void;
  /** Inline error for the expected-value money field (invalid rupees). */
  expectedValueError?: string;
}

export function ClassificationFields({ value, onChange, expectedValueError }: Props) {
  const base = useId();
  const evErrId = `${base}-ev-err`;
  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, margin: 0 }}>
      <legend style={{ fontSize: 13, fontWeight: 700, padding: "0 6px" }}>Classification &amp; segmentation</legend>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div>
          <label htmlFor={`${base}-temperature`} style={labelStyle}>Temperature</label>
          <select
            id={`${base}-temperature`}
            value={value.temperature}
            onChange={(e) => onChange({ temperature: e.target.value as ClassificationFormValue["temperature"] })}
            style={inputStyle}
          >
            <option value="">—</option>
            {TEMPERATURES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${base}-priority`} style={labelStyle}>Priority</label>
          <select
            id={`${base}-priority`}
            value={value.priority}
            onChange={(e) => onChange({ priority: e.target.value as ClassificationFormValue["priority"] })}
            style={inputStyle}
          >
            <option value="">—</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${base}-segment`} style={labelStyle}>Segment</label>
          <input id={`${base}-segment`} value={value.segment} onChange={(e) => onChange({ segment: e.target.value })} placeholder="e.g. Enterprise, SMB" style={inputStyle} />
        </div>
        <div>
          <label htmlFor={`${base}-product`} style={labelStyle}>Product</label>
          <input id={`${base}-product`} value={value.product} onChange={(e) => onChange({ product: e.target.value })} placeholder="Product line" style={inputStyle} />
        </div>
        <div>
          <label htmlFor={`${base}-region`} style={labelStyle}>Region</label>
          <input id={`${base}-region`} value={value.region} onChange={(e) => onChange({ region: e.target.value })} placeholder="e.g. South, West" style={inputStyle} />
        </div>
        <div>
          <label htmlFor={`${base}-ev`} style={labelStyle}>Expected value (₹)</label>
          <input
            id={`${base}-ev`}
            value={value.expectedValueRupees}
            onChange={(e) => onChange({ expectedValueRupees: e.target.value })}
            placeholder="150000"
            inputMode="decimal"
            style={inputStyle}
            aria-invalid={expectedValueError ? true : undefined}
            aria-describedby={expectedValueError ? evErrId : undefined}
          />
          {expectedValueError ? <p id={evErrId} role="alert" style={errStyle}>{expectedValueError}</p> : null}
        </div>
      </div>
    </fieldset>
  );
}
