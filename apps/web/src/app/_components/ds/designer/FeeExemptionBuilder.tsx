"use client";

import type { FormFieldDefinition } from "./formTypes";
import {
  ELIGIBILITY_OPERATORS,
  PROFILE_ATTRIBUTES,
  type EligibilityAttributeOption,
  type EligibilityOp,
} from "./eligibilityTypes";
import type { ExemptionKindUi, FeeExemptionUi } from "./feeTypes";

export interface FeeExemptionBuilderProps {
  exemptions: FeeExemptionUi[];
  formFields: FormFieldDefinition[];
  onChange: (exemptions: FeeExemptionUi[]) => void;
}

const EXEMPTION_KINDS: { id: ExemptionKindUi; label: string }[] = [
  { id: "percent", label: "Percent off" },
  { id: "flat", label: "Fixed reduction (₹)" },
  { id: "waive", label: "Waive entirely" },
];

function formFieldOptions(fields: FormFieldDefinition[]): EligibilityAttributeOption[] {
  return fields.map((f) => ({
    id: f.apiName,
    label: f.label || f.apiName,
    group: "form" as const,
    valueType: f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "text",
  }));
}

export function FeeExemptionBuilder({ exemptions, formFields, onChange }: FeeExemptionBuilderProps) {
  const attributes = [...PROFILE_ATTRIBUTES, ...formFieldOptions(formFields)];

  const addRow = () => {
    const first = attributes[0];
    if (!first) return;
    onChange([
      ...exemptions,
      {
        id: crypto.randomUUID(),
        attribute: first.id,
        op: "eq",
        value: "",
        kind: "percent",
        amount: "50",
        label: "",
      },
    ]);
  };

  const updateRow = (idx: number, patch: Partial<FeeExemptionUi>) => {
    onChange(exemptions.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeRow = (idx: number) => {
    onChange(exemptions.filter((_, i) => i !== idx));
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {exemptions.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
          No exemptions — everyone pays the full amount.
        </p>
      ) : (
        exemptions.map((row, idx) => {
          const op = ELIGIBILITY_OPERATORS.find((o) => o.id === row.op) ?? ELIGIBILITY_OPERATORS[0]!;
          return (
            <div
              key={row.id}
              style={{
                display: "grid",
                gap: 8,
                padding: 12,
                border: "1px solid var(--line)",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600 }}>Exemption IF</span>
              <select
                className="input"
                value={row.attribute}
                onChange={(e) => updateRow(idx, { attribute: e.target.value })}
                aria-label="Attribute"
              >
                <optgroup label="Applicant profile">
                  {attributes.filter((a) => a.group === "profile").map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </optgroup>
                {formFields.length > 0 ? (
                  <optgroup label="Form answers">
                    {attributes.filter((a) => a.group === "form").map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <select
                className="input"
                value={row.op}
                onChange={(e) => updateRow(idx, { op: e.target.value as EligibilityOp })}
                aria-label="Operator"
              >
                {ELIGIBILITY_OPERATORS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              {op.needsValue ? (
                <input
                  className="input"
                  value={row.value}
                  onChange={(e) => updateRow(idx, { value: e.target.value })}
                  placeholder="Value"
                  aria-label="Condition value"
                />
              ) : null}
              <select
                className="input"
                value={row.kind}
                onChange={(e) => updateRow(idx, { kind: e.target.value as ExemptionKindUi })}
                aria-label="Reduction type"
              >
                {EXEMPTION_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>{k.label}</option>
                ))}
              </select>
              {row.kind !== "waive" ? (
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={row.amount}
                  onChange={(e) => updateRow(idx, { amount: e.target.value })}
                  placeholder={row.kind === "percent" ? "Percent (0–100)" : "Amount in paise"}
                  aria-label="Reduction amount"
                />
              ) : null}
              <input
                className="input"
                value={row.label}
                onChange={(e) => updateRow(idx, { label: e.target.value })}
                placeholder="Label shown on receipt (optional)"
                aria-label="Exemption label"
              />
              <button type="button" className="btn ghost sm" onClick={() => removeRow(idx)}>Remove</button>
            </div>
          );
        })
      )}
      <button type="button" className="btn ghost" onClick={addRow} disabled={attributes.length === 0}>
        Add exemption
      </button>
    </div>
  );
}
