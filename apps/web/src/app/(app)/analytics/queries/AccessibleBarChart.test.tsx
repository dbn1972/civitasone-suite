import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccessibleBarChart } from "./AccessibleBarChart";

describe("AccessibleBarChart", () => {
  // GAP-ANALYTICS-QUERIES-05: the figure must NOT be role="img", otherwise its
  // sr-only <dl> text alternative is presentational and never announced.
  it("does not expose the figure as role=img", () => {
    const { container } = render(
      <AccessibleBarChart title="Spend" data={[{ label: "Finance", value: 100 }]} />,
    );
    expect(container.querySelector('figure[role="img"]')).toBeNull();
    expect(container.querySelector("figure")).not.toBeNull();
  });

  // The description-list alternative is present and carries each entry.
  it("exposes a description list with each datum", () => {
    const { container } = render(
      <AccessibleBarChart
        title="Spend"
        data={[
          { label: "Finance", value: 100 },
          { label: "Health", value: 50 },
        ]}
      />,
    );
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    expect(dl?.querySelectorAll("dt").length).toBe(2);
    expect(dl?.querySelectorAll("dd").length).toBe(2);
  });

  // GAP-ANALYTICS-QUERIES-04: formatValue drives money formatting consistently.
  it("formats values via formatValue in both the visible bar and the dl", () => {
    const { container } = render(
      <AccessibleBarChart
        title="Spend"
        data={[{ label: "Finance", value: 12345 }]}
        formatValue={(v) => `₹${(v / 100).toFixed(2)}`}
      />,
    );
    expect(screen.getAllByText("₹123.45").length).toBe(2); // visible span + dd
    expect(container.querySelector("dl dd")?.textContent).toBe("₹123.45");
  });

  it("shows a status message when there is no data", () => {
    render(<AccessibleBarChart title="Spend" data={[]} />);
    expect(screen.getByText(/No data points to chart/)).toBeInTheDocument();
  });
});
