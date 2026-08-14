"use client";

import { useState } from "react";
import type { WizardData, FieldErrors } from "../wizardTypes";
import {
  inputStyle,
  inputErrorStyle,
  labelStyle,
  fieldWrap,
  grid2,
} from "../wizardTypes";

interface Props {
  data: WizardData;
  errors: FieldErrors;
  onChange: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
  onBlur: (field: keyof WizardData) => void;
}

/** A text input that shows masked dots but stores plaintext in state */
function MaskedInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  hasError,
  errorId,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  maxLength?: number;
  hasError?: boolean;
  errorId?: string;
}) {
  const [reveal, setReveal] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type={reveal ? "text" : "password"}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={hasError}
        aria-describedby={errorId}
        style={{
          ...(hasError ? inputErrorStyle : inputStyle),
          paddingRight: 44,
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={reveal ? "Hide value" : "Show value"}
        onClick={() => setReveal((r) => !r)}
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#64748b",
          fontSize: 14,
          padding: "2px 4px",
          lineHeight: 1,
        }}
      >
        {reveal ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function Toggle({
  id,
  checked,
  label,
  hint,
  onChange,
}: {
  id: string;
  checked: boolean;
  label: string;
  hint?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        fontSize: 14,
        color: "#0f172a",
        padding: "10px 0",
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0, accentColor: "#047857" }}
      />
      <span>
        {label}
        {hint && (
          <span style={{ display: "block", fontSize: 11, color: "#64748b", fontWeight: 400 }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

export function Step4({ data, errors, onChange, onBlur }: Props) {
  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginTop: 0, marginBottom: 20 }}>
        Step 4 — Statutory &amp; Finance
      </h2>

      <div style={grid2}>
        {/* PAN */}
        <div style={fieldWrap}>
          <label htmlFor="w-pan" style={labelStyle}>
            PAN
            <span style={{ fontWeight: 400, color: "#64748b", marginLeft: 6, fontSize: 11 }}>
              (stored encrypted)
            </span>
          </label>
          <MaskedInput
            id="w-pan"
            value={data.pan}
            onChange={(v) => onChange("pan", v.toUpperCase())}
            onBlur={() => onBlur("pan")}
            placeholder="ABCDE1234F"
            maxLength={10}
            hasError={!!errors.pan}
            errorId={errors.pan ? "w-pan-err" : undefined}
          />
          {errors.pan && (
            <span id="w-pan-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.pan}
            </span>
          )}
        </div>

        {/* Aadhaar */}
        <div style={fieldWrap}>
          <label htmlFor="w-aadhaar" style={labelStyle}>
            Aadhaar Reference
            <span style={{ fontWeight: 400, color: "#64748b", marginLeft: 6, fontSize: 11 }}>
              (last 4 digits or masked ref)
            </span>
          </label>
          <MaskedInput
            id="w-aadhaar"
            value={data.aadhaarRef}
            onChange={(v) => onChange("aadhaarRef", v)}
            placeholder="XXXX XXXX 1234"
            hasError={false}
          />
        </div>

        {/* Bank Account */}
        <div style={fieldWrap}>
          <label htmlFor="w-bank" style={labelStyle}>
            Bank Account No
            <span style={{ fontWeight: 400, color: "#64748b", marginLeft: 6, fontSize: 11 }}>
              (stored encrypted)
            </span>
          </label>
          <MaskedInput
            id="w-bank"
            value={data.bankAccountNo}
            onChange={(v) => onChange("bankAccountNo", v)}
            placeholder="Account number"
            hasError={false}
          />
        </div>

        {/* IFSC */}
        <div style={fieldWrap}>
          <label htmlFor="w-ifsc" style={labelStyle}>IFSC Code</label>
          <input
            id="w-ifsc"
            type="text"
            value={data.bankIfsc}
            onChange={(e) => onChange("bankIfsc", e.target.value.toUpperCase())}
            onBlur={() => onBlur("bankIfsc")}
            placeholder="e.g. SBIN0001234"
            maxLength={11}
            aria-invalid={!!errors.bankIfsc}
            aria-describedby={errors.bankIfsc ? "w-ifsc-err" : undefined}
            style={errors.bankIfsc ? inputErrorStyle : inputStyle}
          />
          {errors.bankIfsc && (
            <span id="w-ifsc-err" role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>
              {errors.bankIfsc}
            </span>
          )}
        </div>

        {/* Statutory opt-ins — full width */}
        <div
          style={{
            gridColumn: "span 2",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "0 24px",
            marginTop: 8,
            padding: "12px 16px",
            background: "#f8fafc",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <Toggle
            id="w-pf"
            checked={data.pfEnrolled}
            onChange={(v) => onChange("pfEnrolled", v)}
            label="PF Enrolled"
            hint="Provident Fund contribution"
          />
          <Toggle
            id="w-esi"
            checked={data.esiEnrolled}
            onChange={(v) => onChange("esiEnrolled", v)}
            label="ESI Opt-in"
            hint="Applicable if gross ≤ ₹21,000/m"
          />
          <Toggle
            id="w-pt"
            checked={data.ptApplicable}
            onChange={(v) => onChange("ptApplicable", v)}
            label="PT Applicable"
            hint="Professional Tax (state-specific)"
          />
        </div>
      </div>
    </>
  );
}
