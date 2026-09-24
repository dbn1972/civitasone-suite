import { describe, it, expect } from "vitest";
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

  // UX-006: a missing amount (null/undefined field, e.g. an API error or a
  // mapping gap) must render as an honest "—", never as a fabricated ₹0.00
  // that's indistinguishable from a genuine zero-rupee row. This is a
  // fleet-wide guard — every page using cellType:"amount" funnels through
  // this one cellValue() path.
  it("renders an em-dash (not ₹0.00) for a null/undefined amount cellType", () => {
    const rowsWithMissing = [
      ...rows,
      { id: "PO-004", name: "Missing Amount", amount: null as unknown as number, status: "draft" },
      { id: "PO-005", name: "Undefined Amount", amount: undefined as unknown as number, status: "draft" },
    ];
    render(<DataTable columns={columns} rows={rowsWithMissing} />);
    const dashCells = screen.getAllByText("—");
    expect(dashCells.length).toBe(2);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("still renders a genuine zero amount as ₹0.00, distinct from missing", () => {
    const rowsWithZero = [{ id: "PO-006", name: "Free Sample", amount: 0, status: "approved" }];
    render(<DataTable columns={columns} rows={rowsWithZero} />);
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
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
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "IT" } });
    expect(screen.getByText("IT Equipment")).toBeInTheDocument();
    expect(screen.queryByText("Office Supplies")).not.toBeInTheDocument();
  });

  // UX-014: the filter input must be a real searchbox (type="search"), with
  // an accessible name derived from the page's own filterPlaceholder rather
  // than a generic/inconsistent one, without requiring every one of the
  // ~80+ DataTable consumers to pass a new prop.
  it("derives a descriptive searchbox name from an explicit filterPlaceholder", () => {
    render(
      <DataTable columns={columns} rows={rows} filterable filterPlaceholder="Filter by GRN no, vendor…" />,
    );
    expect(screen.getByRole("searchbox", { name: "Search GRN no, vendor" })).toBeInTheDocument();
  });

  it("derives a descriptive searchbox name from a filterPlaceholder with no 'by'", () => {
    render(<DataTable columns={columns} rows={rows} filterable filterPlaceholder="Filter DPRs…" />);
    expect(screen.getByRole("searchbox", { name: "Search DPRs" })).toBeInTheDocument();
  });

  it("leaves an already-'Search'-worded filterPlaceholder unchanged", () => {
    render(<DataTable columns={columns} rows={rows} filterable filterPlaceholder="Search vendors…" />);
    expect(screen.getByRole("searchbox", { name: "Search vendors" })).toBeInTheDocument();
  });

  it("falls back to a generic name when no filterPlaceholder is given", () => {
    render(<DataTable columns={columns} rows={rows} filterable />);
    expect(screen.getByRole("searchbox", { name: "Search records" })).toBeInTheDocument();
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

  // UX-015: the row-link's accessible name must name the row after the field
  // a person would use to tell rows apart, not blindly after column 0 --
  // e.g. a vendor's own name, not its internal vendorCode. identifyingColumnKey
  // lets a consumer opt a different column into that role.
  describe("row-link accessible name (UX-015)", () => {
    it("defaults to column 0's value when identifyingColumnKey is not passed (regression safety)", () => {
      render(<DataTable columns={columns} rows={rows} rowLinkKey="id" rowLinkPrefix="/orders/" />);
      expect(screen.getByRole("link", { name: "Open PO-001" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Open Office Supplies" })).not.toBeInTheDocument();
    });

    it("uses identifyingColumnKey's value instead of column 0 when provided", () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          rowLinkKey="id"
          rowLinkPrefix="/orders/"
          identifyingColumnKey="name"
        />,
      );
      expect(screen.getByRole("link", { name: "Open Office Supplies" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Open PO-001" })).not.toBeInTheDocument();
    });

    it("also honors identifyingColumnKey with rowHref (client-only link builder)", () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          rowHref={(row) => `/orders/${row.id}`}
          identifyingColumnKey="name"
        />,
      );
      expect(screen.getByRole("link", { name: "Open Office Supplies" })).toBeInTheDocument();
    });
  });

  // Row identity: rows must be keyed by their own id, not by array position,
  // so a sort/filter can't silently re-label an existing DOM node (and
  // anything the browser is tracking on it, e.g. an in-progress edit or
  // keyboard focus) with a different row's data. Proven here with an
  // uncontrolled input per row: its DOM-held value only follows the right
  // row across a resort if React is keying by identity.
  describe("row identity across reorders", () => {
    const colsWithNoteInput = [
      { key: "id" as const, label: "ID" },
      { key: "name" as const, label: "Name", sortable: true },
      {
        key: "status" as const,
        label: "Note",
        render: (row: Row) => <input aria-label={`note-${row.id}`} defaultValue="" />,
      },
    ];

    it("keeps a row's own DOM state attached to that row's id after a resort moves it", () => {
      render(<DataTable columns={colsWithNoteInput} rows={rows} sortable />);

      // PO-001 ("Office Supplies") renders first pre-sort; type into its note.
      fireEvent.change(screen.getByLabelText("note-PO-001"), { target: { value: "flagged" } });

      // Ascending name-sort moves PO-001 ("Office Supplies") to the last
      // position and PO-003 ("Furniture") to the first.
      fireEvent.click(screen.getByText("Name"));

      // The note must have followed PO-001, not stayed behind on whichever
      // row now occupies PO-001's old position.
      expect((screen.getByLabelText("note-PO-001") as HTMLInputElement).value).toBe("flagged");
      expect((screen.getByLabelText("note-PO-003") as HTMLInputElement).value).toBe("");
    });

    it("supports an explicit rowKey override for identity that isn't the row's id field", () => {
      type Keyless = { code: string; name: string };
      const kRows: Keyless[] = [
        { code: "A1", name: "Alpha" },
        { code: "B2", name: "Beta" },
      ];
      const kCols = [
        { key: "code" as const, label: "Code" },
        { key: "name" as const, label: "Name" },
      ];
      const { container } = render(
        <DataTable columns={kCols} rows={kRows} rowKey={(r) => r.code} />,
      );
      // Sanity: still renders both rows normally with the override in place.
      expect(container.querySelectorAll("tbody tr").length).toBe(2);
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    it("falls back to positional keying only when a row has no id field (back-compat)", () => {
      type NoId = { label: string };
      const plainRows: NoId[] = [{ label: "First" }, { label: "Second" }];
      const plainCols = [{ key: "label" as const, label: "Label" }];
      render(<DataTable columns={plainCols} rows={plainRows} />);
      expect(screen.getByText("First")).toBeInTheDocument();
      expect(screen.getByText("Second")).toBeInTheDocument();
    });
  });

  // A clickable <tr> (onClick + Enter/Space + tabIndex) still carried its
  // native, non-interactive "row" role, so assistive tech never learned it
  // was actionable and AT quick-nav (e.g. NVDA/JAWS "next button") skipped
  // it entirely. Keyboard activation already worked; role="button" is the
  // missing piece.
  describe("clickable row semantics", () => {
    it("gives every link-row role=button", () => {
      render(<DataTable columns={columns} rows={rows} rowLinkKey="id" rowLinkPrefix="/orders/" />);
      expect(screen.getAllByRole("button")).toHaveLength(rows.length);
    });

    it("does not add role=button to rows when the table has no row link", () => {
      render(<DataTable columns={columns} rows={rows} />);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });
  });
});
