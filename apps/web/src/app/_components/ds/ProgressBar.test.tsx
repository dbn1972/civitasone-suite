import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders with correct percentage width", () => {
    const { container } = render(<ProgressBar value={75} />);
    const inner = container.querySelector("i") as HTMLElement;
    expect(inner.style.width).toBe("75%");
  });

  it("clamps value at 100%", () => {
    const { container } = render(<ProgressBar value={150} />);
    const inner = container.querySelector("i") as HTMLElement;
    expect(inner.style.width).toBe("100%");
  });

  it("clamps value at 0%", () => {
    const { container } = render(<ProgressBar value={-10} />);
    const inner = container.querySelector("i") as HTMLElement;
    expect(inner.style.width).toBe("0%");
  });

  it("renders 0% for zero value", () => {
    const { container } = render(<ProgressBar value={0} />);
    const inner = container.querySelector("i") as HTMLElement;
    expect(inner.style.width).toBe("0%");
  });

  it("applies custom color when provided", () => {
    const { container } = render(<ProgressBar value={50} color="#e11d48" />);
    const inner = container.querySelector("i") as HTMLElement;
    expect(inner.style.background).toBe("rgb(225, 29, 72)");
  });

  it("does not set background when color is not provided", () => {
    const { container } = render(<ProgressBar value={50} />);
    const inner = container.querySelector("i") as HTMLElement;
    expect(inner.style.background).toBe("");
  });

  it("renders bar container with correct class", () => {
    const { container } = render(<ProgressBar value={50} />);
    expect(container.querySelector(".bar")).toBeInTheDocument();
  });
});
