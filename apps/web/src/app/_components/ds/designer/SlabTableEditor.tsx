"use client";

import { formatMoney } from "@/lib/formatters";
import type { SlabRowUi, SlabTypeUi } from "./feeTypes";

export interface SlabTableEditorProps {
  slabs: SlabRowUi[];
  onChange: (slabs: SlabRowUi[]) => void;
  sampleValue?: string;
  onSampleValueChange?: (value: string) => void;
  previewAmountPaise?: number;
}

const SLAB_TYPES: { id: SlabTypeUi; label: string }[] = [
  { id: "flat", label: "Flat" },
  { id: "band", label: "Band" },
  { id: "ad_valorem", label: "Ad-valorem" },
];

function validateSlabRow(row: SlabRowUi, prev?: SlabRowUi): string | undefined {
  if (row.type === "flat") return undefined;
  const from = row.from === "" ? NaN : Number(row.from);
  const to = row.to === "" ? NaN : Number(row.to);
  if (!Number.isFinite(from) || from < 0) return "From must be a non-negative number";
  if (row.to !== "" && (!Number.isFinite(to) || to <= from)) return "To must be greater than from";
  if (prev && prev.type === "band" && prev.to !== "") {
    const prevTo = Number(prev.to);
    if (Number.isFinite(prevTo) && from < prevTo) return "Gap or overlap with previous band";
    if (Number.isFinite(prevTo) && from > prevTo) return "Gap between bands";
  }
  const rate = Number(row.rate);
  if (!Number.isFinite(rate) || rate < 0) return "Rate must be a non-negative number";
  return undefined;
}

export function validateSlabTable(slabs: SlabRowUi[]): SlabRowUi[] {
  const bandSlabs = slabs.filter((s) => s.type === "band");
  return slabs.map((row, idx) => {
    const prevBand = bandSlabs.filter((s) => slabs.indexOf(s) < idx).pop();
    const issue = validateSlabRow(row, prevBand);
    return issue ? { ...row, issue } : { ...row, issue: undefined };
  });
}

export function SlabTableEditor({
  slabs,
  onChange,
  sampleValue = "",
  onSampleValueChange,
  previewAmountPaise,
}: SlabTableEditorProps) {
  const rows = validateSlabTable(slabs);

  const addRow = () => {
    onChange([
      ...rows,
      {
        id: crypto.randomUUID(),
        from: "",
        to: "",
        rate: "",
        type: "band",
      },
    ]);
  };

  const updateRow = (idx: number, patch: Partial<SlabRowUi>) => {
    onChange(rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeRow = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx));
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Rate</th>
              <th scope="col">Type</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "var(--mut)", padding: 12 }}>
                  No slabs yet. Add a row to define how the fee varies.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id} style={row.issue ? { background: "var(--warn-bg, #fff8e6)" } : undefined}>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={row.type === "flat" ? "—" : row.from}
                      disabled={row.type === "flat"}
                      onChange={(e) => updateRow(idx, { from: e.target.value })}
                      aria-label={`Slab ${idx + 1} from`}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={row.type === "flat" ? "—" : row.to}
                      disabled={row.type === "flat"}
                      placeholder="open"
                      onChange={(e) => updateRow(idx, { to: e.target.value })}
                      aria-label={`Slab ${idx + 1} to`}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={row.rate}
                      onChange={(e) => updateRow(idx, { rate: e.target.value })}
                      aria-label={`Slab ${idx + 1} rate`}
                    />
                  </td>
                  <td>
                    <select
                      className="input"
                      value={row.type}
                      onChange={(e) => updateRow(idx, { type: e.target.value as SlabTypeUi })}
                      aria-label={`Slab ${idx + 1} type`}
                    >
                      {SLAB_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button type="button" className="btn ghost sm" onClick={() => removeRow(idx)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.some((r) => r.issue) ? (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--warn-fg)" }}>
          {rows.filter((r) => r.issue).map((r) => (
            <li key={r.id}>{r.issue}</li>
          ))}
        </ul>
      ) : null}

      <button type="button" className="btn ghost" onClick={addRow}>Add slab row</button>

      {onSampleValueChange ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            paddingTop: 8,
            borderTop: "1px solid var(--line)",
            fontSize: 13,
          }}
        >
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Preview amount for sample:</span>
            <input
              className="input"
              type="number"
              min={0}
              value={sampleValue}
              onChange={(e) => onSampleValueChange(e.target.value)}
              style={{ width: 120 }}
            />
          </label>
          {previewAmountPaise !== undefined ? (
            <strong>{formatMoney(previewAmountPaise)}</strong>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
