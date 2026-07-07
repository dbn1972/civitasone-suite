import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBar } from "./ConfidenceBar";

describe("ConfidenceBar", () => {
  it("renders with correct percentage width", () => {
    const { container } = render(<ConfidenceBar value={0.75} />);
    const bar = container.querySelector("[role='meter'] > div") as HTMLElement;
    expect(bar.style.width).toBe("75%");
  });

  it("clamps value at 100% for values over 1", () => {
    const { container } = render(<ConfidenceBar value={1.5} />);
    const bar = container.querySelector("[role='meter'] > div") as HTMLElement;
    expect(bar.style.width).toBe("100%");
  });

  it("clamps value at 0% for negative values", () => {
    const { container } = render(<ConfidenceBar value={-0.2} />);
    const bar = container.querySelector("[role='meter'] > div") as HTMLElement;
    expect(bar.style.width).toBe("0%");
  });

  it("applies green color for confidence > 0.70", () => {
    const { container } = render(<ConfidenceBar value={0.85} />);
    const bar = container.querySelector("[role='meter'] > div") as HTMLElement;
    expect(bar.className).toContain("bg-green-500");
  });

  it("applies amber color for confidence between 0.40 and 0.70", () => {
    const { container } = render(<ConfidenceBar value={0.55} />);
    const bar = container.querySelector("[role='meter'] > div") as HTMLElement;
    expect(bar.className).toContain("bg-amber-500");
  });

  it("applies amber color at exactly 0.40", () => {
    const { container } = render(<ConfidenceBar value={0.4} />);
    const bar = container.querySelector("[role='meter'] > div") as HTMLElement;
    expect(bar.className).toContain("bg-amber-500");
  });

  it("applies red color for confidence < 0.40", () => {
    const { container } = render(<ConfidenceBar value={0.25} />);
    const bar = container.querySelector("[role='meter'] > div") as HTMLElement;
    expect(bar.className).toContain("bg-red-500");
  });

  it("has correct aria attributes", () => {
    render(<ConfidenceBar value={0.72} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "72");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
  });

  it("uses default aria-label when none provided", () => {
    render(<ConfidenceBar value={0.72} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-label", "Confidence: 72%");
  });

  it("uses custom aria-label when provided", () => {
    render(<ConfidenceBar value={0.72} ariaLabel="Custom label" />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-label", "Custom label");
  });

  it("applies custom height", () => {
    const { container } = render(<ConfidenceBar value={0.5} height={12} />);
    const meter = container.querySelector("[role='meter']") as HTMLElement;
    expect(meter.style.height).toBe("12px");
  });

  it("applies default height of 8px", () => {
    const { container } = render(<ConfidenceBar value={0.5} />);
    const meter = container.querySelector("[role='meter']") as HTMLElement;
    expect(meter.style.height).toBe("8px");
  });
});
