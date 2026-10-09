"use client";

import { useRef, useState } from "react";
import { formatMoney } from "@/lib/formatters";
import { nonNegativeRupeesToMinorString } from "@/lib/money";
import { Button } from "@/app/_components/ds";

export type LineItem = {
  itemCode: string;
  description: string;
  quantity: number;
  // GAP2-PROCUREMENT-MONEY-WEB-04: rupees as the RAW string the clerk typed
  // (was a float). Converted to paise via nonNegativeRupeesToMinorString
  // (BigInt, string-based) on submit — never `Math.round(float * 100)`, which
  // silently rounds a pasted 3-decimal value and mis-handles half-paise. An
  // empty string means "no price yet".
  unitPrice: string;
  // GAP-PROCUREMENT-INDENTS-NEW-04: unit of measure per line (was hard-coded
  // "nos" for every line at submit). A short UoM code from UNIT_OPTIONS below.
  unit: string;
};

// GAP-PROCUREMENT-INDENTS-NEW-04: a small, explicit UoM list so a clerk picks
// the real unit instead of every line silently going out as "nos".
export const UNIT_OPTIONS = ["nos", "kg", "litre", "metre", "set", "pair", "box", "pkt", "ream", "unit"] as const;

export function emptyLineItem(): LineItem {
  return { itemCode: "", description: "", quantity: 1, unitPrice: "", unit: "nos" };
}

/**
 * GAP2-PROCUREMENT-MONEY-WEB-04: the exact paise for one line's unit price as a
 * BigInt, or null when the typed rupees value is invalid (non-numeric, negative
 * or MORE THAN 2 decimal places — a value the clerk must correct, not one we
 * silently round). An empty price is treated as 0 paise (an unpriced line is a
 * legitimate draft state the forms warn about separately). Float-free.
 */
export function lineUnitPriceMinor(unitPrice: string): bigint | null {
  const trimmed = unitPrice.trim();
  if (trimmed === "") return 0n;
  const minor = nonNegativeRupeesToMinorString(trimmed);
  return minor === null ? null : BigInt(minor);
}

/** True when a line's typed price is syntactically invalid (would be rejected). */
export function isLineUnitPriceInvalid(unitPrice: string): boolean {
  return lineUnitPriceMinor(unitPrice) === null;
}

/**
 * GAP2-PROCUREMENT-MONEY-WEB-04: a line's total paise (unit price × quantity)
 * as a BigInt, or null if the unit price is invalid. Pure BigInt — no float.
 */
export function lineTotalMinor(it: LineItem): bigint | null {
  const unit = lineUnitPriceMinor(it.unitPrice);
  if (unit === null) return null;
  return unit * BigInt(Math.max(0, Math.trunc(it.quantity)));
}

/**
 * Sum of all line totals in paise as a BigInt, or null if ANY line's price is
 * invalid (so callers can block submit and flag the offending field). Float-free.
 */
export function lineItemsTotalMinorStrict(items: LineItem[]): bigint | null {
  let total = 0n;
  for (const it of items) {
    const line = lineTotalMinor(it);
    if (line === null) return null;
    total += line;
  }
  return total;
}

/**
 * Lenient total (paise) for live preview: invalid lines contribute 0 rather
 * than collapsing the whole preview to an error. Returned as a Number for the
 * existing callers that keep estimatedValueMinor as a number; it is a sum of
 * exact per-line BigInt paise, so no float `* 100` ever happens.
 */
export function lineItemsTotalMinor(items: LineItem[]): number {
  let total = 0n;
  for (const it of items) {
    const line = lineTotalMinor(it);
    if (line !== null) total += line;
  }
  return Number(total);
}

export function LineItemsEditor({
  items,
  onChange,
}: {
  items: LineItem[];
  onChange: (next: LineItem[]) => void;
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
              <th scope="col">Unit</th>
              <th scope="col" className="num">Unit price (₹)</th>
              <th scope="col" className="num">Line total</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const lineMinorBig = lineTotalMinor(it);
              const priceInvalid = isLineUnitPriceInvalid(it.unitPrice);
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
                  <td>
                    <label className="sr-only" htmlFor={`li-unit-${idx}`}>Unit, row {idx + 1}</label>
                    <select id={`li-unit-${idx}`} value={it.unit}
                      onChange={(e) => update(idx, { unit: e.target.value })}
                      style={{ minHeight: 40, width: "100%" }}>
                      {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`li-price-${idx}`}>Unit price, row {idx + 1}</label>
                    {/* GAP2-PROCUREMENT-MONEY-WEB-04: a plain text input holding
                        the raw rupees string (inputMode numeric for mobile),
                        NOT a float `type=number`. Conversion to paise happens
                        via nonNegativeRupeesToMinorString; a >2-decimal or
                        non-numeric value is flagged here and blocks submit,
                        never silently rounded. */}
                    <input id={`li-price-${idx}`} type="text" inputMode="decimal" value={it.unitPrice}
                      onChange={(e) => update(idx, { unitPrice: e.target.value })}
                      aria-invalid={priceInvalid ? true : undefined}
                      aria-describedby={priceInvalid ? `li-price-err-${idx}` : undefined}
                      placeholder="0.00"
                      style={{ minHeight: 40, width: 120, textAlign: "right", ...(priceInvalid ? { borderColor: "var(--bad)" } : {}) }} />
                    {priceInvalid ? (
                      <span id={`li-price-err-${idx}`} role="alert" style={{ display: "block", fontSize: 11, color: "var(--bad)" }}>
                        Enter rupees with at most 2 decimal places.
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{lineMinorBig === null ? "—" : formatMoney(Number(lineMinorBig))}</td>
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
              <td colSpan={5} className="num" style={{ fontWeight: 700 }}>Total</td>
              <td className="num" style={{ fontWeight: 700 }} aria-live="polite">{formatMoney(totalMinor)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={add} style={{ marginTop: 10, minHeight: 40 }}>
        + Add line item
      </Button>
    </fieldset>
  );
}
