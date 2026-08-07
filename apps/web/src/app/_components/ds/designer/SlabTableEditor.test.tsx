import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlabTableEditor, validateSlabTable } from "./SlabTableEditor";
import type { SlabRowUi } from "./feeTypes";

describe("SlabTableEditor", () => {
  it("adds a slab row", () => {
    const onChange = vi.fn();
    render(<SlabTableEditor slabs={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Add slab row"));
    expect(onChange).toHaveBeenCalled();
  });

  it("flags band overlap issues", () => {
    const slabs: SlabRowUi[] = [
      { id: "a", from: "0", to: "100", rate: "100", type: "band" },
      { id: "b", from: "50", to: "200", rate: "200", type: "band" },
    ];
    const validated = validateSlabTable(slabs);
    expect(validated[1]?.issue).toMatch(/overlap|Gap/i);
  });
});
