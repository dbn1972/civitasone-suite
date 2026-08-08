"use client";

import type { FormFieldDefinition } from "./formTypes";
import {
  ELIGIBILITY_EFFECTS_UI,
  ELIGIBILITY_OPERATORS,
  PROFILE_ATTRIBUTES,
  type EligibilityAttributeOption,
  type EligibilityEffectUi,
  type EligibilityOp,
  type EligibilityRuleUi,
} from "./eligibilityTypes";

export interface EligibilityConditionBuilderProps {
  rules: EligibilityRuleUi[];
  formFields: FormFieldDefinition[];
  onChange: (rules: EligibilityRuleUi[]) => void;
  /** Per-rule pass/fail from the sample-applicant panel (UX §5.6). */
  ruleHighlights?: Record<string, "pass" | "fail">;
}

function formFieldOptions(fields: FormFieldDefinition[]): EligibilityAttributeOption[] {
  return fields.map((f) => ({
    id: f.apiName,
    label: f.label || f.apiName,
    group: "form" as const,
    valueType: f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "text",
  }));
}

export function EligibilityConditionBuilder({
  rules,
  formFields,
  onChange,
  ruleHighlights,
}: EligibilityConditionBuilderProps) {
  const attributes = [...PROFILE_ATTRIBUTES, ...formFieldOptions(formFields)];

  const addRow = () => {
    const first = attributes[0];
    if (!first) return;
    onChange([
      ...rules,
      {
        id: crypto.randomUUID(),
        attribute: first.id,
        op: "eq",
        value: "",
        effect: "block",
        message: "",
      },
    ]);
  };

  const updateRow = (idx: number, patch: Partial<EligibilityRuleUi>) => {
    onChange(rules.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeRow = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
  };

  const groupedOptions = (group: "profile" | "form") =>
    attributes.filter((a) => a.group === group);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rules.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
          No conditions — everyone may apply. That&apos;s fine for most services.
        </p>
      ) : (
        rules.map((row, idx) => {
          const op = ELIGIBILITY_OPERATORS.find((o) => o.id === row.op) ?? ELIGIBILITY_OPERATORS[0]!;
          const highlight = ruleHighlights?.[row.id];
          return (
            <div
              key={row.id}
              data-testid={`eligibility-rule-${row.id}`}
              data-highlight={highlight ?? "none"}
              style={{
                display: "grid",
                gap: 8,
                padding: 12,
                border:
                  highlight === "fail"
                    ? "2px solid var(--bad-fg)"
                    : highlight === "pass"
                      ? "1px solid var(--good-fg)"
                      : "1px solid var(--line)",
                background:
                  highlight === "fail"
                    ? "var(--bad-bg)"
                    : highlight === "pass"
                      ? "var(--good-bg)"
                      : "transparent",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>Applicants must meet</span>
                {highlight ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: highlight === "fail" ? "var(--bad-fg)" : "var(--good-fg)",
                    }}
                  >
                    {highlight === "fail" ? "Fails sample" : "Passes sample"}
                  </span>
                ) : null}
              </div>
              <select
                className="input"
                value={row.attribute}
                onChange={(e) => updateRow(idx, { attribute: e.target.value })}
                aria-label="Attribute"
              >
                <optgroup label="Applicant profile">
                  {groupedOptions("profile").map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </optgroup>
                {groupedOptions("form").length > 0 ? (
                  <optgroup label="Form answers">
                    {groupedOptions("form").map((a) => (
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
                  value={row.value ?? ""}
                  onChange={(e) => updateRow(idx, { value: e.target.value })}
                  placeholder="Expected value"
                  aria-label="Comparison value"
                />
              ) : null}
              <select
                className="input"
                value={row.effect}
                onChange={(e) => updateRow(idx, { effect: e.target.value as EligibilityEffectUi })}
                aria-label="Effect when rule fails"
              >
                {ELIGIBILITY_EFFECTS_UI.map((e) => (
                  <option key={e.id} value={e.id}>{e.label}</option>
                ))}
              </select>
              <input
                className="input"
                value={row.message}
                onChange={(e) => updateRow(idx, { message: e.target.value })}
                placeholder="Message shown to applicant or officer"
                aria-label="Rule message"
              />
              <button type="button" className="btn ghost" onClick={() => removeRow(idx)}>Remove condition</button>
            </div>
          );
        })
      )}
      <button type="button" className="btn ghost" onClick={addRow}>Add condition</button>
    </div>
  );
}
