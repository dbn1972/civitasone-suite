"use client";

import { useRef, useState } from "react";
import { formatMoney } from "@/lib/formatters";
import { Button } from "@/app/_components/ds";

export type LineItem = {
  itemCode: string;
  description: string;
  quantity: number;
  unitPrice: number; // rupees (UI), converted to paise on submit
};

export function emptyLineItem(): LineItem {
  return { itemCode: "", description: "", quantity: 1, unitPrice: 0 };
}

export function lineItemsTotalMinor(items: LineItem[]): number {
  return items.reduce(
    (sum, it) => sum + Math.max(0, Math.round(it.unitPrice * 100)) * Math.max(0, it.quantity),
    0,
  );
}

export function LineItemsEditor({
  items,
  onChange,
  unitLabel = "nos",
}: {
  items: LineItem[];
  onChange: (next: LineItem[]) => void;
  unitLabel?: string;
}) {
  // Stable per-row React key, independent of array position. `LineItem`
  // itself carries no id and stays that way (it's the exact shape this
  // component hands back via onChange, and callers submit it to the
  // backend as-is) -- a parallel id list, generated once per row and kept
  // in lockstep with `items` through this component's own add()/remove()
  // (the only two places its length changes today), gives each row a real
  // identity to key on instead. Without it (the previous key={idx}),
  // removing row 2 of 4 shifted rows 3-4 up to keys 2-3: React read that as
  // "row 2's DOM node, patched with row 3's data" rather than "row 2's node
  // removed, rows 3-4 untouched" -- a keyboard user focused in row 4 could
  // end up with focus silently landed on what's now row 3's input instead
  // of following row 4's own data, or simply losing focus with no visual
  // cue why.
  const nextRowId = useRef(0);
  const [rowIds, setRowIds] = useState<number[]>(() => items.map(() => nextRowId.current++));
  // Fallback to the array index for any row this component didn't itself
  // add (e.g. a future caller that resets `items` wholesale) -- keeps
  // rendering correct rather than crashing; only add()/remove() below are
  // relied on to keep rowIds in step with `items` for the callers today.
  const keyFor = (idx: number) => rowIds[idx] ?? idx;

  function update(idx: number, patch: Partial<LineItem>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function add() {
    onChange([...items, emptyLineItem()]);
    setRowIds((ids) => [...ids, nextRowId.current++]);
  }
  function remove(idx: number) {
    if (items.length <= 1) return;
    onChange(items.filter((_, i) => i !== idx));
    setRowIds((ids) => ids.filter((_, i) => i !== idx));
  }

  const totalMinor = lineItemsTotalMinor(items);

  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "8px 0 0" }}>
      <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>Line items</legend>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl-editor" style={{ minWidth: 640, width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th scope="col">Item code</th>
              <th scope="col">Description</th>
              <th scope="col" className="num">Qty</th>
              <th scope="col" className="num">Unit price (₹)</th>
              <th scope="col" className="num">Line total</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const lineMinor = Math.max(0, Math.round(it.unitPrice * 100)) * Math.max(0, it.quantity);
              return (
                <tr key={keyFor(idx)}>
                  <td>
                    <label className="sr-only" htmlFor={`li-code-${idx}`}>Item code, row {idx + 1}</label>
                    <input id={`li-code-${idx}`} value={it.itemCode} onChange={(e) => update(idx, { itemCode: e.target.value })}
                      required style={{ minHeight: 40, width: "100%" }} />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`li-desc-${idx}`}>Description, row {idx + 1}</label>
                    <input id={`li-desc-${idx}`} value={it.description} onChange={(e) => update(idx, { description: e.target.value })}
                      required style={{ minHeight: 40, width: "100%" }} />
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`li-qty-${idx}`}>Quantity, row {idx + 1}</label>
                    <input id={`li-qty-${idx}`} type="number" min={1} value={it.quantity}
                      onChange={(e) => update(idx, { quantity: Number(e.target.value) })}
                      style={{ minHeight: 40, width: 80, textAlign: "right" }} />
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`li-price-${idx}`}>Unit price, row {idx + 1}</label>
                    <input id={`li-price-${idx}`} type="number" min={0} step="0.01" value={it.unitPrice}
                      onChange={(e) => update(idx, { unitPrice: Number(e.target.value) })}
                      style={{ minHeight: 40, width: 120, textAlign: "right" }} />
                  </td>
                  <td className="num">{formatMoney(lineMinor)}</td>
                  <td>
                    <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}
                      disabled={items.length <= 1} aria-label={`Remove line item ${idx + 1}`} style={{ minHeight: 40 }}>
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="num" style={{ fontWeight: 700 }}>Total</td>
              <td className="num" style={{ fontWeight: 700 }} aria-live="polite">{formatMoney(totalMinor)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={add} style={{ marginTop: 10, minHeight: 40 }}>
        + Add line item
      </Button>
      <span className="sr-only" aria-hidden="true">Unit: {unitLabel}</span>
    </fieldset>
  );
}
