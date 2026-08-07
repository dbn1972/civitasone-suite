"use client";

import type { ConditionOperator, FormFieldDefinition, VisibilityCondition } from "./formTypes";

export interface ConditionBuilderProps {
  conditions: VisibilityCondition[];
  availableFields: FormFieldDefinition[];
  currentFieldId: string;
  onChange: (conditions: VisibilityCondition[]) => void;
}

const OPERATORS: { id: ConditionOperator; label: string; needsValue: boolean }[] = [
  { id: "eq", label: "equals", needsValue: true },
  { id: "neq", label: "does not equal", needsValue: true },
  { id: "empty", label: "is empty", needsValue: false },
  { id: "not_empty", label: "is not empty", needsValue: false },
];

export function ConditionBuilder({
  conditions,
  availableFields,
  currentFieldId,
  onChange,
}: ConditionBuilderProps) {
  const sources = availableFields.filter((f) => f.id !== currentFieldId);

  const addRow = () => {
    const first = sources[0];
    if (!first) return;
    onChange([...conditions, { sourceFieldId: first.id, operator: "eq", value: "" }]);
  };

  const updateRow = (idx: number, patch: Partial<VisibilityCondition>) => {
    onChange(conditions.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeRow = (idx: number) => {
    onChange(conditions.filter((_, i) => i !== idx));
  };

  if (sources.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
        Add another field first to build a visibility rule.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {conditions.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
          Always visible. Add a rule to show this field only when a condition is met.
        </p>
      ) : (
        conditions.map((row, idx) => {
          const op = OPERATORS.find((o) => o.id === row.operator) ?? OPERATORS[0]!;
          return (
            <div
              key={idx}
              style={{
                display: "grid",
                gap: 8,
                padding: 10,
                border: "1px solid var(--line)",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600 }}>Show this field IF</span>
              <select
                className="input"
                value={row.sourceFieldId}
                onChange={(e) => updateRow(idx, { sourceFieldId: e.target.value })}
                aria-label="Source field"
              >
                {sources.map((f) => (
                  <option key={f.id} value={f.id}>{f.label || f.apiName}</option>
                ))}
              </select>
              <select
                className="input"
                value={row.operator}
                onChange={(e) => updateRow(idx, { operator: e.target.value as ConditionOperator })}
                aria-label="Operator"
              >
                {OPERATORS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              {op.needsValue ? (
                <input
                  className="input"
                  value={row.value ?? ""}
                  onChange={(e) => updateRow(idx, { value: e.target.value })}
                  placeholder="Value"
                  aria-label="Comparison value"
                />
              ) : null}
              <button type="button" className="btn ghost" onClick={() => removeRow(idx)}>Remove rule</button>
            </div>
          );
        })
      )}
      <button type="button" className="btn ghost" onClick={addRow}>Add visibility rule</button>
    </div>
  );
}
