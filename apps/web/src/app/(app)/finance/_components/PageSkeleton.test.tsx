import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FiscalYearsLoading from "../fiscal-years/loading";
import GstLoading from "../gst/loading";

// GAP-FINANCE-FISCAL-YEARS-04 / GAP-FINANCE-GST-07: the loading shells mirror
// the page (header, stat cards, form/selector, table), not one empty block.
describe("finance route loading skeletons", () => {
  it("fiscal-years: labelled status region with header, 2 stat cards, form and table placeholders", () => {
    const { container } = render(<FiscalYearsLoading />);
    const root = screen.getByRole("status", { name: "Loading fiscal years…" });
    expect(root).toHaveAttribute("aria-live", "polite");
    expect(root.className).toContain("page-main");
    expect(container.querySelectorAll(".grid.g-4 > div")).toHaveLength(2);
    expect(container.querySelectorAll(".card")).toHaveLength(2); // form card + table card
  });

  it("gst: labelled status region with 4 stat cards, the period card before them, and a table", () => {
    const { container } = render(<GstLoading />);
    expect(screen.getByRole("status", { name: "Loading GST console" })).toBeInTheDocument();
    expect(container.querySelectorAll(".grid.g-4 > div")).toHaveLength(4);
    const cards = Array.from(container.querySelectorAll(".card, .grid.g-4"));
    expect(cards[0]!.className).toContain("card"); // period selector card precedes the stat grid
    expect(cards[1]!.className).toContain("g-4");
  });
});
