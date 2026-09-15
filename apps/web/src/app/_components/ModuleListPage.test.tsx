import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModuleListPage } from "./ModuleListPage";

// Mock the ModuleListTable since it uses hooks from sync module
vi.mock("./ModuleListTable", () => ({
  ModuleListTable: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="list-table">{rows.length} rows</div>
  ),
}));

describe("ModuleListPage", () => {
  const rows = [
    { id: "r-1", label: "Bill #001", sublabel: "Vendor A", status: "approved", meta: "₹1L" },
    { id: "r-2", label: "Bill #002", sublabel: "Vendor B", status: "pending", meta: "₹2L" },
  ];

  it("renders title", () => {
    render(<ModuleListPage title="Bills" description="All bills" rows={rows} source="api" />);
    expect(screen.getByRole("heading", { level: 1, name: "Bills" })).toBeInTheDocument();
  });

  it("renders description", () => {
    render(<ModuleListPage title="Bills" description="All bills" rows={rows} source="api" />);
    expect(screen.getByText("All bills")).toBeInTheDocument();
  });

  it("passes rows to ModuleListTable", () => {
    render(<ModuleListPage title="Bills" description="desc" rows={rows} source="api" />);
    expect(screen.getByTestId("list-table")).toHaveTextContent("2 rows");
  });

  // UX-012: ModuleListPage used to render its own <DataSourceBadge
  // source={source} /> straight off the raw `source` prop, independently of
  // ModuleListTable's own useSeededResource-derived cache state — the exact
  // UX-002 contradictory-badge shape (a failed fetch with a usable cache
  // could show "showing nothing" here AND "Showing saved data" in the
  // table at once). The badge now lives inside ModuleListTable, reading the
  // same hook call that produces its rows, so it can't disagree with them.
  // No coverage lost: ModuleListTable.test.tsx covers all three provenance
  // states (live / cached / error-no-data) directly.

  it("renders children", () => {
    render(
      <ModuleListPage title="Bills" description="desc" rows={rows} source="api">
        <div>Extra widget</div>
      </ModuleListPage>,
    );
    expect(screen.getByText("Extra widget")).toBeInTheDocument();
  });
});
