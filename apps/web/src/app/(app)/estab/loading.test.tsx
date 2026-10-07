import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EstabLoading from "./loading";

// GAP-ESTABLISHMENT-HOME-02: the loading skeleton used hand-rolled Tailwind
// bg-slate-200 blocks that render bright gray in dark mode. It now uses the ds
// TileHubSkeleton, whose shimmer is driven by the --line/--line2/--panel theme
// variables so it tracks light/dark mode.
describe("EstabLoading", () => {
  it("renders the design-system loading skeleton", () => {
    render(<EstabLoading />);
    expect(screen.getByLabelText("Loading…")).toBeInTheDocument();
  });

  it("does not use hard-coded bright-gray Tailwind backgrounds", () => {
    const { container } = render(<EstabLoading />);
    expect(container.querySelector('[class*="bg-slate-"]')).toBeNull();
    expect(container.querySelector('[class*="bg-gray-"]')).toBeNull();
  });
});
