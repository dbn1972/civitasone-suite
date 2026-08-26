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

  it("renders a custom message when provided", () => {
    render(<DataSourceBadge source="error" message="Couldn't load — showing nothing" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.queryByText("Showing saved information")).not.toBeInTheDocument();
  });

  it("falls back to the historic copy when no message is given (back-compat)", () => {
    render(<DataSourceBadge source="error" />);
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
