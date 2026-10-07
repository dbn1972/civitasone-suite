import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccuracyTrendChart } from "./AccuracyTrendChart";

describe("GAP-ANALYTICS-ML-INSIGHTS-*-03/04: AccuracyTrendChart scale + a11y", () => {
  it("scales bars against a fixed 0..1 axis (30% -> 30% height, not full)", () => {
    const { container } = render(
      <AccuracyTrendChart data={[{ date: "2026-03-01", accuracy: 0.3 }]} />,
    );
    const bar = container.querySelector('[role="presentation"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.height).toBe("30%");
  });

  it("renders heights 20/50/90% for 0.2/0.5/0.9", () => {
    const { container } = render(
      <AccuracyTrendChart
        data={[
          { date: "2026-03-01", accuracy: 0.2 },
          { date: "2026-03-02", accuracy: 0.5 },
          { date: "2026-03-03", accuracy: 0.9 },
        ]}
      />,
    );
    const bars = Array.from(container.querySelectorAll('[role="presentation"]')) as HTMLElement[];
    expect(bars.map((b) => b.style.height)).toEqual(["20%", "50%", "90%"]);
  });

  it("exposes each date and value to screen readers via an sr-only list", () => {
    render(<AccuracyTrendChart data={[{ date: "2026-03-01", accuracy: 0.82 }]} metricLabel="AUC-ROC" />);
    expect(screen.getByText(/82% \(good\)/)).toBeInTheDocument();
  });

  it("does NOT put an aria-label on presentation (bar) nodes", () => {
    const { container } = render(<AccuracyTrendChart data={[{ date: "2026-03-01", accuracy: 0.5 }]} />);
    const bar = container.querySelector('[role="presentation"]') as HTMLElement;
    expect(bar.getAttribute("aria-label")).toBeNull();
  });

  it("colours a 12% MAPE as the good band when lower-is-better", () => {
    const { container } = render(
      <AccuracyTrendChart
        data={[{ date: "2026-03-01", accuracy: 0.12 }]}
        metricLabel="MAPE"
        higherIsBetter={false}
        thresholds={{ good: 0.15, warn: 0.3 }}
      />,
    );
    const bar = container.querySelector('[role="presentation"]') as HTMLElement;
    expect(bar.style.backgroundColor).toContain("--ok");
  });

  it("includes the year when the series spans more than one calendar year", () => {
    render(
      <AccuracyTrendChart
        data={[
          { date: "2025-12-20", accuracy: 0.5 },
          { date: "2026-01-05", accuracy: 0.6 },
        ]}
      />,
    );
    // sr-only list items carry the formatted date; a multi-year span shows 2025/2026.
    expect(screen.getAllByText(/2025/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });
});
