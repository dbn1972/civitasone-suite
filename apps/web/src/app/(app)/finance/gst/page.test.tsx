import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import GstConsolePage from "./page";
import { formatMoney } from "@/lib/formatters";

describe("GstConsolePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders GST summary, ledger, and ITC data for the selected period", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/summary")) {
        return Promise.resolve({
          data: [
            { gst_type: "CGST", direction: "output", total_taxable: 100000, total_tax: 9000, transaction_count: 3 },
            { gst_type: "CGST", direction: "input", total_taxable: 40000, total_tax: 3600, transaction_count: 2 },
          ],
          source: "api",
        });
      }
      if (path.includes("/itc-reconciliation")) {
        return Promise.resolve({
          data: [{ gst_type: "CGST", itc_available: 3600, output_liability: 9000, net_payable: 5400 }],
          source: "api",
        });
      }
      return Promise.resolve({
        data: [
          {
            id: "1", invoice_id: "inv-1", invoice_no: "INV-001", invoice_date: "2026-06-05",
            party_gstin: "27AAAAA0000A1Z5", party_name: "Vendor Co", gst_type: "CGST", direction: "output",
            taxable_minor: 10000000, tax_minor: 900000, rate_pct: 9, hsn_code: "9954", period: "2026-06", status: "posted", created_at: "2026-06-05T00:00:00Z",
          },
        ],
        source: "api",
      });
    });

    const ui = await GstConsolePage({ searchParams: { period: "2026-06" } });
    render(ui);
    expect(screen.getByText("GST / ITC Console")).toBeInTheDocument();
    fireEvent.click(screen.getByText("GST Ledger"));
    expect(screen.getByText("INV-001")).toBeInTheDocument();
  });

  it("renders empty states when there is no GST data for the period", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/summary")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/itc-reconciliation")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await GstConsolePage({ searchParams: { period: "2026-06" } });
    render(ui);
    expect(screen.getByText("No GST summary for this period")).toBeInTheDocument();
  });

  it("shows the data-source badge when any GST endpoint errors", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("/summary")) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await GstConsolePage({ searchParams: { period: "2026-06" } });
    render(ui);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});

// GAP-FINANCE-GST-01
describe("GstConsolePage failed sources", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("summary failure: Output Tax / Transactions read '—' and a do-not-file banner shows", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("/summary")) return Promise.resolve({ data: [], source: "error", status: 500 });
      return Promise.resolve({ data: [], source: "api" });
    });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByText("Output Tax").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Transactions").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText(/do not file/i)).toBeInTheDocument();
  });

  it("ITC failure: Net GST Payable reads '—', not ₹0.00", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("/itc-reconciliation")) return Promise.resolve({ data: [], source: "error", status: 502 });
      return Promise.resolve({ data: [], source: "api" });
    });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByText("Net balance by tax head (before credit utilisation)").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Net balance by tax head (before credit utilisation)").closest(".stat")).not.toHaveTextContent("₹0.00");
  });

  it("a genuine empty period (api ok, []) reads Nil / ₹0.00, not an error, and no banner", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByText("Net balance by tax head (before credit utilisation)").closest(".stat")).toHaveTextContent("Nil");
    expect(screen.getByText("Surplus credit by head").closest(".stat")).toHaveTextContent("₹0.00");
    expect(screen.queryByText(/do not file/i)).not.toBeInTheDocument();
  });
});

function mockGst(opts: { summary?: unknown[]; itc?: unknown[] }) {
  fetchJsonMock.mockImplementation((path: string) => {
    if (typeof path === "string" && path.includes("/summary")) return Promise.resolve({ data: opts.summary ?? [], source: "api" });
    if (typeof path === "string" && path.includes("/itc-reconciliation")) return Promise.resolve({ data: opts.itc ?? [], source: "api" });
    return Promise.resolve({ data: [], source: "api" });
  });
}

// GAP-FINANCE-GST-02: no cross-head netting in the payable headline.
describe("GstConsolePage head-wise payable (GAP-FINANCE-GST-02)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("CGST -500 and SGST +300: payable is the positive head (3.00) and the surplus is carried forward (5.00), not -2.00", async () => {
    mockGst({
      itc: [
        { gst_type: "CGST", itc_available: 1000, output_liability: 500, net_payable: -500 },
        { gst_type: "SGST", itc_available: 100, output_liability: 400, net_payable: 300 },
      ],
    });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByText("Net balance by tax head (before credit utilisation)").closest(".stat")).toHaveTextContent("₹3.00");
    expect(screen.getByText("Surplus credit by head").closest(".stat")).toHaveTextContent("₹5.00");
  });

  it("all-zero heads read Nil (not the warning state)", async () => {
    mockGst({ itc: [{ gst_type: "CGST", itc_available: 0, output_liability: 0, net_payable: 0 }] });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByText("Net balance by tax head (before credit utilisation)").closest(".stat")).toHaveTextContent("Nil");
  });
});

// GAP-FINANCE-GST-03: the ITC card is the reconciled figure; a different summary figure raises a mismatch alert.
describe("GstConsolePage ITC source (GAP-FINANCE-GST-03)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("card equals sum(itc_available) from the reconciliation", async () => {
    mockGst({
      summary: [{ gst_type: "CGST", direction: "input", total_taxable: 0, total_tax: 3600, transaction_count: 1 }],
      itc: [{ gst_type: "CGST", itc_available: 3000, output_liability: 0, net_payable: -3000 }, { gst_type: "SGST", itc_available: 600, output_liability: 0, net_payable: -600 }],
    });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByText("Input Tax Credit Available").closest(".stat")).toHaveTextContent("₹36.00");
    expect(screen.queryByText(/Mismatch/)).not.toBeInTheDocument();
  });

  it("differing summary input tax vs itc_available shows the mismatch alert", async () => {
    mockGst({
      summary: [{ gst_type: "CGST", direction: "input", total_taxable: 0, total_tax: 5000, transaction_count: 1 }],
      itc: [{ gst_type: "CGST", itc_available: 3000, output_liability: 0, net_payable: -3000 }],
    });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Mismatch/);
  });
});

// GAP-FINANCE-GST-04: exact bigint sums.
describe("GstConsolePage exact paise (GAP-FINANCE-GST-04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("sums above 2^53 without losing a paisa", async () => {
    mockGst({
      summary: [
        { gst_type: "CGST", direction: "output", total_taxable: "0", total_tax: "9007199254740993", transaction_count: 1 },
        { gst_type: "SGST", direction: "output", total_taxable: "0", total_tax: "1", transaction_count: 1 },
      ],
    });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    // 9007199254740993 + 1 paise, exactly (Number() would give ...992 or ...996).
    expect(screen.getByText("Output Tax").closest(".stat")).toHaveTextContent(formatMoney(9007199254740994n));
  });

  it("an unparseable value renders '—', never ₹0.00", async () => {
    mockGst({ summary: [{ gst_type: "CGST", direction: "output", total_taxable: "0", total_tax: "abc", transaction_count: 1 }] });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByText("Output Tax").closest(".stat")).toHaveTextContent("—");
  });
});

// GAP-FINANCE-GST-06
describe("GstConsolePage period validation (GAP-FINANCE-GST-06)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("'2026-13' is rejected with an inline notice and the current month is shown", async () => {
    mockGst({});
    render(await GstConsolePage({ searchParams: { period: "2026-13" } }));
    expect(screen.getByText(/"2026-13" is not a valid period/)).toBeInTheDocument();
    const paths = fetchJsonMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("period=2026-13"))).toBe(false);
  });

  it("a valid ?period= shows no notice", async () => {
    mockGst({});
    render(await GstConsolePage({ searchParams: { period: "2026-07" } }));
    expect(screen.queryByText(/is not a valid period/)).not.toBeInTheDocument();
  });
});

describe("GstConsolePage estimated cash payable", () => {
  beforeEach(() => fetchJsonMock.mockReset());
  it("applies IGST credit against CGST/SGST and labels the figure an estimate", async () => {
    mockGst({ itc: [
      { gst_type: "IGST", itc_available: 1000, output_liability: 0, net_payable: -10000 },
      { gst_type: "CGST", itc_available: 0, output_liability: 6000, net_payable: 6000 },
      { gst_type: "SGST", itc_available: 0, output_liability: 7000, net_payable: 7000 },
    ] });
    render(await GstConsolePage({ searchParams: { period: "2026-06" } }));
    expect(screen.getByText("Estimated cash payable after set-off").closest(".stat")).toHaveTextContent("₹30.00");
    expect(screen.getByText(/Indicative only/)).toBeInTheDocument();
  });
});
