import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LineItemsEditor, emptyLineItem } from "./LineItemsEditor";

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
