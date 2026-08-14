"use client";

import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  inputStyle,
  labelStyle,
  fieldWrap,
  grid2,
} from "../wizardTypes";

type EmpSummary = { id: string; name: string; designationName?: string };

interface Props {
  data: WizardData;
  errors: FieldErrors;
  managers?: EmpSummary[];
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

const SHIFTS: { value: WizardData["shift"]; label: string }[] = [
  { value: "general", label: "General (9 AM – 6 PM)" },
  { value: "morning", label: "Morning (6 AM – 2 PM)" },
  { value: "evening", label: "Evening (2 PM – 10 PM)" },
  { value: "night", label: "Night (10 PM – 6 AM)" },
];

export function Step3({ data, errors: _errors, managers, onChange, onBlur: _onBlur }: Props) {
  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 0, marginBottom: 20 }}>
        Step 3 — Assignment
      </h2>
      <div style={grid2}>
        {/* Reporting Manager */}
        <div style={fieldWrap}>
          <label htmlFor="w-manager" style={labelStyle}>Reporting Manager</label>
          <select
            id="w-manager"
            value={data.managerId}
            onChange={(e) => onChange("managerId", e.target.value)}
            style={inputStyle}
          >
            <option value="">Select manager</option>
            {(managers ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.designationName ? ` — ${m.designationName}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Work Location */}
        <div style={fieldWrap}>
          <label htmlFor="w-location" style={labelStyle}>Work Location</label>
          <input
            id="w-location"
            type="text"
            value={data.workLocation}
            onChange={(e) => onChange("workLocation", e.target.value)}
            placeholder="e.g. CGO Complex, New Delhi"
            style={inputStyle}
          />
        </div>

        {/* Shift */}
        <div style={fieldWrap}>
          <label htmlFor="w-shift" style={labelStyle}>Shift</label>
          <select
            id="w-shift"
            value={data.shift}
            onChange={(e) => onChange("shift", e.target.value as WizardData["shift"])}
            style={inputStyle}
          >
            <option value="">Select shift</option>
            {SHIFTS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Cost Center */}
        <div style={fieldWrap}>
          <label htmlFor="w-costCenter" style={labelStyle}>Cost Center</label>
          <input
            id="w-costCenter"
            type="text"
            value={data.costCenter}
            onChange={(e) => onChange("costCenter", e.target.value)}
            placeholder="e.g. CC-IT-INFRA-001"
            style={inputStyle}
          />
        </div>
      </div>

      <p style={{ marginTop: 20, marginBottom: 0, fontSize: 12, color: "#64748b" }}>
        All Assignment fields are optional and can be updated later from the employee profile.
      </p>
    </>
  );
}
