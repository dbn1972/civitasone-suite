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

  it("windows long lists when over the virtualize threshold", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: `f${i}` }));
    render(
      <SortableList
        items={items}
        onSelect={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        virtualizeThreshold={50}
        rowHeightPx={40}
        maxViewportPx={120}
        renderItem={(item) => <span>Field {item.id}</span>}
      />,
    );
    expect(screen.getByText("Field f0")).toBeInTheDocument();
    expect(screen.queryByText("Field f59")).not.toBeInTheDocument();
  });

  // GAP-DESIGNER-DETAIL-B2-02: move buttons name their row for screen readers.
  it("names Move up/down with the row's accessible name when itemAccessibleName is given", () => {
    render(
      <SortableList
        items={[{ id: "a" }, { id: "b" }]}
        onSelect={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        itemAccessibleName={(item) => `Field ${item.id}`}
        renderItem={(item) => <span>Field {item.id}</span>}
      />,
    );
    expect(screen.getByRole("button", { name: "Move Field a down" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Field b up" })).toBeInTheDocument();
  });

  it("keeps generic Move up/down labels when itemAccessibleName is omitted", () => {
    render(
      <SortableList
        items={[{ id: "a" }, { id: "b" }]}
        onSelect={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        renderItem={(item) => <span>Field {item.id}</span>}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Move up" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Move down" }).length).toBeGreaterThan(0);
  });
});
