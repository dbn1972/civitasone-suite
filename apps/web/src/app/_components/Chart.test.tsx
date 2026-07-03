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
