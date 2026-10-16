import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthShell } from "./AuthShell";

/**
 * GAP-AUTH-FORGOT-05 / GAP-AUTH-LOGIN-05: AuthShell renders children inside a
 * centred dark-card layout with the correct Tailwind classes.
 */
describe("AuthShell", () => {
  it("renders children", () => {
    render(<AuthShell><p>content</p></AuthShell>);
    expect(screen.getByText("content")).toBeDefined();
  });

  it("renders a <main> element as the page landmark", () => {
    const { container } = render(<AuthShell><span>x</span></AuthShell>);
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("applies the dark-gradient background class", () => {
    const { container } = render(<AuthShell><span>x</span></AuthShell>);
    const main = container.querySelector("main");
    expect(main?.className).toContain("from-slate-900");
  });
});
