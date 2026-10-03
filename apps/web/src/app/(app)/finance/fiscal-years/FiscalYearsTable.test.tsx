import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { FiscalYearsTable } from "./FiscalYearsTable";

const rows = [
  { code: "2025-26", label: "FY 2025-26", startDate: "2025-04-01", endDate: "2026-03-31", status: "closed" },
  { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "closed" },
];

describe("FiscalYearsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("gives each row's Activate button a unique accessible name", () => {
    render(<FiscalYearsTable rows={rows} />);
    expect(screen.getByRole("button", { name: "Activate fiscal year 2025-26" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate fiscal year 2026-27" })).toBeInTheDocument();
  });

  it("does not show an Activate button for the already-active year", () => {
    render(
      <FiscalYearsTable
        rows={[{ code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Activate fiscal year 2026-27/ })).not.toBeInTheDocument();
    expect(screen.getByText("Currently active")).toBeInTheDocument();
  });

  it("activates a fiscal year on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "activated", code: "2025-26" }), { status: 200 }),
    );

    render(<FiscalYearsTable rows={rows} secondApprover={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate fiscal year 2025-26" }));

    await waitFor(() => expect(screen.getByText("Activate this fiscal year?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for switching the posting year"), { target: { value: "Re-opening prior year for audit adjustments" } });
    fireEvent.click(screen.getByText("Activate fiscal year"));

    await waitFor(() => {
      expect(screen.getByText("Activation of 2025-26 was submitted. It becomes the active year in a moment.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<FiscalYearsTable rows={rows} secondApprover={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate fiscal year 2025-26" }));

    await waitFor(() => expect(screen.getByText("Activate this fiscal year?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for switching the posting year"), { target: { value: "Re-opening prior year for audit adjustments" } });
    fireEvent.click(screen.getByText("Activate fiscal year"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-FISCAL-YEARS-02
  it("keeps Confirm disabled until a reason is given, and PATCHes it in the body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    render(<FiscalYearsTable rows={rows} secondApprover={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate fiscal year 2025-26" }));
    await waitFor(() => expect(screen.getByText("Activate this fiscal year?")).toBeInTheDocument());
    const confirm = screen.getByRole("button", { name: "Activate fiscal year" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for switching the posting year"), { target: { value: "Year-end rollover approved by FA" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Year-end rollover approved by FA" });
  });

  it("warns about not-hard-closed periods of the outgoing year, with a link", async () => {
    const withActive = [
      { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" },
      { code: "2027-28", label: "FY 2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "closed" },
    ];
    const periods = [
      { period: "2027-03", fiscalYear: "2026-27", status: "open", closedBy: null, closedAt: null },
      { period: "2027-02", fiscalYear: "2026-27", status: "soft_close", closedBy: null, closedAt: null },
      { period: "2027-01", fiscalYear: "2026-27", status: "hard_close", closedBy: null, closedAt: null },
    ];
    render(<FiscalYearsTable rows={withActive} periods={periods} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate fiscal year 2027-28" }));
    await waitFor(() => expect(screen.getByText("Activate this fiscal year?")).toBeInTheDocument());
    expect(screen.getByText(/2 periods of 2026-27 not hard-closed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review period close" })).toHaveAttribute("href", "/finance/period-close");
    expect(screen.getByRole("link", { name: /opening balances for 2027-28/ })).toHaveAttribute("href", "/finance/opening-balances?fy=2027-28");
  });

  // GAP-FINANCE-FISCAL-YEARS-01/-02: second approver (default on)
  it("by default the dialog says a different finance administrator must approve, and confirming submits for approval", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_approval", id: "r1" }), { status: 202 }),
    );
    render(<FiscalYearsTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate fiscal year 2025-26" }));
    await waitFor(() => expect(screen.getByText("Activate this fiscal year?")).toBeInTheDocument());
    expect(screen.getByText(/A different finance administrator must approve this/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for switching the posting year"), { target: { value: "Year-end rollover approved by FA" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText(/was submitted\. It takes effect when a different finance administrator approves it below/)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("a draft year gets an Activate button, and a year that already has a request shows 'Awaiting approval' instead", () => {
    render(
      <FiscalYearsTable
        rows={[
          { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" },
          { code: "2027-28", label: "FY 2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "draft" },
          { code: "2028-29", label: "FY 2028-29", startDate: "2028-04-01", endDate: "2029-03-31", status: "draft" },
        ]}
        pendingCodes={["2028-29"]}
      />,
    );
    expect(screen.getByRole("button", { name: "Activate fiscal year 2027-28" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate fiscal year 2028-29" })).not.toBeInTheDocument();
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
  });

  it("explains a server refusal for open periods in plain words, never the raw code or text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "FY_OPEN_PERIODS", message: "fiscal year 2026-27 still has 1 period(s) that are not hard-closed (2027-03)",
    }), { status: 409 }));
    render(
      <FiscalYearsTable
        rows={[
          { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" },
          { code: "2027-28", label: "FY 2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "draft" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Activate fiscal year 2027-28" }));
    await waitFor(() => expect(screen.getByText("Activate this fiscal year?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for switching the posting year"), { target: { value: "Year-end rollover approved by FA" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    const msg = await screen.findByText(/still has months that are not hard-closed/);
    expect(msg.textContent).not.toMatch(/FY_OPEN_PERIODS|period\(s\)/);
  });
});
