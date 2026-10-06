import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RouteSkeleton } from "./RouteSkeleton";

// GAP-NOTIFICATIONS-HOME-02: the shared skeleton must not reintroduce the
// min-h-screen / bg-slate-50 pattern that ignores dark mode; it uses DS tokens
// (var(--line*)) inherited from the composed primitives instead.
describe("RouteSkeleton", () => {
  it("renders a tile-grid variant without a forced light background", () => {
    const { container } = render(<RouteSkeleton variant="tiles" />);
    expect(container.querySelector(".min-h-screen")).toBeNull();
    expect(container.querySelector(".bg-slate-50")).toBeNull();
    expect(container.querySelector(".bg-slate-200")).toBeNull();
    // a busy/announced loading region is present
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("renders a list variant without a forced light background", () => {
    const { container } = render(<RouteSkeleton variant="list" />);
    expect(container.querySelector(".min-h-screen")).toBeNull();
    expect(container.querySelector(".bg-slate-50")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
