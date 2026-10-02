import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { FiscalYearForm } from "./FiscalYearForm";

describe("FiscalYearForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("validates the code format before opening the confirm dialog", () => {
    render(<FiscalYearForm />);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "bad-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Fiscal Year" }));
    expect(screen.getByText("Code must be in YYYY-YY format, e.g. 2026-27.")).toBeInTheDocument();
  });

  it("creates a fiscal year on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "fy-1", status: "created" }), { status: 201 }),
    );

    render(<FiscalYearForm />);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "2026-27" } });
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "FY 2026-27" } });
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: "2027-03-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Fiscal Year" }));
    await waitFor(() => expect(screen.getByText("Create this fiscal year?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for creating and activating this year"), { target: { value: "Opening the new financial year per Finance Dept order" } });
    fireEvent.click(screen.getByText("Create fiscal year"));

    await waitFor(() => {
      expect(screen.getByText("Fiscal year 2026-27 created.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<FiscalYearForm />);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "2026-27" } });
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "FY 2026-27" } });
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: "2027-03-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Fiscal Year" }));
    await waitFor(() => expect(screen.getByText("Create this fiscal year?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for creating and activating this year"), { target: { value: "Opening the new financial year per Finance Dept order" } });
    fireEvent.click(screen.getByText("Create fiscal year"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-FISCAL-YEARS-01
  const EXISTING = [
    { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" },
  ];
  function fillYear(code: string, start: string, end: string) {
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: code } });
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: `FY ${code}` } });
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: start } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: end } });
    fireEvent.click(screen.getByRole("button", { name: "Create Fiscal Year" }));
  }

  it("blocks a year that overlaps an existing one; the dialog never opens", () => {
    render(<FiscalYearForm rows={EXISTING} />);
    fillYear("2027-28", "2027-01-01", "2027-12-31");
    expect(screen.getByText("These dates overlap fiscal year 2026-27.")).toBeInTheDocument();
    expect(screen.queryByText("Create this fiscal year?")).not.toBeInTheDocument();
  });

  it("names the active year that will be closed, requires a 10+ char reason, and POSTs it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 }));
    render(<FiscalYearForm rows={EXISTING} />);
    fillYear("2027-28", "2027-04-01", "2028-03-31");
    await waitFor(() => expect(screen.getByText("Create this fiscal year?")).toBeInTheDocument());
    expect(screen.getByText(/will be closed/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Create fiscal year" });
    fireEvent.change(screen.getByLabelText("Reason for creating and activating this year"), { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for creating and activating this year"), { target: { value: "Year-end rollover per GO 12/2027" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.reason).toBe("Year-end rollover per GO 12/2027");
  });
});
