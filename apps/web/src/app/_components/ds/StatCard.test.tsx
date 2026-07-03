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
    render(<StatCard icon="📈" label="Growth" value="12%" delta="+5%" up />);
    expect(screen.getByText(/\+5%/)).toBeInTheDocument();
    const deltaEl = screen.getByText(/▲/).closest(".delta");
    expect(deltaEl).toHaveClass("up");
  });

  it("renders delta with down indicator when up is false", () => {
    render(<StatCard icon="📉" label="Decline" value="8%" delta="-3%" up={false} />);
    expect(screen.getByText(/-3%/)).toBeInTheDocument();
    const deltaEl = screen.getByText(/▼/).closest(".delta");
    expect(deltaEl).toHaveClass("down");
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
