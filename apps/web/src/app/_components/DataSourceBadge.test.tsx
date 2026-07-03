import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataSourceBadge } from "./DataSourceBadge";

describe("DataSourceBadge", () => {
  it("renders nothing when source is 'api' (healthy)", () => {
    const { container } = render(<DataSourceBadge source="api" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders badge when source is 'error'", () => {
    render(<DataSourceBadge source="error" />);
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });

  it("has role=status for screen readers", () => {
    render(<DataSourceBadge source="error" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
