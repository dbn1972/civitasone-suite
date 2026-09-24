import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LineItemsEditor, emptyLineItem, type LineItem } from "./LineItemsEditor";

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
    { itemCode: "A1", description: "First", quantity: 1, unitPrice: 10 },
    { itemCode: "B2", description: "Second", quantity: 1, unitPrice: 20 },
    { itemCode: "C3", description: "Third", quantity: 1, unitPrice: 30 },
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
