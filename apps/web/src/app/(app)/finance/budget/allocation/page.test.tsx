import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/_data/loaders", () => ({
  getFinanceAllocations: vi.fn(async () => ({
    source: "api",
    status: 200,
    data: [
      { id: "a1", headId: "h1", fy: "2026-27", allocatedMinor: "100", committedMinor: "50", actualMinor: "0", availableMinor: "50" },
      { id: "a2", headId: "h2", fy: "2026-27", allocatedMinor: "100", committedMinor: "0", actualMinor: "0", availableMinor: "100" },
    ],
  })),
}));
vi.mock("./AllocationTable", () => ({ AllocationTable: () => <div>table</div> }));

import AllocationPage from "./page";

describe("AllocationPage copy (GAP-FINANCE-BUDGET-ALLOCATION-04)", () => {
  it("does not promise release / department-wise and labels the zero-commitment card by meaning", async () => {
    render(await AllocationPage());
    expect(screen.getByText(/by budget head and financial year/)).toBeInTheDocument();
    expect(screen.queryByText(/release/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/department-wise/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getByText("Not yet committed").closest(".stat")).toHaveTextContent("1");
  });
});
