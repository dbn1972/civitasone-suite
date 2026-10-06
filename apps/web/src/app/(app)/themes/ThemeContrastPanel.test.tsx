import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { contrastPairs, ThemeContrastPanel, WCAG_AA_NORMAL } from "./ThemeContrastPanel";

describe("contrastPairs (GAP-THEMES-TOKENS-03)", () => {
  it("flags a low-contrast primary-on-background pair as failing AA", () => {
    const pairs = contrastPairs([
      { key: "brand.primary", value: "#777777" },
      { key: "surface.canvas", value: "#ffffff" },
    ]);
    const primary = pairs.find((p) => p.label === "Primary on background");
    expect(primary).toBeDefined();
    expect(primary!.passes).toBe(false);
    expect(primary!.ratio).toBeLessThan(WCAG_AA_NORMAL);
  });

  it("passes a high-contrast text-on-background pair", () => {
    const pairs = contrastPairs([
      { key: "color.text", value: "#111111" },
      { key: "color.background", value: "#ffffff" },
    ]);
    const text = pairs.find((p) => p.label === "Body text on background");
    expect(text).toBeDefined();
    expect(text!.passes).toBe(true);
    expect(text!.ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
  });

  it("skips non-hex colours rather than reporting a wrong ratio", () => {
    const pairs = contrastPairs([
      { key: "brand.primary", value: "rgb(0,0,0)" },
      { key: "surface.canvas", value: "#ffffff" },
    ]);
    expect(pairs.find((p) => p.label === "Primary on background")).toBeUndefined();
  });
});

describe("ThemeContrastPanel", () => {
  it("renders a Fails AA badge for #777 on #fff", () => {
    render(
      <ThemeContrastPanel
        tokens={[
          { key: "brand.primary", value: "#777777" },
          { key: "surface.canvas", value: "#ffffff" },
        ]}
      />,
    );
    expect(screen.getByText("Fails AA")).toBeInTheDocument();
  });

  it("renders nothing when there are no evaluable colour pairs", () => {
    const { container } = render(<ThemeContrastPanel tokens={[{ key: "spacing.sm", value: "8px" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
