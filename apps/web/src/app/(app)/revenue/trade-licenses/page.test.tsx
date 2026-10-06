import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

import TradeLicensesPage from "./page";
import type { TradeLicenseRow } from "./page";

function makeRow(partial: Partial<TradeLicenseRow>): TradeLicenseRow {
  return {
    id: "1",
    licenseNo: "TL-1",
    businessName: "Acme Traders",
    proprietorName: "A. Proprietor",
    address: "1 MG Road",
    businessType: "retail",
    category: "A",
    status: "active",
    expiryDate: "2026-03-31",
    feeMinor: "250050",
    feePaidMinor: "100000",
    renewalCount: 2,
    isActive: true,
    ...partial,
  };
}

function mockFetchRows(rows: TradeLicenseRow[]) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ data: rows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("TradeLicensesTable money display (GAP-REVENUE-TRADE-LICENSES-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRefresh.mockReset();
  });

  it("renders feeMinor '250050' as ₹2,500.50 — paise are kept, not truncated", async () => {
    mockFetchRows([makeRow({ feeMinor: "250050", feePaidMinor: "250050" })]);
    render(<TradeLicensesPage />);
    expect(await screen.findByText("Acme Traders")).toBeInTheDocument();
    expect(screen.getAllByText("₹2,500.50").length).toBeGreaterThanOrEqual(2);
    // The old whole-rupee truncation would have shown "2500" — assert it is gone.
    expect(screen.queryByText("2500")).not.toBeInTheDocument();
  });

  it("renders a missing fee as an em-dash without crashing the row (regression from UX-018)", async () => {
    mockFetchRows([
      makeRow({
        businessName: "Missing Fee Traders",
        feeMinor: undefined as unknown as string,
        feePaidMinor: null as unknown as string,
        expiryDate: "2027-01-01",
      }),
    ]);
    render(<TradeLicensesPage />);
    const row = (await screen.findByText("Missing Fee Traders")).closest("tr")!;
    expect(within(row).getAllByText("—")).toHaveLength(2); // Fee + Paid only
  });
});

describe("TradeLicensesTable expiry + status (GAP-REVENUE-TRADE-LICENSES-05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRefresh.mockReset();
  });

  it("renders expiry in Indian 'dd Mon yyyy' format, not raw ISO", async () => {
    mockFetchRows([makeRow({ expiryDate: "2026-03-31" })]);
    render(<TradeLicensesPage />);
    expect(await screen.findByText("31 Mar 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-03-31")).not.toBeInTheDocument();
  });

  it("gives expired and cancelled distinct pill tones (not both 'bad')", async () => {
    mockFetchRows([
      makeRow({ id: "a", licenseNo: "TL-A", businessName: "Expired Co", status: "expired" }),
      makeRow({ id: "b", licenseNo: "TL-B", businessName: "Cancelled Co", status: "cancelled" }),
    ]);
    render(<TradeLicensesPage />);
    const expiredRow = (await screen.findByText("Expired Co")).closest("tr")!;
    const cancelledRow = (await screen.findByText("Cancelled Co")).closest("tr")!;
    const expiredPill = within(expiredRow).getByText("expired");
    const cancelledPill = within(cancelledRow).getByText("cancelled");
    expect(expiredPill.className).not.toBe(cancelledPill.className);
    expect(expiredPill.className).toContain("warn");
    expect(cancelledPill.className).toContain("bad");
  });
});

describe("TradeLicensesTable renewals column (GAP-REVENUE-TRADE-LICENSES-03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRefresh.mockReset();
  });

  it("shows a Renewals column with the renewal count per row", async () => {
    mockFetchRows([makeRow({ renewalCount: 3 })]);
    render(<TradeLicensesPage />);
    expect(await screen.findByText("Acme Traders")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Renewals" })).toBeInTheDocument();
    const row = screen.getByText("Acme Traders").closest("tr")!;
    expect(within(row).getByText("3")).toBeInTheDocument();
  });

  it("subtitle no longer promises renew/cancel", async () => {
    mockFetchRows([]);
    render(<TradeLicensesPage />);
    await waitFor(() => expect(screen.queryByLabelText("Loading licenses…")).not.toBeInTheDocument());
    expect(screen.getByText(/Issue and track municipal trade/)).toBeInTheDocument();
    expect(screen.queryByText(/renew, and cancel/)).not.toBeInTheDocument();
  });
});

describe("TradeLicensesPage failure handling (GAP-REVENUE-TRADE-LICENSES-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRefresh.mockReset();
  });

  it("shows '—' in KPIs and a Retry action on fetch failure, never 0", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<TradeLicensesPage />);
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    // KPI StatCards must read '—', not a fabricated 0.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("Failed to load trade licenses. Please try again.")).not.toBeInTheDocument();

    // Retry refetches (succeeds the second time).
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [makeRow({})] }), { status: 200 }),
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("Acme Traders")).toBeInTheDocument());
  });

  it("reads the list through the BFF proxy, not /api/v1 directly (GAP-REVENUE-TRADE-LICENSES-02)", async () => {
    const fetchSpy = mockFetchRows([makeRow({})]);
    render(<TradeLicensesPage />);
    await screen.findByText("Acme Traders");
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/proxy/");
    expect(url).not.toMatch(/^\/api\/v1\//);
  });
});

describe("TradeLicenseCreateForm fee entry (GAP-REVENUE-TRADE-LICENSES-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRefresh.mockReset();
  });

  function fillRequired() {
    fireEvent.change(screen.getByLabelText(/License No\./), { target: { value: "TL-NEW" } });
    fireEvent.change(screen.getByLabelText(/Business Name/), { target: { value: "New Biz" } });
    fireEvent.change(screen.getByLabelText(/Proprietor Name/), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText(/Address/), { target: { value: "2 Market St" } });
    fireEvent.change(screen.getByLabelText(/Business Type/), { target: { value: "retail" } });
  }

  it("has no 'paise' wording — the fee is entered in rupees", async () => {
    mockFetchRows([]);
    render(<TradeLicensesPage />);
    await waitFor(() => expect(screen.queryByLabelText("Loading licenses…")).not.toBeInTheDocument());
    expect(screen.queryByText(/Fee \(paise\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/Fee \(₹\)/)).toBeInTheDocument();
  });

  it("blocks submit when the fee is blank or zero", async () => {
    mockFetchRows([]);
    render(<TradeLicensesPage />);
    await waitFor(() => expect(screen.queryByLabelText("Loading licenses…")).not.toBeInTheDocument());
    fillRequired();
    // leave fee blank
    fireEvent.click(screen.getByRole("button", { name: "Issue Trade License" }));
    expect(await screen.findByText(/Enter a fee greater than zero/)).toBeInTheDocument();
    // zero is also rejected
    fireEvent.change(screen.getByLabelText(/Fee \(₹\)/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue Trade License" }));
    expect(await screen.findByText(/Enter a fee greater than zero/)).toBeInTheDocument();
    // confirm dialog must NOT have opened
    expect(screen.queryByText("Issue this trade license?")).not.toBeInTheDocument();
  });

  it("posts feeMinor '250050' for a typed '2500.50', after confirmation", async () => {
    const fetchSpy = mockFetchRows([]);
    render(<TradeLicensesPage />);
    await waitFor(() => expect(screen.queryByLabelText("Loading licenses…")).not.toBeInTheDocument());
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Fee \(₹\)/), { target: { value: "2500.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue Trade License" }));

    // Confirm dialog shows the formatted fee.
    await waitFor(() => expect(screen.getByText("Issue this trade license?")).toBeInTheDocument());
    expect(screen.getByText("₹2,500.50")).toBeInTheDocument();

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
    fireEvent.click(screen.getByRole("button", { name: "Issue license" }));

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(postCall).toBeTruthy();
      const body = JSON.parse(String((postCall![1] as RequestInit).body));
      expect(body.feeMinor).toBe("250050");
    });
  });
});
