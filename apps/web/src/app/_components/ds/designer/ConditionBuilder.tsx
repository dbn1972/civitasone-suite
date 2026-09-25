"use client";

import { useRef, useState } from "react";
import type { ConditionOperator, FormFieldDefinition, VisibilityCondition } from "./formTypes";
import { Button } from "../Button";

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

  // Stable per-row React key, independent of array position -- see
  // ElectFlexBenefitForm.tsx (apps/web/src/app/(app)/hr/payroll/flex-benefits)
  // for the full rationale. VisibilityCondition carries no id, so a parallel
  // id list stands in for one. This builder is reused live for whichever
  // form field is currently selected in the property panel (FormBuilder.tsx
  // never unmounts it between selections), so `conditions` can be swapped
  // out wholesale for a *different* field's rule list while this component
  // stays mounted -- the id list must be reseeded when that happens, not
  // just on add/remove. Detected via currentFieldId (each field's own id)
  // changing, using React's documented "adjust state when a prop changes"
  // pattern (a setState call during render, guarded so it only fires once
  // per actual change) rather than an effect, which would paint one stale
  // frame with the previous field's ids first.
  const nextRowId = useRef(0);
  const [rowIds, setRowIds] = useState<number[]>(() => conditions.map(() => nextRowId.current++));
  const [rowIdsForField, setRowIdsForField] = useState(currentFieldId);
  if (rowIdsForField !== currentFieldId) {
    setRowIdsForField(currentFieldId);
    setRowIds(conditions.map(() => nextRowId.current++));
  }
  const keyFor = (idx: number) => rowIds[idx] ?? idx;

  const addRow = () => {
    const first = sources[0];
    if (!first) return;
    onChange([...conditions, { sourceFieldId: first.id, operator: "eq", value: "" }]);
    setRowIds((ids) => [...ids, nextRowId.current++]);
  };

  const updateRow = (idx: number, patch: Partial<VisibilityCondition>) => {
    onChange(conditions.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeRow = (idx: number) => {
    onChange(conditions.filter((_, i) => i !== idx));
    setRowIds((ids) => ids.filter((_, i) => i !== idx));
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
              key={keyFor(idx)}
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
              <Button type="button" variant="ghost" onClick={() => removeRow(idx)}>Remove rule</Button>
            </div>
          );
        })
      )}
      <Button type="button" variant="ghost" onClick={addRow}>Add visibility rule</Button>
    </div>
  );
}
