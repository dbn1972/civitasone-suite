import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable } from "./DataTable";

type Row = { id: string; name: string; amount: number; status: string };

const columns = [
  { key: "id" as const, label: "ID" },
  { key: "name" as const, label: "Name" },
  { key: "amount" as const, label: "Amount", align: "right" as const, cellType: "amount" as const },
  { key: "status" as const, label: "Status", cellType: "status" as const },
];

const rows: Row[] = [
  { id: "PO-001", name: "Office Supplies", amount: 25000, status: "approved" },
  { id: "PO-002", name: "IT Equipment", amount: 150000, status: "pending" },
  { id: "PO-003", name: "Furniture", amount: 80000, status: "draft" },
];

describe("DataTable", () => {
  it("renders table with headers", () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("renders all data rows", () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByText("PO-001")).toBeInTheDocument();
    expect(screen.getByText("Office Supplies")).toBeInTheDocument();
    expect(screen.getByText("IT Equipment")).toBeInTheDocument();
    expect(screen.getByText("Furniture")).toBeInTheDocument();
  });

  it("renders StatusPill for status cellType", () => {
    const { container } = render(<DataTable columns={columns} rows={rows} />);
    const pills = container.querySelectorAll(".pill");
    expect(pills.length).toBe(3);
  });

  it("renders formatted money for amount cellType", () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByText("₹250.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,500.00")).toBeInTheDocument();
  });

  it("shows empty state when no rows", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        emptyTitle="No orders"
        emptyMessage="Create your first PO"
      />,
    );
    expect(screen.getByText("No orders")).toBeInTheDocument();
    expect(screen.getByText("Create your first PO")).toBeInTheDocument();
  });

  it("supports filtering when filterable=true", () => {
    render(<DataTable columns={columns} rows={rows} filterable />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "IT" } });
    expect(screen.getByText("IT Equipment")).toBeInTheDocument();
    expect(screen.queryByText("Office Supplies")).not.toBeInTheDocument();
  });

  it("supports sorting when sortable=true", () => {
    render(<DataTable columns={columns} rows={rows} sortable />);
    // Click on the Name header to sort
    fireEvent.click(screen.getByText("Name"));
    const trs = screen.getAllByRole("row");
    // First row (after header) should be Furniture (alphabetically first)
    expect(trs[1]).toHaveTextContent("Furniture");
  });

  it("toggles sort direction on second click", () => {
    render(<DataTable columns={columns} rows={rows} sortable />);
    fireEvent.click(screen.getByText("Name"));
    fireEvent.click(screen.getByText("Name"));
    const trs = screen.getAllByRole("row");
    // After desc sort, first data row should be Office Supplies
    expect(trs[1]).toHaveTextContent("Office Supplies");
  });

  it("shows sort indicator on sortable headers", () => {
    render(<DataTable columns={columns} rows={rows} sortable />);
    expect(screen.getAllByText("↕").length).toBeGreaterThan(0);
  });

  it("paginates when pageSize is set", () => {
    render(<DataTable columns={columns} rows={rows} pageSize={2} />);
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("PO-001")).toBeInTheDocument();
    expect(screen.getByText("PO-002")).toBeInTheDocument();
    expect(screen.queryByText("PO-003")).not.toBeInTheDocument();
  });

  it("navigates to next page", () => {
    render(<DataTable columns={columns} rows={rows} pageSize={2} />);
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("PO-003")).toBeInTheDocument();
  });

  it("disables prev on first page", () => {
    render(<DataTable columns={columns} rows={rows} pageSize={2} />);
    expect(screen.getByText("← Prev")).toBeDisabled();
  });

  it("disables next on last page", () => {
    render(<DataTable columns={columns} rows={rows} pageSize={2} />);
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Next →")).toBeDisabled();
  });

  it("shows export button when exportable=true", () => {
    render(<DataTable columns={columns} rows={rows} exportable />);
    expect(screen.getByText("⬇ CSV")).toBeInTheDocument();
  });
});
