import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataSourceBadge } from "./DataSourceBadge";

describe("DataSourceBadge", () => {
  it("renders nothing when source is 'api' (healthy)", () => {
    const { container } = render(<DataSourceBadge source="api" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the honest default badge when source is 'error'", () => {
    render(<DataSourceBadge source="error" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  // Fails-before / passes-after guard. The fetch layer (apiClient.fetchJson)
  // returns the EMPTY fallback on every failure branch and has no stale-cache
  // path, so source="error" never means cached data is on screen. The old
  // default copy "Showing saved information" lied about that; this test locks
  // in that the default can never again claim saved/cached data.
  it("default error copy never implies saved/cached data (truthful)", () => {
    render(<DataSourceBadge source="error" />);
    const badge = screen.getByRole("status");
    expect(badge.textContent ?? "").not.toMatch(/saved|cached|stored information/i);
  });

  it("has role=status for screen readers", () => {
    render(<DataSourceBadge source="error" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders a custom message when provided", () => {
    render(<DataSourceBadge source="error" message="Couldn't load — showing nothing" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("lets a surface pass a more specific truthful message", () => {
    render(<DataSourceBadge source="error" message="Couldn't load claims" />);
    expect(screen.getByText("Couldn't load claims")).toBeInTheDocument();
  });
});
