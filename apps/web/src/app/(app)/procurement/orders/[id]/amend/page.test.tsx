import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import POAmendPage from "./page";

const PO_ID = "55555555-5555-5555-5555-555555555555";

describe("POAmendPage — amendment type label formatting (regression)", () => {
  // Bug: the label formatter was `t.replace(/_/g, " ").replace(<literal
  // backspace byte>\w/g, ...)` — a corrupted `\b` (word-boundary) that had
  // become a raw 0x08 byte, which ESLint's no-control-regex rule flags. A
  // regex matching a literal backspace character never matches real option
  // text, so the .replace() was a silent no-op: multi-word options like
  // "change_order" rendered as "Change order" only up to the underscore
  // replacement, never capitalizing the second word ("order", not "Order").
  it("renders each word of a multi-word amendment type capitalized", () => {
    render(<POAmendPage params={{ id: PO_ID }} />);
    const select = screen.getByLabelText("Amendment type *") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Change Order");
    expect(labels).not.toContain("Change order");
  });
});
