import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import LegalLoading from "./loading";

describe("Legal hub loading skeleton (GAP-LEGAL-HOME-03)", () => {
  it("renders a busy tile-hub skeleton that inherits the shell (no slate / min-h-screen)", () => {
    const { container } = render(<LegalLoading />);
    const root = container.querySelector('[aria-busy="true"]');
    expect(root).not.toBeNull();
    // No hard-coded light-mode wrapper that breaks dark mode.
    expect(container.querySelector(".min-h-screen")).toBeNull();
    expect(container.querySelector(".bg-slate-50")).toBeNull();
    expect(container.querySelector(".max-w-7xl")).toBeNull();
  });
});
