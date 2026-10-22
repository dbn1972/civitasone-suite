import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { TransferListFilters, filterTransfers, appliedFilterCount, type TransferFilterValues } from "./TransferListFilters";
import type { TransferRow } from "./TransferOrderCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));

// GAP-HR-TRANSFER-04: ONE filter bar drives the card grid AND the table.
const ROWS: TransferRow[] = [
  { id: "t1", employee: "Asha Rao", fromOffice: "Estate", toOffice: "Finance", status: "requested", effectiveDate: "2026-09-01", orderNo: null, relievedDate: null },
  { id: "t2", employee: "Vikram Nair", fromOffice: "Works", toOffice: "Estate", status: "ordered", effectiveDate: "2026-10-15", orderNo: "12/2026-Estt", relievedDate: null },
  { id: "t3", employee: "Meera Iyer", fromOffice: "Finance", toOffice: "Works", status: "joined", effectiveDate: "2026-07-01", orderNo: "9/2026-Estt", relievedDate: "2026-06-30" },
  { id: "t4", employee: "Undated Person", fromOffice: "Works", toOffice: "Works", status: "requested", effectiveDate: null },
];

const NONE: TransferFilterValues = { query: "", dept: "", status: "", fromDate: "", toDate: "" };

function show(rows: TransferRow[] = ROWS, locale: "en" | "hi" = "en") {
  const messages = locale === "en" ? enMessages : hiMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <TransferListFilters transfers={rows} />
    </NextIntlClientProvider>,
  );
}

const cards = () => screen.queryAllByLabelText(/^Transfer order for /);
// DataTable body rows (the header row is inside <thead>).
const tableRows = () => Array.from(document.querySelectorAll("tbody tr"));
const openTable = () => fireEvent.click(screen.getByRole("tab", { name: "Table" }));
const pickStatus = (value: string) => fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value } });

describe("filterTransfers (pure)", () => {
  it("matches the department text against EITHER office by name (toOffice 'Finance')", () => {
    expect(filterTransfers(ROWS, { ...NONE, dept: "Finance" }).map((r) => r.id)).toEqual(["t1", "t3"]);
    // the nonexistent `department` field is never consulted
    expect(filterTransfers([{ id: "x", status: "requested", department: "Finance" } as TransferRow], { ...NONE, dept: "Finance" })).toEqual([]);
  });

  it("falls back to fromDepartmentName / toDepartmentName when the office labels are absent", () => {
    const row = { id: "x", status: "requested", fromDepartmentName: "Revenue", toDepartmentName: "Forest" } as TransferRow;
    expect(filterTransfers([row], { ...NONE, dept: "forest" })).toHaveLength(1);
  });

  it("excludes a row with no effective date as soon as a date bound is set", () => {
    expect(filterTransfers(ROWS, NONE).map((r) => r.id)).toContain("t4");
    expect(filterTransfers(ROWS, { ...NONE, fromDate: "2026-01-01" }).map((r) => r.id)).not.toContain("t4");
    expect(filterTransfers(ROWS, { ...NONE, toDate: "2030-01-01" }).map((r) => r.id)).not.toContain("t4");
  });

  it("applies an inclusive effective-date range", () => {
    const ids = filterTransfers(ROWS, { ...NONE, fromDate: "2026-09-01", toDate: "2026-10-15" }).map((r) => r.id);
    expect(ids).toEqual(["t1", "t2"]);
  });

  it("matches status on the raw enum value", () => {
    expect(filterTransfers(ROWS, { ...NONE, status: "ordered" }).map((r) => r.id)).toEqual(["t2"]);
  });

  it("counts only the filters that are actually set", () => {
    expect(appliedFilterCount(NONE)).toBe(0);
    expect(appliedFilterCount({ ...NONE, query: "  ", dept: "Finance", status: "ordered", fromDate: "2026-01-01" })).toBe(3);
  });
});

describe("TransferListFilters (GAP-HR-TRANSFER-04)", () => {
  it("a status filter reduces BOTH the cards and the table rows to the same count", () => {
    show();
    expect(cards()).toHaveLength(4);
    pickStatus("requested");
    expect(cards()).toHaveLength(2);
    openTable();
    expect(tableRows()).toHaveLength(2);
    // the same one filtered array backs the result line in both views
    expect(screen.getByText(/Showing 2 of 4 transfers/)).toBeInTheDocument();
  });

  it("there is exactly one search box -- the table has no separate filter box", () => {
    show();
    openTable();
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
  });

  it("department text 'Finance' matches rows whose toOffice is 'Finance', in both views", () => {
    show();
    fireEvent.change(screen.getByLabelText("Filter by department"), { target: { value: "Finance" } });
    expect(cards()).toHaveLength(2);
    openTable();
    expect(tableRows()).toHaveLength(2);
  });

  it("shows the applied-filter count and 'Clear filters' restores every row in both views", () => {
    show();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    pickStatus("ordered");
    fireEvent.change(screen.getByLabelText("Filter by department"), { target: { value: "Works" } });
    expect(screen.getByText(/2 filters applied/)).toBeInTheDocument();
    expect(cards()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByText(/filters applied/)).not.toBeInTheDocument();
    expect(cards()).toHaveLength(4);
    openTable();
    expect(tableRows()).toHaveLength(4);
  });

  it("a date bound drops undated rows from both views", () => {
    show();
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-01-01" } });
    expect(cards()).toHaveLength(3);
    expect(screen.queryByText("Undated Person")).not.toBeInTheDocument();
    openTable();
    expect(tableRows()).toHaveLength(3);
  });

  it("the status dropdown shows 'Order Issued' while filtering still matches the raw status 'ordered'", () => {
    show();
    const select = screen.getByLabelText("Filter by status");
    const option = within(select).getByRole("option", { name: "Order Issued" }) as HTMLOptionElement;
    expect(option.value).toBe("ordered");
    expect(within(select).queryByRole("option", { name: "ordered" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: option.value } });
    expect(cards()).toHaveLength(1);
    expect(screen.getByText("Vikram Nair")).toBeInTheDocument();
  });

  it("the same status reads the same in the filter, the card and the table", () => {
    show();
    pickStatus("ordered");
    // card: the pill beside the employee name
    const card = cards()[0] as HTMLElement;
    expect(within(card).getAllByText("Order Issued").length).toBeGreaterThan(0);
    openTable();
    const row = tableRows()[0] as HTMLElement;
    expect(within(row).getByText("Order Issued")).toBeInTheDocument();
    expect(within(row).queryByText("Ordered")).not.toBeInTheDocument();
  });

  it("table date columns are formatted with formatIndianDate, not shown as raw ISO", () => {
    show();
    openTable();
    expect(screen.getByText("01 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("30 Jun 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-09-01")).not.toBeInTheDocument();
  });

  it("an empty result keeps the filter bar and shows the no-match state in the table view too", () => {
    show();
    pickStatus("joined");
    fireEvent.change(screen.getByLabelText("Filter by department"), { target: { value: "Nowhere" } });
    expect(screen.getByText("No transfers match your filters")).toBeInTheDocument();
    openTable();
    expect(screen.getByText("No transfers match your filters")).toBeInTheDocument();
    expect(tableRows()).toHaveLength(0);
  });

  it("with no transfers at all it shows only the table's empty state, no filter bar", () => {
    show([]);
    expect(screen.getByText("No transfer orders")).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by status")).not.toBeInTheDocument();
  });

  it("renders its own copy in Hindi (no English literals from this component)", () => {
    show(ROWS, "hi");
    expect(screen.getByLabelText("स्थिति के अनुसार फ़िल्टर करें")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "तालिका" })).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });
});
