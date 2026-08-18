import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ForecastChart, type ForecastPoint } from "./ForecastChart";

const DATA: ForecastPoint[] = [
  { date: "2026-08-01", qty: 12 },
  { date: "2026-08-02", qty: 15 },
  { date: "2026-08-03", qty: 9 },
];

describe("ForecastChart — alt data table (Req 3.1)", () => {
  it("renders a visually-hidden table with the same series the chart visualizes", () => {
    render(<ForecastChart itemName="Printer Cartridge" data={DATA} />);

    const table = screen.getByRole("table", { name: "Forecast data table — Printer Cartridge" });
    expect(table).toHaveClass("sr-only");

    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(DATA.length);
    expect(table.textContent).toContain("12");
    expect(table.textContent).toContain("15");
    expect(table.textContent).toContain("9");
  });

  it("renders the chart title referencing the item name", () => {
    render(<ForecastChart itemName="Printer Cartridge" data={DATA} />);
    expect(screen.getByText("30-day demand forecast — Printer Cartridge")).toBeInTheDocument();
  });
});
