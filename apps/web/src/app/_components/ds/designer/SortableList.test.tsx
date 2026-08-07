import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SortableList } from "./SortableList";

describe("SortableList", () => {
  it("renders items and supports selection", () => {
    const onSelect = vi.fn();
    render(
      <SortableList
        items={[{ id: "a" }, { id: "b" }]}
        onSelect={onSelect}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        renderItem={(item) => <span>Field {item.id}</span>}
      />,
    );
    fireEvent.click(screen.getByText("Field b"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
