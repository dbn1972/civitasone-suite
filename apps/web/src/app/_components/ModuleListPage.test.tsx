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

  it("shows DataSourceBadge when source is error", () => {
    render(<ModuleListPage title="Bills" description="desc" rows={[]} source="error" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("does not show DataSourceBadge when source is api", () => {
    render(<ModuleListPage title="Bills" description="desc" rows={rows} source="api" />);
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <ModuleListPage title="Bills" description="desc" rows={rows} source="api">
        <div>Extra widget</div>
      </ModuleListPage>,
    );
    expect(screen.getByText("Extra widget")).toBeInTheDocument();
  });
});
