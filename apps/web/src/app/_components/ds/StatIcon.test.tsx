import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatIcon } from "./StatIcon";

describe("StatIcon", () => {
  it("renders a vector icon for a mapped emoji", () => {
    const { container } = render(<StatIcon icon="💰" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(container.textContent).toBe("");
  });

  it("marks the rendered icon aria-hidden", () => {
    const { container } = render(<StatIcon icon="✅" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("normalizes Variation Selector-16 before matching", () => {
    // "⏱" (U+23F1) and "⏱️" (U+23F1 U+FE0F) must resolve to the same icon --
    // callers across the app use both forms inconsistently for the same
    // concept (e.g. estab/dashboard's "SLA Breached" vs citizen/portal's
    // "Avg Resolution Days").
    const withoutVS = render(<StatIcon icon="⏱" />);
    const withVS = render(<StatIcon icon="⏱️" />);
    expect(withoutVS.container.querySelector("svg")).toBeInTheDocument();
    expect(withVS.container.querySelector("svg")).toBeInTheDocument();
    expect(withVS.container.querySelector("svg")?.outerHTML).toBe(
      withoutVS.container.querySelector("svg")?.outerHTML,
    );
  });

  it("falls back to the raw glyph when there is no mapping", () => {
    // Not a regression: this is exactly today's pre-fix behavior for the
    // long tail of emoji not yet in the map, so adding entries later can
    // never make coverage worse than it already is.
    const { container } = render(<StatIcon icon="🧿" />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(container.textContent).toBe("🧿");
  });

  it("passes a custom size through to the icon", () => {
    const { container } = render(<StatIcon icon="👥" size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });

  it("defaults to a 20px icon", () => {
    const { container } = render(<StatIcon icon="👥" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
  });
});
