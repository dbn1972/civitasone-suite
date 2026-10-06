import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeTokenTable } from "./ThemeTokenTable";

describe("ThemeTokenTable (GAP-THEMES-TOKENS-04)", () => {
  it("renders a swatch for an rgb() colour value (not just hex)", () => {
    render(<ThemeTokenTable tokens={[{ key: "brand.primary", value: "rgb(0, 0, 0)" }]} />);
    // The swatch is a role=img with an aria-label naming the colour.
    expect(screen.getByRole("img", { name: /Colour swatch rgb\(0, 0, 0\)/i })).toBeInTheDocument();
  });

  it("renders a swatch for an 8-digit hex (with alpha)", () => {
    render(<ThemeTokenTable tokens={[{ key: "overlay", value: "#ffffff80" }]} />);
    expect(screen.getByRole("img", { name: /Colour swatch #ffffff80/i })).toBeInTheDocument();
  });

  it("does not render a swatch for a scalar value", () => {
    render(<ThemeTokenTable tokens={[{ key: "spacing.sm", value: "8px" }]} />);
    expect(screen.queryByRole("img", { name: /Colour swatch/i })).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no tokens", () => {
    render(<ThemeTokenTable tokens={[]} />);
    expect(screen.getByText("No theme tokens")).toBeInTheDocument();
  });
});
