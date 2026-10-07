import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initialData: unknown[]) => ({
    data: initialData,
    provenance: "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { ClosureTable } from "./ClosureTable";

const rows = [
  { id: "c1", workId: "w-1", workNumber: "WRK-1", agreement: "AGR/2026/001", description: "Road A", statusDate: "01 Jan 2026", remarks: "—", status: "closed" },
  { id: "c2", workId: "w-2", workNumber: "WRK-2", agreement: "—", description: "Drain B", statusDate: "02 Jan 2026", remarks: "—", status: "dropped" },
  // GAP-WORKS-CLOSURE-03: an unrecognised server value — must still be shown & counted.
  { id: "c3", workId: "w-3", workNumber: "WRK-3", agreement: "—", description: "Bridge C", statusDate: "03 Jan 2026", remarks: "—", status: "other" },
];

describe("ClosureTable", () => {
  it("GAP-WORKS-CLOSURE-02: shows an Agreement column with the unambiguous agreement number", () => {
    render(<ClosureTable closures={rows} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Agreement")).toBeInTheDocument();
    expect(within(table).getByText("AGR/2026/001")).toBeInTheDocument();
  });

  it("GAP-WORKS-CLOSURE-03: default All tab shows every row including an unknown closure type", () => {
    render(<ClosureTable closures={rows} source="api" />);
    expect(screen.getByText("Road A")).toBeInTheDocument();
    expect(screen.getByText("Drain B")).toBeInTheDocument();
    // the "other"-typed row is visible on the default All tab (would vanish under old exact-match tabs)
    expect(screen.getByText("Bridge C")).toBeInTheDocument();
    // An "Other" tab is offered because an unknown value exists
    expect(screen.getByRole("tab", { name: /Other/ })).toBeInTheDocument();
  });

  it("GAP-WORKS-CLOSURE-01: rows link to the work (not a dead-end list)", () => {
    render(<ClosureTable closures={rows} source="api" />);
    const link = screen.getByRole("link", { name: /WRK-1/ });
    expect(link).toHaveAttribute("href", "/works/execution/w-1");
  });

  it("GAP-WORKS-CLOSURE-04: completion tab empty copy reads naturally and the date column is per-tab", () => {
    render(<ClosureTable closures={rows} source="api" />);
    fireEvent.click(screen.getByRole("tab", { name: /Completion/ }));
    expect(screen.getByText("No works in the completion list.")).toBeInTheDocument();
    expect(screen.queryByText(/No completion works to display/i)).not.toBeInTheDocument();
  });

  it("GAP-WORKS-CLOSURE-04: the Closed tab names the date column 'Closed on'", () => {
    render(<ClosureTable closures={rows} source="api" />);
    fireEvent.click(screen.getByRole("tab", { name: /^Closed/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("Closed on")).toBeInTheDocument();
    expect(within(table).queryByText("Status Date")).not.toBeInTheDocument();
  });
});
