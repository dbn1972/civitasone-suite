import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "./StatCard";

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard icon="📊" label="Total Bills" value={42} />);
    expect(screen.getByText("Total Bills")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders icon with aria-hidden", () => {
    const { container } = render(<StatCard icon="💰" label="Revenue" value="₹1L" />);
    const icon = container.querySelector("[aria-hidden]");
    expect(icon).toBeInTheDocument();
    expect(icon?.textContent).toBe("💰");
  });

  it("applies custom iconBg color", () => {
    const { container } = render(<StatCard icon="📊" iconBg="#ff0000" label="X" value={0} />);
    const icon = container.querySelector(".ic") as HTMLElement;
    expect(icon?.style.background).toBe("rgb(255, 0, 0)");
  });

  it("renders delta with up indicator when up is true", () => {
    const { container } = render(<StatCard icon="📈" label="Growth" value="12%" delta="+5%" up />);
    expect(screen.getByText(/\+5%/)).toBeInTheDocument();
    // C-06/WCAG: the glyph is an aria-hidden icon, not a "↑" text character
    // (axe's color-contrast rule can't measure a decorative Unicode glyph).
    // There's no aria-label on the wrapper either (a <div> has no role that
    // permits one) — the accessible name instead comes from visually-hidden
    // text ("Increase of ") immediately before the visible delta value, so
    // assert on the rendered text rather than an ARIA label association.
    const deltaEl = container.querySelector(".delta");
    expect(deltaEl).toHaveClass("delta", "up");
    expect(deltaEl).not.toHaveAttribute("aria-label");
    expect(deltaEl?.textContent?.replace(/\s+/g, " ").trim()).toBe("Increase of +5%");
    expect(deltaEl?.querySelector(".sr-only")?.textContent).toBe("Increase of ");
  });

  it("renders delta with down indicator when up is false", () => {
    const { container } = render(<StatCard icon="📉" label="Decline" value="8%" delta="-3%" up={false} />);
    expect(screen.getByText(/-3%/)).toBeInTheDocument();
    const deltaEl = container.querySelector(".delta");
    expect(deltaEl).toHaveClass("delta", "down");
    expect(deltaEl).not.toHaveAttribute("aria-label");
    expect(deltaEl?.textContent?.replace(/\s+/g, " ").trim()).toBe("Decrease of -3%");
    expect(deltaEl?.querySelector(".sr-only")?.textContent).toBe("Decrease of ");
  });

  it("does not render delta when not provided", () => {
    const { container } = render(<StatCard icon="📊" label="Count" value={10} />);
    expect(container.querySelector(".delta")).not.toBeInTheDocument();
  });

  it("accepts string value", () => {
    render(<StatCard icon="🏦" label="Balance" value="₹1,23,456.00" />);
    expect(screen.getByText("₹1,23,456.00")).toBeInTheDocument();
  });
});
