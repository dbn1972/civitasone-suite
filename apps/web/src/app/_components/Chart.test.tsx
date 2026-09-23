import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chart, type ChartDataPoint } from "./Chart";

const data: ChartDataPoint[] = [
  { label: "Finance", value: 42 },
  { label: "HR", value: 28 },
  { label: "Procurement", value: 15 },
];

describe("Chart", () => {
  describe("bar chart", () => {
    it("renders SVG element", () => {
      const { container } = render(<Chart type="bar" data={data} />);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("renders rect elements for each data point", () => {
      const { container } = render(<Chart type="bar" data={data} />);
      const rects = container.querySelectorAll("rect");
      expect(rects.length).toBe(3);
    });

    it("renders title when provided", () => {
      render(<Chart type="bar" data={data} title="Monthly Summary" />);
      expect(screen.getByText("Monthly Summary")).toBeInTheDocument();
    });

    it("renders data value labels", () => {
      render(<Chart type="bar" data={data} />);
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("28")).toBeInTheDocument();
      expect(screen.getByText("15")).toBeInTheDocument();
    });

    // Issue #15: BudgetChart.tsx (finance dashboard) feeds this component
    // currency values and needs its bar labels to read e.g. "₹42.00", not a
    // bare "42" — this is the generic mechanism that fix relies on.
    it("formats data value labels through a custom valueFormatter when provided", () => {
      render(<Chart type="bar" data={data} valueFormatter={(v) => `₹${v}.00`} />);
      expect(screen.getByText("₹42.00")).toBeInTheDocument();
      expect(screen.getByText("₹28.00")).toBeInTheDocument();
      expect(screen.getByText("₹15.00")).toBeInTheDocument();
      // The raw, unformatted digits must not also be present.
      expect(screen.queryByText("42")).not.toBeInTheDocument();
    });
  });

  describe("line chart", () => {
    it("renders SVG element with polyline or circles", () => {
      const { container } = render(<Chart type="line" data={data} />);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });
  });

  describe("pie chart", () => {
    it("renders SVG element", () => {
      const { container } = render(<Chart type="pie" data={data} />);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("renders path elements for slices", () => {
      const { container } = render(<Chart type="pie" data={data} />);
      const paths = container.querySelectorAll("path");
      expect(paths.length).toBeGreaterThanOrEqual(3);
    });

    // Companion to the donut regression test below: PieChart shares the
    // exact same `value / total` computation and was equally exposed.
    it("renders without NaN when both slice values are zero", () => {
      const zeroData: ChartDataPoint[] = [
        { label: "A", value: 0 },
        { label: "B", value: 0 },
      ];
      const { container } = render(<Chart type="pie" data={zeroData} />);
      expect(container.innerHTML).not.toContain("NaN");
      const paths = container.querySelectorAll("path");
      for (const p of Array.from(paths)) {
        expect(p.getAttribute("d") ?? "").not.toContain("NaN");
      }
    });
  });

  describe("donut chart", () => {
    it("renders SVG element", () => {
      const { container } = render(<Chart type="donut" data={data} />);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("renders path elements for slices", () => {
      const { container } = render(<Chart type="donut" data={data} />);
      const paths = container.querySelectorAll("path");
      expect(paths.length).toBeGreaterThanOrEqual(3);
    });

    it("formats the centre total and legend values through a custom valueFormatter", () => {
      render(<Chart type="donut" data={data} valueFormatter={(v) => `₹${v}.00`} />);
      // Centre total: 42 + 28 + 15 = 85.
      expect(screen.getByText("₹85.00")).toBeInTheDocument();
      // Per-slice legend values.
      expect(screen.getByText("₹42.00")).toBeInTheDocument();
      expect(screen.getByText("₹28.00")).toBeInTheDocument();
      expect(screen.getByText("₹15.00")).toBeInTheDocument();
      expect(screen.queryByText("85")).not.toBeInTheDocument();
    });

    // Regression: a donut with an all-zero split (e.g. BudgetChart.tsx's
    // Utilized/Remaining when a tenant has no sanctioned budget AND nothing
    // spent yet) has `total = 0`, so every slice's share was `0 / 0`. That
    // is NaN, not an exception -- it doesn't throw, it silently poisons
    // every arc's path coordinates and lands the literal string "NaN%" in
    // each slice's hover tooltip. Assert an honest empty state instead.
    it("renders an honest no-data state instead of NaN when both slice values are zero", () => {
      const zeroData: ChartDataPoint[] = [
        { label: "Utilized", value: 0 },
        { label: "Remaining", value: 0 },
      ];
      const { container } = render(
        <Chart type="donut" data={zeroData} valueFormatter={(v) => `₹${v}.00`} />
      );
      expect(container.innerHTML).not.toContain("NaN");
      // Two elements legitimately say "No data" here: the SVG ring's own
      // <title> hover tooltip and the visible centre <text> label -- same
      // convention as the existing "agree on the same... magnitude" test in
      // BudgetChart.test.tsx (getAllByText, not getByText, when more than
      // one match is expected and correct).
      expect(screen.getAllByText("No data").length).toBeGreaterThanOrEqual(2);
      const paths = container.querySelectorAll("path");
      for (const p of Array.from(paths)) {
        expect(p.getAttribute("d") ?? "").not.toContain("NaN");
      }
    });
  });

  it("handles empty data gracefully", () => {
    const { container } = render(<Chart type="bar" data={[]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("handles single data point", () => {
    const { container } = render(<Chart type="bar" data={[{ label: "Only", value: 100 }]} />);
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBe(1);
  });

  it("uses custom color when provided", () => {
    const customData = [{ label: "Red", value: 50, color: "#ef4444" }];
    const { container } = render(<Chart type="bar" data={customData} />);
    const rect = container.querySelector("rect");
    expect(rect).toHaveAttribute("fill", "#ef4444");
  });

  it("respects custom height", () => {
    const { container } = render(<Chart type="bar" data={data} height={300} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("height", "300");
  });
});
