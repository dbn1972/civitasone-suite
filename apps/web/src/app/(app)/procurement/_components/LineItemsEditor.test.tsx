import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  LineItemsEditor,
  emptyLineItem,
  lineUnitPriceMinor,
  isLineUnitPriceInvalid,
  lineTotalMinor,
  lineItemsTotalMinorStrict,
  type LineItem,
} from "./LineItemsEditor";

describe("LineItemsEditor — delete button label (Req 3.6)", () => {
  it("labels each row's remove button with its 1-based row number", () => {
    const items = [emptyLineItem(), emptyLineItem(), emptyLineItem()];
    render(<LineItemsEditor items={items} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove line item 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove line item 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove line item 3" })).toBeInTheDocument();
  });

  it("disables the sole remaining row's remove button (cannot remove the last line)", () => {
    render(<LineItemsEditor items={[emptyLineItem()]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove line item 1" })).toBeDisabled();
  });
});

// A stateful wrapper: LineItemsEditor is fully controlled (items/onChange),
// so proving the fix needs a real add/remove round-trip, not just a mocked
// onChange.
function StatefulEditor() {
  const [items, setItems] = useState<LineItem[]>([
    { itemCode: "A1", description: "First", quantity: 1, unitPrice: "10", unit: "nos" },
    { itemCode: "B2", description: "Second", quantity: 1, unitPrice: "20", unit: "nos" },
    { itemCode: "C3", description: "Third", quantity: 1, unitPrice: "30", unit: "nos" },
  ]);
  return <LineItemsEditor items={items} onChange={setItems} />;
}

// Row identity: rows were keyed by array position, so removing a row above
// a focused one shifted the rows below it up into the removed row's old
// key -- React patched the focused DOM node in place with a different
// row's data instead of removing the right node and leaving the others
// (and the browser's focus) alone. Same root-cause class as DataTable's
// row-position keying.
describe("LineItemsEditor — row identity across removal", () => {
  it("keeps a row's own input value (and focus) attached to that row's data after an earlier row is removed", () => {
    render(<StatefulEditor />);

    // Focus row 3's ("Third") item-code input, matching its current value.
    const row3Code = screen.getByLabelText("Item code, row 3") as HTMLInputElement;
    row3Code.focus();
    expect(row3Code.value).toBe("C3");
    expect(document.activeElement).toBe(row3Code);

    // Remove row 1 ("First") -- rows 2-3 shift up to become rows 1-2.
    fireEvent.click(screen.getByRole("button", { name: "Remove line item 1" }));

    // "Third"'s own input (now rendered as row 2) must still hold "C3" and
    // still be the focused element -- it must have moved with its data,
    // not stayed pinned to its old row-2 position (which is now "Second").
    const survivingThirdRowCode = screen.getByLabelText("Item code, row 2") as HTMLInputElement;
    expect(survivingThirdRowCode.value).toBe("C3");
    expect(document.activeElement).toBe(survivingThirdRowCode);
  });
});

// GAP2-PROCUREMENT-MONEY-WEB-04: rupees->paise conversion is string/BigInt
// based, never `Math.round(float * 100)`. A >2-decimal value is rejected (not
// silently rounded) and exact fractional values convert precisely.
describe("LineItemsEditor — float-free money conversion (GAP2-PROCUREMENT-MONEY-WEB-04)", () => {
  it("converts 0.07 rupees to exactly 7 paise (not 6 via float rounding)", () => {
    expect(lineUnitPriceMinor("0.07")).toBe(7n);
    expect(lineUnitPriceMinor("81234567.89")).toBe(8123456789n);
  });

  it("rejects a >2-decimal value instead of silently rounding it", () => {
    // The exact cases the item names: 1.005 (half-paise) and a pasted 12.345.
    expect(lineUnitPriceMinor("1.005")).toBeNull();
    expect(lineUnitPriceMinor("12.345")).toBeNull();
    expect(isLineUnitPriceInvalid("1.005")).toBe(true);
    expect(isLineUnitPriceInvalid("12.345")).toBe(true);
    // A clean 2-decimal value is valid.
    expect(isLineUnitPriceInvalid("12.34")).toBe(false);
  });

  it("line + grand totals use exact BigInt paise, or null when any price is invalid", () => {
    const good: LineItem = { itemCode: "A", description: "a", quantity: 3, unitPrice: "0.07", unit: "nos" };
    expect(lineTotalMinor(good)).toBe(21n);
    const bad: LineItem = { itemCode: "B", description: "b", quantity: 1, unitPrice: "1.005", unit: "nos" };
    expect(lineTotalMinor(bad)).toBeNull();
    expect(lineItemsTotalMinorStrict([good, bad])).toBeNull();
    expect(lineItemsTotalMinorStrict([good])).toBe(21n);
  });

  it("flags an invalid typed price in the row with an inline error", () => {
    function Harness() {
      const [items, setItems] = useState<LineItem[]>([emptyLineItem()]);
      return <LineItemsEditor items={items} onChange={setItems} />;
    }
    render(<Harness />);
    const price = screen.getByLabelText("Unit price, row 1") as HTMLInputElement;
    // It's a plain text input (not type=number, which cannot hold "1.005"
    // intact to be validated/rejected).
    expect(price.getAttribute("type")).toBe("text");
    fireEvent.change(price, { target: { value: "1.005" } });
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/at most 2 decimal places/i)).toBeInTheDocument();
    // A valid value clears the error.
    fireEvent.change(price, { target: { value: "1.00" } });
    expect(price).not.toHaveAttribute("aria-invalid");
  });
});
