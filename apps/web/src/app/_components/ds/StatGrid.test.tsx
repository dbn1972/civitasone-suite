import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatGrid } from "./StatGrid";

describe("StatGrid", () => {
  it("renders children inside a grid container", () => {
    render(
      <StatGrid>
        <div>Card 1</div>
        <div>Card 2</div>
      </StatGrid>,
    );
    expect(screen.getByText("Card 1")).toBeInTheDocument();
    expect(screen.getByText("Card 2")).toBeInTheDocument();
  });

  it("applies grid class", () => {
    const { container } = render(<StatGrid><div>Test</div></StatGrid>);
    expect(container.querySelector(".grid.g-4")).toBeInTheDocument();
  });
});
