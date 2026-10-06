import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Loading from "./loading";

describe("Execution loading skeleton (GAP-WORKS-EXECUTION-05)", () => {
  it("renders five stat placeholders matching the five StatCards on the page", () => {
    const { container } = render(<Loading />);
    // The stat grid is the element using the 5-column responsive class.
    const grid = container.querySelector(".lg\\:grid-cols-5");
    expect(grid).not.toBeNull();
    expect(grid!.children.length).toBe(5);
    // The old four-item grid class must be gone (it caused the layout shift).
    expect(container.querySelector(".lg\\:grid-cols-4")).toBeNull();
  });
});
