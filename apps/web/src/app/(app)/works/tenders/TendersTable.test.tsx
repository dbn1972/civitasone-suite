import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TendersTable } from "./TendersTable";

function iso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString();
}

const rows = [
  { id: "t1", work: "W-1", tenderType: "Open Tender", amount: "15000000", openingDate: "x", openingDateIso: iso(3), authority: "EE", status: "Upcoming", statusKey: "upcoming" },
  { id: "t2", work: "W-2", tenderType: "Limited", amount: "", openingDate: "y", openingDateIso: iso(-5), authority: "AE", status: "Opening date passed", statusKey: "opening_passed" },
  { id: "t3", work: "W-3", tenderType: "Open Tender", amount: "9000000", openingDate: "z", openingDateIso: iso(20), authority: "EE", status: "Upcoming", statusKey: "upcoming" },
];

describe("TendersTable (GAP-WORKS-TENDERS-03 stats, 04 filters)", () => {
  it("computes stat cards from the same rows the table shows", () => {
    render(<TendersTable tenders={rows} source="api" />);
    const statOf = (label: string) =>
      screen
        .getAllByText(label)
        .map((el) => el.closest(".stat"))
        .find((n): n is HTMLElement => n !== null);
    expect(statOf("Total Tenders")?.textContent).toContain("3");
    expect(statOf("Upcoming")?.textContent).toContain("2");
    expect(statOf("Opening date passed")?.textContent).toContain("1");
  });

  it("shows '—' on the stat cards (not a false 0) when source is error with no cache", () => {
    render(<TendersTable tenders={[]} source="error" />);
    const total = screen.getByText("Total Tenders").closest(".stat");
    expect(total?.textContent).toContain("—");
    expect(total?.textContent).not.toMatch(/\b0\b/);
  });

  it("filters to only 'Opening date passed' rows when that status is selected", () => {
    render(<TendersTable tenders={rows} source="api" />);
    const tablist = screen.getByRole("tablist");
    fireEvent.click(within(tablist).getByText("Opening date passed"));
    expect(screen.getByText("W-2")).toBeInTheDocument();
    expect(screen.queryByText("W-1")).not.toBeInTheDocument();
    expect(screen.queryByText("W-3")).not.toBeInTheDocument();
  });

  it("'Opening this week' shows only tenders opening within 7 days", () => {
    render(<TendersTable tenders={rows} source="api" />);
    fireEvent.click(screen.getByLabelText("Opening this week"));
    expect(screen.getByText("W-1")).toBeInTheDocument(); // +3 days
    expect(screen.queryByText("W-3")).not.toBeInTheDocument(); // +20 days
    expect(screen.queryByText("W-2")).not.toBeInTheDocument(); // past
  });
});
