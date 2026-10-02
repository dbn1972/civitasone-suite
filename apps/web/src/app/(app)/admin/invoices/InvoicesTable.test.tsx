import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { InvoicesTable } from "./InvoicesTable";
import { invoiceStats, invoiceStatusTone, toInvoiceRows } from "./invoiceStats";
import { useSeededResource } from "@/lib/sync/resource";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

const row = (status: string, id = status) => ({ id, periodMonth: "2026-09", totalMinor: "125000", paidMinor: "0", outstandingMinor: "125000", issuedAt: "2026-09-01", status });
function seeded(data: Record<string, unknown>[], provenance: "live" | "cached" | "error-no-data") {
  vi.mocked(useSeededResource).mockReturnValue({ data, fromCache: provenance === "cached", offline: false, cachedAt: null, provenance } as never);
}
const cardValue = (label: string) => screen.getAllByText(label)[0]!.parentElement!;

describe("invoiceStats (GAP-ADMIN-INVOICES-05)", () => {
  it("Pending is an explicit allow-list, not the remainder", () => {
    const s = invoiceStats(toInvoiceRows(["paid", "overdue", "draft", "cancelled", "issued", "partially_paid", "waived"].map((x) => row(x))));
    expect(s).toEqual({ total: 7, paid: 1, overdue: 1, pending: 2, other: 3 });
  });
  it("tones every InvoiceStatus deliberately (GAP-ADMIN-INVOICES-07)", () => {
    expect(invoiceStatusTone("cancelled")).toBe("mut");
    expect(invoiceStatusTone("partially_paid")).toBe("warn");
    expect(invoiceStatusTone("issued")).toBe("warn");
    expect(invoiceStatusTone("paid")).toBe("good");
    expect(invoiceStatusTone("overdue")).toBe("bad");
  });
});

describe("InvoicesTable (GAP-ADMIN-INVOICES-03/-04)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cached rows with an empty server list: cards match the table", () => {
    seeded([row("paid", "a"), row("issued", "b"), row("draft", "c")], "cached");
    render(<InvoicesTable invoices={[]} />);
    expect(cardValue("Total Invoices")).toHaveTextContent("3");
    expect(cardValue("Paid")).toHaveTextContent("1");
    expect(cardValue("Pending")).toHaveTextContent("1");
    expect(within(screen.getByRole("table")).getByText("a")).toBeInTheDocument();
  });

  it("failed load with no cache: cards are em dashes and Retry shows instead of 'No invoices'", () => {
    seeded([], "error-no-data");
    render(<InvoicesTable invoices={[]} source="error" errorStatus={500} />);
    expect(cardValue("Total Invoices")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No invoices")).not.toBeInTheDocument();
  });

  it("403: access restricted, no retry", () => {
    seeded([], "error-no-data");
    render(<InvoicesTable invoices={[]} source="error" errorStatus={403} />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("genuinely empty live list shows zeros", () => {
    seeded([], "live");
    render(<InvoicesTable invoices={[]} />);
    expect(cardValue("Total Invoices")).toHaveTextContent("0");
  });
});
