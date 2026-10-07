import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// RouteError pulls the error catalogue; render it real so backHref flows through.
import ErrorBoundary from "./error";
import Loading from "./loading";

describe("Establishment error boundary (GAP-ESTAB-HOME-02)", () => {
  it("sends the back link to the hub /estab, not the File Register sub-page", () => {
    const { container } = render(
      <ErrorBoundary error={new Error("boom") as Error & { digest?: string }} reset={vi.fn()} />,
    );
    const back = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Back to Establishment");
    expect(back).toBeDefined();
    expect(back).toHaveAttribute("href", "/estab");
  });
});

describe("Establishment hub loading (GAP-ESTAB-HOME-03)", () => {
  it("paints a tile-hub skeleton without the raw slate full-page background", () => {
    const { container } = render(<Loading />);
    // No min-h-screen / bg-slate-50 full-page wrapper.
    expect(container.querySelector(".min-h-screen")).toBeNull();
    expect(container.querySelector(".bg-slate-50")).toBeNull();
    // The DS tile-hub skeleton exposes an aria-busy loading region.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
