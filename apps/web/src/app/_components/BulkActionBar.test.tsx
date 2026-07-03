import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BulkActionBar } from "./BulkActionBar";

describe("BulkActionBar", () => {
  it("renders nothing when selectedCount is 0", () => {
    const { container } = render(
      <BulkActionBar selectedCount={0} actions={[{ label: "Delete", onClick: vi.fn() }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders selected count", () => {
    render(
      <BulkActionBar selectedCount={5} actions={[{ label: "Approve", onClick: vi.fn() }]} />,
    );
    expect(screen.getByText("5 selected")).toBeInTheDocument();
  });

  it("renders action buttons", () => {
    const actions = [
      { label: "Approve All", onClick: vi.fn(), variant: "primary" as const },
      { label: "Delete", onClick: vi.fn(), variant: "danger" as const },
    ];
    render(<BulkActionBar selectedCount={3} actions={actions} />);
    expect(screen.getByText("Approve All")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("calls onClick when action button clicked", () => {
    const onClick = vi.fn();
    render(
      <BulkActionBar selectedCount={2} actions={[{ label: "Approve", onClick }]} />,
    );
    fireEvent.click(screen.getByText("Approve"));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders action icons when provided", () => {
    render(
      <BulkActionBar
        selectedCount={1}
        actions={[{ label: "Export", icon: "📥", onClick: vi.fn() }]}
      />,
    );
    expect(screen.getByText("📥")).toBeInTheDocument();
  });
});
