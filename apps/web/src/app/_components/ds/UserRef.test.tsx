import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserRef } from "./UserRef";

describe("UserRef (GAP-CHANGE-DETAIL-03)", () => {
  it("shows the name and keeps the full id in a tooltip when a name is given", () => {
    render(<UserRef id="a1b2c3d4-0000-4000-8000-000000000000" name="Asha Rao" />);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByTitle("a1b2c3d4-0000-4000-8000-000000000000")).toBeInTheDocument();
  });

  it("falls back to a short id (with full id in title) when no name is available", () => {
    const { container } = render(<UserRef id="a1b2c3d4-0000-4000-8000-000000000000" />);
    expect(screen.getByText("a1b2c3d4")).toBeInTheDocument();
    expect(container.querySelector('[title="a1b2c3d4-0000-4000-8000-000000000000"]')).not.toBeNull();
  });

  it("renders an em dash for a missing id and no name", () => {
    render(<UserRef id={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
