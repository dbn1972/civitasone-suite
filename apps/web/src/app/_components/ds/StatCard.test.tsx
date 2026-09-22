import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "./StatCard";

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard icon="📊" label="Total Bills" value={42} />);
    expect(screen.getByText("Total Bills")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders a mapped icon as a real vector icon, not raw emoji text", () => {
    // Bug B: "💰" is in StatIcon's map, so StatCard must render the <svg>
    // lucide-react icon it resolves to -- not the literal emoji character,
    // which renders as an empty "tofu" box in any environment without an
    // OS color-emoji font (e.g. this repo's own
    // scripts/dev/capture-screenshots.mjs host).
    const { container } = render(<StatCard icon="💰" label="Revenue" value="₹1L" />);
    const icon = container.querySelector("[aria-hidden]");
    expect(icon).toBeInTheDocument();
    expect(icon?.querySelector("svg")).toBeInTheDocument();
    expect(icon?.textContent).toBe("");
  });

  it("falls back to the raw glyph for an icon with no vector mapping", () => {
    // Not a regression: this is exactly today's pre-fix behavior, kept for
    // the long tail of emoji not yet in StatIcon's map.
    const { container } = render(<StatCard icon="🧿" label="Unmapped" value={1} />);
    const icon = container.querySelector(".ic") as HTMLElement;
    expect(icon.querySelector("svg")).not.toBeInTheDocument();
    expect(icon.textContent).toBe("🧿");
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

  describe("failed-to-load values (Bug A: fabricated zero vs honest —)", () => {
    // A stat with no real value (fetch failed, not yet known) must read as
    // "we don't know", not as a fabricated zero -- a hard `0` or `₹0.00` is
    // visually indistinguishable from a genuine zero. This is the shared
    // default: a page that passes null/undefined/NaN straight through on
    // error (instead of writing its own `errored ? "—" : value` ternary on
    // every single stat) still renders correctly.
    it("renders em dash for a null value", () => {
      render(<StatCard icon="📊" label="X" value={null} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders em dash for an undefined value", () => {
      render(<StatCard icon="📊" label="X" value={undefined} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders em dash for a NaN value", () => {
      render(<StatCard icon="📊" label="X" value={NaN} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders em dash for an empty-string value", () => {
      render(<StatCard icon="📊" label="X" value="" />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("still renders a genuine zero as 0, not em dash", () => {
      render(<StatCard icon="📊" label="X" value={0} />);
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("callers can still pass their own pre-formatted em dash directly", () => {
      render(<StatCard icon="📊" label="X" value="—" />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });
});
