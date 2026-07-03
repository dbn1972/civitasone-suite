import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders initials from single name", () => {
    render(<Avatar name="Priya" />);
    expect(screen.getByText("P")).toBeInTheDocument();
  });

  it("renders initials from full name (first + last)", () => {
    render(<Avatar name="Priya Sharma" />);
    expect(screen.getByText("PS")).toBeInTheDocument();
  });

  it("renders at most 2 initials for long names", () => {
    render(<Avatar name="Ram Kumar Singh" />);
    expect(screen.getByText("RK")).toBeInTheDocument();
  });

  it("applies custom background color", () => {
    const { container } = render(<Avatar name="Test User" color="#e11d48" />);
    const el = container.querySelector(".av") as HTMLElement;
    expect(el.style.background).toBe("rgb(225, 29, 72)");
  });

  it("defaults to indigo background", () => {
    const { container } = render(<Avatar name="Test User" />);
    const el = container.querySelector(".av") as HTMLElement;
    expect(el.style.background).toBe("rgb(79, 70, 229)");
  });

  it("sets title attribute for name", () => {
    const { container } = render(<Avatar name="Priya Sharma" />);
    const el = container.querySelector("[title]");
    expect(el).toHaveAttribute("title", "Priya Sharma");
  });

  it("applies size class when provided", () => {
    const { container } = render(<Avatar name="Test" size="lg" />);
    expect(container.querySelector(".av.lg")).toBeInTheDocument();
  });

  it("applies no size class when size is undefined", () => {
    const { container } = render(<Avatar name="Test" />);
    const el = container.querySelector(".av") as HTMLElement;
    expect(el.className).toBe("av");
  });
});
